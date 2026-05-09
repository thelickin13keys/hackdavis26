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

CREATE TABLE IF NOT EXISTS samples (
    sample_id INTEGER PRIMARY KEY AUTOINCREMENT,
    edge_id TEXT NOT NULL REFERENCES edges(edge_id),
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    heading REAL,
    pano_id TEXT,
    image_path TEXT,
    score INTEGER,
    hazards_json TEXT,
    reasons_json TEXT,
    raw_response_json TEXT,
    scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(edge_id, lat, lon, heading)
);

CREATE INDEX IF NOT EXISTS idx_samples_edge ON samples(edge_id);

CREATE TABLE IF NOT EXISTS edge_scores (
    edge_id TEXT PRIMARY KEY REFERENCES edges(edge_id),
    mean_score REAL,
    sample_count INTEGER,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.executescript(SCHEMA)


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


def insert_sample(
    conn: sqlite3.Connection,
    edge_id: str,
    lat: float,
    lon: float,
    heading: float | None,
    pano_id: str | None,
    image_path: str | None,
    score: int | None,
    hazards: list | None,
    reasons: list | None,
    raw_response: dict | None,
) -> int:
    cur = conn.execute(
        """
        INSERT OR IGNORE INTO samples
            (edge_id, lat, lon, heading, pano_id, image_path, score,
             hazards_json, reasons_json, raw_response_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            edge_id,
            lat,
            lon,
            heading,
            pano_id,
            image_path,
            score,
            json.dumps(hazards) if hazards is not None else None,
            json.dumps(reasons) if reasons is not None else None,
            json.dumps(raw_response) if raw_response is not None else None,
        ),
    )
    return cur.lastrowid or 0


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


def already_scored_edges(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT DISTINCT edge_id FROM samples WHERE score IS NOT NULL"
    ).fetchall()
    return {r["edge_id"] for r in rows}


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
        SELECT sample_id, lat, lon, heading, pano_id, image_path,
               score, hazards_json, reasons_json
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
                "heading": s["heading"],
                "pano_id": s["pano_id"],
                "image_path": s["image_path"],
                "score": s["score"],
                "hazards": json.loads(s["hazards_json"]) if s["hazards_json"] else [],
                "reasons": json.loads(s["reasons_json"]) if s["reasons_json"] else [],
            }
            for s in samples
        ],
    }
