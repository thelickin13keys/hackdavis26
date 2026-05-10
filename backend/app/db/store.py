import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS edges (
    edge_id TEXT PRIMARY KEY,
    u INTEGER NOT NULL,
    v INTEGER NOT NULL,
    key INTEGER NOT NULL,
    name TEXT,
    highway TEXT,
    length_m REAL NOT NULL,
    geometry_geojson TEXT NOT NULL,
    osm_tags_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_edges_uv ON edges(u, v);

-- One row per (edge, lat, lon) sample location. Each location may have several
-- images at different headings (stored in images_json) but produces a single
-- combined safety score from Gemini.
CREATE TABLE IF NOT EXISTS samples (
    sample_id INTEGER PRIMARY KEY AUTOINCREMENT,
    edge_id TEXT NOT NULL REFERENCES edges(edge_id),
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    images_json TEXT,
    score INTEGER,
    infrastructure TEXT,
    hazards_json TEXT,
    reasons_json TEXT,
    raw_response_json TEXT,
    scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(edge_id, lat, lon)
);

CREATE INDEX IF NOT EXISTS idx_samples_edge ON samples(edge_id);

CREATE TABLE IF NOT EXISTS edge_scores (
    edge_id TEXT PRIMARY KEY REFERENCES edges(edge_id),
    mean_score REAL,
    sample_count INTEGER,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Intersection scoring (degree>=3 OSM nodes). Score how scary the intersection
-- itself is to traverse — distinct from the edge-segment scoring.
--
-- Three "type" fields:
--   * intersection_type — geometric shape: 't', 'y', 'four_way', 'complex'
--   * osm_control       — raw OSM tag on the node: 'traffic_signals', 'stop',
--                          'give_way', 'crossing', 'mini_roundabout', or NULL
--   * gemini_control    — what Gemini thought the control was after seeing the
--                          4 cardinal images (signal / stop / all_way_stop /
--                          uncontrolled / yield / signal_with_bike_phase / ...)
CREATE TABLE IF NOT EXISTS intersections (
    node_id INTEGER PRIMARY KEY,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    degree INTEGER NOT NULL,
    intersection_type TEXT,
    osm_control TEXT,
    gemini_control TEXT,
    images_json TEXT,
    score INTEGER,
    hazards_json TEXT,
    reasons_json TEXT,
    raw_response_json TEXT,
    scored_at TIMESTAMP
);
"""


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, col_def: str) -> None:
    """Idempotent ALTER TABLE ADD COLUMN — SQLite can't do IF NOT EXISTS until 3.35,
    so we check PRAGMA table_info first."""
    info = conn.execute(f"PRAGMA table_info({table})").fetchall()
    if column not in {row[1] for row in info}:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}")


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.executescript(SCHEMA)
        # Migrations for DBs created before these columns existed.
        _ensure_column(conn, "intersections", "intersection_type", "TEXT")
        _ensure_column(conn, "intersections", "osm_control", "TEXT")
        _ensure_column(conn, "intersections", "gemini_control", "TEXT")


@contextmanager
def connect(db_path: Path) -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def upsert_edge(
    conn: sqlite3.Connection,
    edge_id: str,
    u: int,
    v: int,
    key: int,
    name: str | None,
    highway: str | None,
    length_m: float,
    geometry_geojson: dict,
    osm_tags: dict | None = None,
) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO edges
            (edge_id, u, v, key, name, highway, length_m, geometry_geojson, osm_tags_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            edge_id,
            u,
            v,
            key,
            name,
            highway,
            length_m,
            json.dumps(geometry_geojson),
            json.dumps(osm_tags) if osm_tags else None,
        ),
    )


def upsert_sample(
    conn: sqlite3.Connection,
    edge_id: str,
    lat: float,
    lon: float,
    images: list[dict],
    score: int | None,
    infrastructure: str | None,
    hazards: list | None,
    reasons: list | None,
    raw_response: dict | None,
) -> int:
    """Upsert by (edge_id, lat, lon). `images` is a list of {heading, pano_id, image_path}."""
    cur = conn.execute(
        """
        INSERT INTO samples
            (edge_id, lat, lon, images_json, score, infrastructure,
             hazards_json, reasons_json, raw_response_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(edge_id, lat, lon) DO UPDATE SET
            images_json = excluded.images_json,
            score = excluded.score,
            infrastructure = excluded.infrastructure,
            hazards_json = excluded.hazards_json,
            reasons_json = excluded.reasons_json,
            raw_response_json = excluded.raw_response_json,
            scored_at = CURRENT_TIMESTAMP
        """,
        (
            edge_id,
            lat,
            lon,
            json.dumps(images),
            score,
            infrastructure,
            json.dumps(hazards) if hazards is not None else None,
            json.dumps(reasons) if reasons is not None else None,
            json.dumps(raw_response) if raw_response is not None else None,
        ),
    )
    return cur.lastrowid or 0


def upsert_intersection_meta(
    conn: sqlite3.Connection,
    node_id: int,
    lat: float,
    lon: float,
    degree: int,
    intersection_type: str | None = None,
    osm_control: str | None = None,
) -> None:
    """Insert intersection metadata if missing; preserve existing scoring.
    Type and control fields are optional — only updated when supplied so that
    re-running the network extraction doesn't clobber Gemini's control assessment."""
    conn.execute(
        """
        INSERT INTO intersections (node_id, lat, lon, degree, intersection_type, osm_control)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
            lat = excluded.lat,
            lon = excluded.lon,
            degree = excluded.degree,
            intersection_type = COALESCE(excluded.intersection_type, intersection_type),
            osm_control = COALESCE(excluded.osm_control, osm_control)
        """,
        (node_id, lat, lon, degree, intersection_type, osm_control),
    )


def upsert_intersection_score(
    conn: sqlite3.Connection,
    node_id: int,
    images: list[dict],
    score: int | None,
    hazards: list | None,
    reasons: list | None,
    raw_response: dict | None,
    gemini_control: str | None = None,
) -> None:
    conn.execute(
        """
        UPDATE intersections SET
            images_json = ?,
            score = ?,
            gemini_control = COALESCE(?, gemini_control),
            hazards_json = ?,
            reasons_json = ?,
            raw_response_json = ?,
            scored_at = CURRENT_TIMESTAMP
        WHERE node_id = ?
        """,
        (
            json.dumps(images),
            score,
            gemini_control,
            json.dumps(hazards) if hazards is not None else None,
            json.dumps(reasons) if reasons is not None else None,
            json.dumps(raw_response) if raw_response is not None else None,
            node_id,
        ),
    )


def recompute_edge_scores(conn: sqlite3.Connection) -> int:
    cur = conn.execute(
        """
        INSERT OR REPLACE INTO edge_scores (edge_id, mean_score, sample_count, updated_at)
        SELECT edge_id, AVG(score) AS mean_score, COUNT(score) AS n,
               CURRENT_TIMESTAMP
        FROM samples
        WHERE score IS NOT NULL
        GROUP BY edge_id
        """
    )
    return cur.rowcount


# OSM highway tag → default safety score. These cover infrastructure that's
# inherently off-street and therefore safe regardless of what Street View shows
# (and Street View usually shows nothing because there's no road for the SV car).
# A multi-token tag like "residential,cycleway" gets the highest match.
HIGHWAY_DEFAULT_SCORES = {
    "cycleway": 10,    # dedicated separated bike infrastructure
    "path": 9,         # shared-use path (Davis greenbelt network)
    "footway": 8,      # shared with pedestrians
    "pedestrian": 7,   # plaza / shared zone
    "living_street": 7,  # very low-speed residential
}


def _default_score_for_highway(highway: str | None) -> int | None:
    if not highway:
        return None
    best: int | None = None
    for token in highway.split(","):
        s = HIGHWAY_DEFAULT_SCORES.get(token.strip())
        if s is not None and (best is None or s > best):
            best = s
    return best


def infer_unscored_edge_scores(conn: sqlite3.Connection) -> int:
    """For edges with no Gemini-derived score but a highway tag that implies
    inherent off-street safety (cycleway, path, footway, etc.), insert a default
    score so the router can prefer them and the heatmap renders them safely.
    Marked with sample_count=0 so the frontend can tell measured vs inferred."""
    rows = conn.execute(
        """
        SELECT e.edge_id, e.highway
        FROM edges e LEFT JOIN edge_scores s ON s.edge_id = e.edge_id
        WHERE s.edge_id IS NULL
        """
    ).fetchall()
    n = 0
    for r in rows:
        score = _default_score_for_highway(r["highway"])
        if score is None:
            continue
        conn.execute(
            """
            INSERT OR REPLACE INTO edge_scores
                (edge_id, mean_score, sample_count, updated_at)
            VALUES (?, ?, 0, CURRENT_TIMESTAMP)
            """,
            (r["edge_id"], float(score)),
        )
        n += 1
    return n


def already_scored_edges(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT DISTINCT edge_id FROM samples WHERE score IS NOT NULL"
    ).fetchall()
    return {r["edge_id"] for r in rows}


def already_scored_intersections(conn: sqlite3.Connection) -> set[int]:
    rows = conn.execute(
        "SELECT node_id FROM intersections WHERE score IS NOT NULL"
    ).fetchall()
    return {r["node_id"] for r in rows}


def fetch_scored_edges(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT e.edge_id, e.name, e.highway, e.length_m, e.geometry_geojson,
               s.mean_score, s.sample_count
        FROM edges e
        LEFT JOIN edge_scores s ON s.edge_id = e.edge_id
        """
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        out.append(
            {
                "edge_id": r["edge_id"],
                "name": r["name"],
                "highway": r["highway"],
                "length_m": r["length_m"],
                "geometry": json.loads(r["geometry_geojson"]),
                "mean_score": r["mean_score"],
                "sample_count": r["sample_count"],
            }
        )
    return out


def fetch_intersection_scores(conn: sqlite3.Connection) -> dict[int, float]:
    rows = conn.execute(
        "SELECT node_id, score FROM intersections WHERE score IS NOT NULL"
    ).fetchall()
    return {r["node_id"]: float(r["score"]) for r in rows}


def fetch_intersection_routing_data(conn: sqlite3.Connection) -> dict[int, dict]:
    """All intersections with the fields the router needs: Gemini score (if any),
    geometric type, OSM control tag, degree. Used to compute an effective score
    for every intersection — not just the few we paid Gemini for."""
    rows = conn.execute(
        """
        SELECT node_id, degree, intersection_type, osm_control, score
        FROM intersections
        """
    ).fetchall()
    return {
        r["node_id"]: {
            "degree": r["degree"],
            "intersection_type": r["intersection_type"],
            "osm_control": r["osm_control"],
            "gemini_score": r["score"],  # may be None
        }
        for r in rows
    }


def fetch_all_intersections(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT node_id, lat, lon, degree, intersection_type, osm_control,
               gemini_control, score
        FROM intersections
        """
    ).fetchall()
    return [
        {
            "node_id": r["node_id"],
            "lat": r["lat"],
            "lon": r["lon"],
            "degree": r["degree"],
            "intersection_type": r["intersection_type"],
            "osm_control": r["osm_control"],
            "gemini_control": r["gemini_control"],
            "score": r["score"],
        }
        for r in rows
    ]


def fetch_edge_detail(conn: sqlite3.Connection, edge_id: str) -> dict | None:
    edge = conn.execute(
        """
        SELECT e.edge_id, e.name, e.highway, e.length_m, e.geometry_geojson,
               s.mean_score, s.sample_count
        FROM edges e LEFT JOIN edge_scores s ON s.edge_id = e.edge_id
        WHERE e.edge_id = ?
        """,
        (edge_id,),
    ).fetchone()
    if edge is None:
        return None
    samples = conn.execute(
        """
        SELECT sample_id, lat, lon, images_json, score,
               infrastructure, hazards_json, reasons_json
        FROM samples WHERE edge_id = ? ORDER BY sample_id
        """,
        (edge_id,),
    ).fetchall()
    return {
        "edge_id": edge["edge_id"],
        "name": edge["name"],
        "highway": edge["highway"],
        "length_m": edge["length_m"],
        "geometry": json.loads(edge["geometry_geojson"]),
        "mean_score": edge["mean_score"],
        "sample_count": edge["sample_count"],
        "samples": [
            {
                "sample_id": s["sample_id"],
                "lat": s["lat"],
                "lon": s["lon"],
                "images": json.loads(s["images_json"]) if s["images_json"] else [],
                "score": s["score"],
                "infrastructure": s["infrastructure"],
                "hazards": json.loads(s["hazards_json"]) if s["hazards_json"] else [],
                "reasons": json.loads(s["reasons_json"]) if s["reasons_json"] else [],
            }
            for s in samples
        ],
    }


def fetch_intersection_detail(conn: sqlite3.Connection, node_id: int) -> dict | None:
    row = conn.execute(
        """
        SELECT node_id, lat, lon, degree, intersection_type, osm_control,
               gemini_control, images_json, score, hazards_json, reasons_json
        FROM intersections WHERE node_id = ?
        """,
        (node_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "node_id": row["node_id"],
        "lat": row["lat"],
        "lon": row["lon"],
        "degree": row["degree"],
        "intersection_type": row["intersection_type"],
        "osm_control": row["osm_control"],
        "gemini_control": row["gemini_control"],
        "images": json.loads(row["images_json"]) if row["images_json"] else [],
        "score": row["score"],
        "hazards": json.loads(row["hazards_json"]) if row["hazards_json"] else [],
        "reasons": json.loads(row["reasons_json"]) if row["reasons_json"] else [],
    }
