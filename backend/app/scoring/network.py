"""OSM network extraction + sampling for Davis bikeable roads."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable

import networkx as nx
import osmnx as ox
from shapely.geometry import LineString, Point, mapping

from app.config import settings
from app.db.store import connect, init_db, upsert_edge, upsert_intersection_meta

EXCLUDED_HIGHWAY = {"motorway", "motorway_link", "trunk", "trunk_link"}

# Per-sample heading offsets relative to the direction of travel along the edge.
# 0  = forward (traffic + infrastructure ahead)
# 90 = right (door zone, parked cars, bike lane stripe, shoulder)
EDGE_SAMPLE_OFFSETS = (0, 90)

# Intersection samples shoot 4 cardinal directions relative to north.
INTERSECTION_HEADINGS = (0, 90, 180, 270)


@dataclass
class SamplePoint:
    """A single edge sample location with one or more headings to fetch."""

    edge_id: str
    lat: float
    lon: float
    headings: list[float] = field(default_factory=list)


@dataclass
class IntersectionSample:
    node_id: int
    lat: float
    lon: float
    degree: int
    headings: list[float] = field(default_factory=list)


def edge_id_for(u: int, v: int, key: int) -> str:
    return f"{u}-{v}-{key}"


def _is_bikeable(data: dict) -> bool:
    hwy = data.get("highway")
    if isinstance(hwy, list):
        return not any(h in EXCLUDED_HIGHWAY for h in hwy)
    return hwy not in EXCLUDED_HIGHWAY


def _bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Compass bearing from a to b (lon, lat tuples)."""
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def download_davis_graph() -> nx.MultiDiGraph:
    n, s, e, w = settings.bbox
    return ox.graph_from_bbox(
        bbox=(w, s, e, n),
        network_type="bike",
        simplify=True,
        retain_all=False,
    )


def _ensure_edge_geometry(graph: nx.MultiDiGraph, u: int, v: int, data: dict) -> LineString:
    geom = data.get("geometry")
    if geom is not None:
        return geom
    pt_u = (graph.nodes[u]["x"], graph.nodes[u]["y"])
    pt_v = (graph.nodes[v]["x"], graph.nodes[v]["y"])
    return LineString([pt_u, pt_v])


def persist_graph(graph: nx.MultiDiGraph) -> int:
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
    graph: nx.MultiDiGraph,
    u: int,
    v: int,
    key: int,
    interval_m: float,
    heading_offsets: tuple[float, ...] = EDGE_SAMPLE_OFFSETS,
) -> list[SamplePoint]:
    data = graph.get_edge_data(u, v, key)
    if data is None or not _is_bikeable(data):
        return []
    geom = _ensure_edge_geometry(graph, u, v, data)
    length_m = float(data.get("length", 0.0))
    if length_m <= 0:
        return []

    eid = edge_id_for(u, v, key)
    n_samples = max(1, int(round(length_m / interval_m)))
    samples: list[SamplePoint] = []
    for i in range(n_samples):
        frac = (i + 0.5) / n_samples
        pt: Point = geom.interpolate(frac, normalized=True)
        bear_pt = geom.interpolate(min(1.0, frac + 0.01), normalized=True)
        forward = _bearing((pt.x, pt.y), (bear_pt.x, bear_pt.y))
        headings = [(forward + off) % 360.0 for off in heading_offsets]
        samples.append(SamplePoint(edge_id=eid, lat=pt.y, lon=pt.x, headings=headings))
    return samples


def all_sample_points(
    graph: nx.MultiDiGraph, interval_m: float | None = None
) -> Iterable[SamplePoint]:
    interval = interval_m or settings.sample_interval_m
    for u, v, key, data in graph.edges(keys=True, data=True):
        if not _is_bikeable(data):
            continue
        yield from sample_points_along_edge(graph, u, v, key, interval)


def intersection_samples(
    graph: nx.MultiDiGraph, min_degree: int = 3
) -> list[IntersectionSample]:
    """Find OSM nodes that are 3+ way intersections of bikeable roads.

    Uses the undirected representation so a 4-way intersection isn't double-counted
    as 8 directed edges.
    """
    undirected = graph.to_undirected()
    init_db(settings.db_path)

    out: list[IntersectionSample] = []
    with connect(settings.db_path) as conn:
        for node, data in undirected.nodes(data=True):
            # Count distinct neighbors via bikeable edges only.
            neighbors = set()
            for nbr in undirected.neighbors(node):
                edge_data = undirected.get_edge_data(node, nbr) or {}
                if any(_is_bikeable(d) for d in edge_data.values()):
                    neighbors.add(nbr)
            if len(neighbors) < min_degree:
                continue
            lat = float(data["y"])
            lon = float(data["x"])
            degree = len(neighbors)
            upsert_intersection_meta(conn, node, lat, lon, degree)
            out.append(
                IntersectionSample(
                    node_id=int(node),
                    lat=lat,
                    lon=lon,
                    degree=degree,
                    headings=list(INTERSECTION_HEADINGS),
                )
            )
    return out
