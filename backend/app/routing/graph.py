"""NetworkX graph annotated with edge + intersection safety scores.

Edge cost model:
    cost_fast = length_m
    cost_safe = length_m * (1 + λ * (10 − edge_score) / 9)
              + intersection_penalty_m * (10 − dest_node_score) / 9   if dest is scored

Unscored edges fall back to a neutral score (5). The graph is built once at
startup and cached.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from functools import lru_cache

import networkx as nx
import osmnx as ox

from app.config import settings
from app.db.store import connect, fetch_intersection_scores

log = logging.getLogger(__name__)

NEUTRAL_SCORE = 5.0


@dataclass
class RoutedEdge:
    edge_id: str
    u: int
    v: int
    name: str | None
    length_m: float
    score: float | None
    intersection_score: float | None  # score of the destination node, if any
    geometry: dict


def _segment_cost(length_m: float, score: float | None, lam: float) -> float:
    s = score if score is not None else NEUTRAL_SCORE
    return length_m * (1.0 + lam * (10.0 - s) / 9.0)


def _intersection_addend(score: float | None, penalty_m: float) -> float:
    if score is None:
        return 0.0
    return penalty_m * (10.0 - score) / 9.0


@lru_cache(maxsize=1)
def load_graph() -> nx.MultiDiGraph:
    log.info("Loading OSM graph for routing…")
    n, s, e, w = settings.bbox
    g = ox.graph_from_bbox(bbox=(w, s, e, n), network_type="bike", simplify=True, retain_all=False)

    log.info("Loading edge + intersection scores from DB…")
    with connect(settings.db_path) as conn:
        edge_rows = conn.execute("SELECT edge_id, mean_score FROM edge_scores").fetchall()
        edge_scores = {r["edge_id"]: r["mean_score"] for r in edge_rows}
        intersection_scores = fetch_intersection_scores(conn)

    lam = settings.safety_lambda
    pen = settings.intersection_penalty_m
    annotated_edges = annotated_isects = 0

    for u, v, key, data in g.edges(keys=True, data=True):
        edge_id = f"{u}-{v}-{key}"
        score = edge_scores.get(edge_id)
        length_m = float(data.get("length", 0.0))
        dest_score = intersection_scores.get(int(v))
        seg_cost = _segment_cost(length_m, score, lam)
        isect_addend = _intersection_addend(dest_score, pen)

        data["edge_id"] = edge_id
        data["safety_score"] = score
        data["dest_intersection_score"] = dest_score
        data["cost_fast"] = length_m
        data["cost_safe"] = seg_cost + isect_addend

        if score is not None:
            annotated_edges += 1
        if dest_score is not None:
            annotated_isects += 1

    log.info(
        "Annotated %d/%d edges with safety; %d edges enter scored intersections",
        annotated_edges, g.number_of_edges(), annotated_isects,
    )
    return g


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def nearest_node(g: nx.MultiDiGraph, lat: float, lon: float) -> int:
    best_node = None
    best_dist = float("inf")
    for node, data in g.nodes(data=True):
        d = _haversine(lat, lon, data["y"], data["x"])
        if d < best_dist:
            best_dist = d
            best_node = node
    if best_node is None:
        raise ValueError("Empty graph")
    return best_node


def route_path(
    g: nx.MultiDiGraph, start_lat: float, start_lon: float, end_lat: float, end_lon: float, weight: str
) -> list[RoutedEdge]:
    src = nearest_node(g, start_lat, start_lon)
    dst = nearest_node(g, end_lat, end_lon)
    nodes = nx.shortest_path(g, src, dst, weight=weight)
    out: list[RoutedEdge] = []
    for u, v in zip(nodes[:-1], nodes[1:]):
        edges = g.get_edge_data(u, v) or {}
        if not edges:
            continue
        best_key, best_data = min(edges.items(), key=lambda kv: kv[1].get(weight, float("inf")))
        geom = best_data.get("geometry")
        if geom is not None:
            geometry = {"type": "LineString", "coordinates": list(geom.coords)}
        else:
            pu, pv = g.nodes[u], g.nodes[v]
            geometry = {"type": "LineString", "coordinates": [[pu["x"], pu["y"]], [pv["x"], pv["y"]]]}
        name = best_data.get("name")
        if isinstance(name, list):
            name = ", ".join(str(n) for n in name)
        out.append(RoutedEdge(
            edge_id=best_data.get("edge_id", f"{u}-{v}-{best_key}"),
            u=u,
            v=v,
            name=name,
            length_m=float(best_data.get("length", 0.0)),
            score=best_data.get("safety_score"),
            intersection_score=best_data.get("dest_intersection_score"),
            geometry=geometry,
        ))
    return out


def route_summary(edges: list[RoutedEdge]) -> dict:
    total_m = sum(e.length_m for e in edges)
    scored = [e for e in edges if e.score is not None]
    weighted_score = (
        sum(e.score * e.length_m for e in scored) / sum(e.length_m for e in scored)
        if scored else None
    )
    isect_scored = [e for e in edges if e.intersection_score is not None]
    weighted_isect = (
        sum(e.intersection_score for e in isect_scored) / len(isect_scored)
        if isect_scored else None
    )
    return {
        "length_m": total_m,
        "weighted_safety_score": weighted_score,
        "scored_fraction": (sum(e.length_m for e in scored) / total_m) if total_m else 0.0,
        "intersections_traversed": len(isect_scored),
        "mean_intersection_score": weighted_isect,
    }
