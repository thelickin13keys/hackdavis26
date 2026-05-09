"""Build a NetworkX graph annotated with safety scores from the DB.

Edge weighting:
    cost_safe = length_m * (1 + lambda * (10 - score) / 9)
    cost_fast = length_m

Where unscored edges fall back to a neutral score (5) so the router still uses them.
The graph is loaded once at startup and cached in-process.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from functools import lru_cache

import networkx as nx
import osmnx as ox

from app.config import settings
from app.db.store import connect

log = logging.getLogger(__name__)

NEUTRAL_SCORE = 5.0
UNSCORED_PENALTY = 0.0  # extra fractional cost for unscored edges; tune later


@dataclass
class RoutedEdge:
    edge_id: str
    u: int
    v: int
    name: str | None
    length_m: float
    score: float | None
    geometry: dict


def _safety_cost(length_m: float, score: float | None, lam: float) -> float:
    s = score if score is not None else NEUTRAL_SCORE
    # score ∈ [1, 10] → multiplier ∈ [1+lam, 1] (worse score → bigger cost)
    multiplier = 1.0 + lam * (10.0 - s) / 9.0
    if score is None:
        multiplier += UNSCORED_PENALTY
    return length_m * multiplier


@lru_cache(maxsize=1)
def load_graph() -> nx.MultiDiGraph:
    """Pull the OSM graph fresh from OSMnx, then attach DB-resident scores to edges.

    We rebuild the OSM graph rather than reconstruct from DB because OSMnx already
    gives us nodes with x/y coordinates and the directed edge semantics we need.
    """
    log.info("Loading OSM graph for routing…")
    n, s, e, w = settings.bbox
    g = ox.graph_from_bbox(bbox=(w, s, e, n), network_type="bike", simplify=True, retain_all=False)

    log.info("Loading edge scores from DB…")
    with connect(settings.db_path) as conn:
        rows = conn.execute(
            "SELECT edge_id, mean_score FROM edge_scores"
        ).fetchall()
        scores = {r["edge_id"]: r["mean_score"] for r in rows}

    lam = settings.safety_lambda
    annotated = 0
    for u, v, key, data in g.edges(keys=True, data=True):
        edge_id = f"{u}-{v}-{key}"
        score = scores.get(edge_id)
        length_m = float(data.get("length", 0.0))
        data["edge_id"] = edge_id
        data["safety_score"] = score
        data["cost_fast"] = length_m
        data["cost_safe"] = _safety_cost(length_m, score, lam)
        if score is not None:
            annotated += 1

    log.info("Annotated %d / %d edges with safety scores", annotated, g.number_of_edges())
    return g


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def nearest_node(g: nx.MultiDiGraph, lat: float, lon: float) -> int:
    """Linear scan — fine for Davis (~3k nodes). Swap for KD-tree if it gets slow."""
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
    """Compute shortest path under the given weight ('cost_safe' or 'cost_fast')."""
    src = nearest_node(g, start_lat, start_lon)
    dst = nearest_node(g, end_lat, end_lon)
    nodes = nx.shortest_path(g, src, dst, weight=weight)
    out: list[RoutedEdge] = []
    for u, v in zip(nodes[:-1], nodes[1:]):
        # MultiDiGraph: pick the edge with minimum weight between u→v.
        edges = g.get_edge_data(u, v) or {}
        if not edges:
            continue
        best_key, best_data = min(edges.items(), key=lambda kv: kv[1].get(weight, float("inf")))
        geom = best_data.get("geometry")
        if geom is not None:
            geometry = {
                "type": "LineString",
                "coordinates": list(geom.coords),
            }
        else:
            pu = g.nodes[u]
            pv = g.nodes[v]
            geometry = {
                "type": "LineString",
                "coordinates": [[pu["x"], pu["y"]], [pv["x"], pv["y"]]],
            }
        name = best_data.get("name")
        if isinstance(name, list):
            name = ", ".join(str(n) for n in name)
        out.append(
            RoutedEdge(
                edge_id=best_data.get("edge_id", f"{u}-{v}-{best_key}"),
                u=u,
                v=v,
                name=name,
                length_m=float(best_data.get("length", 0.0)),
                score=best_data.get("safety_score"),
                geometry=geometry,
            )
        )
    return out


def route_summary(edges: list[RoutedEdge]) -> dict:
    total_m = sum(e.length_m for e in edges)
    scored = [e for e in edges if e.score is not None]
    weighted_score = (
        sum(e.score * e.length_m for e in scored) / sum(e.length_m for e in scored)
        if scored
        else None
    )
    return {
        "length_m": total_m,
        "weighted_safety_score": weighted_score,
        "scored_fraction": (sum(e.length_m for e in scored) / total_m) if total_m else 0.0,
    }
