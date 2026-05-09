"""OSM network extraction for Davis bikeable roads.

Strategy: pull the drivable + cycleable network so we capture roads bikes legally
share with cars (most of Davis's grid). We exclude motorways/trunk and freeway
ramps. Each edge becomes a row in the `edges` table with a stable edge_id.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable

import networkx as nx
import osmnx as ox
from shapely.geometry import LineString, Point, mapping

from app.config import settings
from app.db.store import connect, init_db, upsert_edge

# Tags we consider non-bikeable (highway-like, freeway ramps).
EXCLUDED_HIGHWAY = {"motorway", "motorway_link", "trunk", "trunk_link"}


@dataclass
class SamplePoint:
    edge_id: str
    lat: float
    lon: float
    heading: float  # bearing along the edge in degrees


def edge_id_for(u: int, v: int, key: int) -> str:
    return f"{u}-{v}-{key}"


def _is_bikeable(data: dict) -> bool:
    hwy = data.get("highway")
    if isinstance(hwy, list):
        return not any(h in EXCLUDED_HIGHWAY for h in hwy)
    return hwy not in EXCLUDED_HIGHWAY


def _bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Return compass bearing (0–360) from a to b given (lon, lat) tuples."""
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def download_davis_graph() -> nx.MultiDiGraph:
    """Download Davis OSM network. Uses 'bike' network type for bike-relevant edges."""
    bbox = settings.bbox  # (north, south, east, west)
    # OSMnx 2.x signature: bbox=(left, bottom, right, top) i.e. (west, south, east, north)
    n, s, e, w = bbox
    graph = ox.graph_from_bbox(
        bbox=(w, s, e, n),
        network_type="bike",
        simplify=True,
        retain_all=False,
    )
    # Ensure edges have geometry attribute (OSMnx leaves straight edges without one).
    graph = ox.utils_graph.get_undirected(graph) if False else graph
    return graph


def _ensure_edge_geometry(graph: nx.MultiDiGraph, u: int, v: int, data: dict) -> LineString:
    geom = data.get("geometry")
    if geom is not None:
        return geom
    pt_u = (graph.nodes[u]["x"], graph.nodes[u]["y"])
    pt_v = (graph.nodes[v]["x"], graph.nodes[v]["y"])
    return LineString([pt_u, pt_v])


def persist_graph(graph: nx.MultiDiGraph) -> int:
    """Write all bikeable edges to the DB. Returns the count of edges persisted."""
    init_db(settings.db_path)
    count = 0
    with connect(settings.db_path) as conn:
        for u, v, key, data in graph.edges(keys=True, data=True):
            if not _is_bikeable(data):
                continue
            geom = _ensure_edge_geometry(graph, u, v, data)
            length_m = float(data.get("length", geom.length))
            highway = data.get("highway")
            if isinstance(highway, list):
                highway = ",".join(highway)
            name = data.get("name")
            if isinstance(name, list):
                name = ", ".join(str(n) for n in name)
            upsert_edge(
                conn,
                edge_id=edge_id_for(u, v, key),
                u=u,
                v=v,
                key=key,
                name=name,
                highway=highway,
                length_m=length_m,
                geometry_geojson=mapping(geom),
                osm_tags={
                    k: v
                    for k, v in data.items()
                    if k in {"oneway", "lanes", "maxspeed", "cycleway", "bicycle", "surface"}
                },
            )
            count += 1
    return count


def sample_points_along_edge(
    graph: nx.MultiDiGraph, u: int, v: int, key: int, interval_m: float
) -> list[SamplePoint]:
    """Sample points along an edge at regular intervals.

    Uses Shapely's interpolate on the geographic coords; for Davis (small extent),
    converting meters → degrees via a flat approximation is sufficient.
    """
    data = graph.get_edge_data(u, v, key)
    if data is None or not _is_bikeable(data):
        return []
    geom = _ensure_edge_geometry(graph, u, v, data)
    length_m = float(data.get("length", 0.0))
    if length_m <= 0:
        return []

    eid = edge_id_for(u, v, key)
    # Place samples at midpoints of equal segments.
    n_samples = max(1, int(round(length_m / interval_m)))
    samples: list[SamplePoint] = []
    for i in range(n_samples):
        frac = (i + 0.5) / n_samples
        # interpolate uses the LineString's coordinate units (degrees) — convert
        # length-fraction by walking the line.
        pt: Point = geom.interpolate(frac, normalized=True)
        # bearing from previous point along the line; use a small offset for direction
        bear_pt = geom.interpolate(min(1.0, frac + 0.01), normalized=True)
        heading = _bearing((pt.x, pt.y), (bear_pt.x, bear_pt.y))
        samples.append(
            SamplePoint(edge_id=eid, lat=pt.y, lon=pt.x, heading=heading)
        )
    return samples


def all_sample_points(
    graph: nx.MultiDiGraph, interval_m: float | None = None
) -> Iterable[SamplePoint]:
    interval = interval_m or settings.sample_interval_m
    for u, v, key, data in graph.edges(keys=True, data=True):
        if not _is_bikeable(data):
            continue
        yield from sample_points_along_edge(graph, u, v, key, interval)
