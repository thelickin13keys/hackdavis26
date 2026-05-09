from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import settings
from app.db.store import connect, fetch_edge_detail, fetch_scored_edges, init_db
from app.routing.graph import load_graph, route_path, route_summary

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="SafeBike Davis", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db(settings.db_path)
    # Warm the routing graph on startup so the first request isn't slow.
    try:
        load_graph()
    except Exception as exc:  # noqa: BLE001
        log.warning("Routing graph not yet available: %s", exc)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/scores")
def scores_geojson() -> dict:
    """Return all bikeable edges as GeoJSON FeatureCollection with safety scores."""
    with connect(settings.db_path) as conn:
        rows = fetch_scored_edges(conn)
    features = [
        {
            "type": "Feature",
            "geometry": r["geometry"],
            "properties": {
                "edge_id": r["edge_id"],
                "name": r["name"],
                "highway": r["highway"],
                "length_m": r["length_m"],
                "score": r["mean_score"],
                "sample_count": r["sample_count"] or 0,
            },
        }
        for r in rows
    ]
    return {"type": "FeatureCollection", "features": features}


class RouteRequest(BaseModel):
    start_lat: float
    start_lon: float
    end_lat: float
    end_lon: float


@app.post("/route")
def route(req: RouteRequest) -> dict:
    g = load_graph()
    safe = route_path(g, req.start_lat, req.start_lon, req.end_lat, req.end_lon, "cost_safe")
    fast = route_path(g, req.start_lat, req.start_lon, req.end_lat, req.end_lon, "cost_fast")
    return {
        "safe": {
            "edges": [e.__dict__ for e in safe],
            "summary": route_summary(safe),
        },
        "fast": {
            "edges": [e.__dict__ for e in fast],
            "summary": route_summary(fast),
        },
    }


@app.get("/edge/{edge_id}")
def edge_detail(edge_id: str) -> dict:
    with connect(settings.db_path) as conn:
        detail = fetch_edge_detail(conn, edge_id)
    if detail is None:
        raise HTTPException(404, f"Edge {edge_id} not found")
    return detail


@app.get("/image")
def image(path: str = Query(..., description="Image path returned by /edge/{id}")) -> FileResponse:
    """Serve a cached Street View image. Path must be inside the cache dir."""
    p = Path(path).resolve()
    cache = settings.image_cache_dir.resolve()
    if cache not in p.parents and p.parent != cache:
        raise HTTPException(403, "Path outside image cache")
    if not p.exists():
        raise HTTPException(404, "Image not cached")
    return FileResponse(p, media_type="image/jpeg")
