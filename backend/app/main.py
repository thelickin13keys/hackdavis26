from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.config import settings
from app.db.store import (
    connect,
    fetch_all_intersections,
    fetch_edge_detail,
    fetch_intersection_detail,
    fetch_scored_edges,
    init_db,
)
from app.routing.graph import load_graph, route_path, route_summary
from app.scoring.geocoding import geocode

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)

app = FastAPI(title="SafeBike Davis", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db(settings.db_path)
    try:
        load_graph()
    except Exception as exc:  # noqa: BLE001
        log.warning("Routing graph not yet available: %s", exc)


# Serve the standalone demo UI at /demo/. Resolved relative to this file so it
# works whether uvicorn is launched from backend/ or the repo root.
_DEMO_DIR = Path(__file__).resolve().parents[2] / "demo"
if _DEMO_DIR.is_dir():
    app.mount("/demo", StaticFiles(directory=str(_DEMO_DIR), html=True), name="demo")
else:
    log.warning("Demo dir not found at %s; /demo will 404", _DEMO_DIR)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/scores")
def scores_geojson() -> dict:
    """All bikeable edges as GeoJSON FeatureCollection with safety scores."""
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


@app.get("/intersections")
def intersections_geojson() -> dict:
    """All scored intersections as GeoJSON Points."""
    with connect(settings.db_path) as conn:
        rows = fetch_all_intersections(conn)
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
            "properties": {
                "node_id": r["node_id"],
                "degree": r["degree"],
                "score": r["score"],
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
        "safe": {"edges": [e.__dict__ for e in safe], "summary": route_summary(safe)},
        "fast": {"edges": [e.__dict__ for e in fast], "summary": route_summary(fast)},
    }


@app.get("/edge/{edge_id}")
def edge_detail(edge_id: str) -> dict:
    with connect(settings.db_path) as conn:
        detail = fetch_edge_detail(conn, edge_id)
    if detail is None:
        raise HTTPException(404, f"Edge {edge_id} not found")
    return detail


@app.get("/intersection/{node_id}")
def intersection_detail(node_id: int) -> dict:
    with connect(settings.db_path) as conn:
        detail = fetch_intersection_detail(conn, node_id)
    if detail is None:
        raise HTTPException(404, f"Intersection {node_id} not found")
    return detail


@app.get("/geocode")
def geocode_endpoint(q: str = Query(..., min_length=2)) -> dict:
    """Address → lat/lon, biased to Davis bbox."""
    if not settings.google_maps_api_key:
        raise HTTPException(503, "GOOGLE_MAPS_API_KEY not configured")
    with httpx.Client() as client:
        result = geocode(client, q)
    if result is None:
        raise HTTPException(404, "No geocoding result")
    return {
        "lat": result.lat,
        "lon": result.lon,
        "formatted_address": result.formatted_address,
    }


@app.get("/image")
def image(path: str = Query(..., description="Image path returned by /edge/{id}")) -> FileResponse:
    p = Path(path).resolve()
    cache = settings.image_cache_dir.resolve()
    if cache not in p.parents and p.parent != cache:
        raise HTTPException(403, "Path outside image cache")
    if not p.exists():
        raise HTTPException(404, "Image not cached")
    return FileResponse(p, media_type="image/jpeg")


# --- Demo "agent walking" stream -------------------------------------------------
#
# Streams Server-Sent Events to animate a virtual cyclist progressing along the
# safest route. Frontend subscribes to /demo/walk via EventSource and receives
# one event per edge with the edge's geometry, score, and a sample image. Each
# event is delayed by `step_ms` so the UI can animate in real time.

class WalkRequest(BaseModel):
    start_lat: float
    start_lon: float
    end_lat: float
    end_lon: float
    weight: str = "cost_safe"  # "cost_safe" or "cost_fast"
    step_ms: int = 600


def _format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.post("/demo/walk")
async def demo_walk(req: WalkRequest) -> StreamingResponse:
    g = load_graph()

    async def stream():
        edges = route_path(
            g, req.start_lat, req.start_lon, req.end_lat, req.end_lon,
            "cost_safe" if req.weight not in ("cost_safe", "cost_fast") else req.weight,
        )
        summary = route_summary(edges)
        yield _format_sse("start", {
            "weight": req.weight,
            "edge_count": len(edges),
            "summary": summary,
        })

        with connect(settings.db_path) as conn:
            for i, e in enumerate(edges):
                detail = fetch_edge_detail(conn, e.edge_id)
                sample_image = None
                hazards: list[str] = []
                reasons: list[str] = []
                if detail and detail["samples"]:
                    s0 = detail["samples"][0]
                    if s0.get("images"):
                        sample_image = s0["images"][0].get("image_path")
                    hazards = s0.get("hazards") or []
                    reasons = s0.get("reasons") or []
                yield _format_sse("step", {
                    "i": i,
                    "edge_id": e.edge_id,
                    "name": e.name,
                    "length_m": e.length_m,
                    "score": e.score,
                    "intersection_score": e.intersection_score,
                    # 'gemini' = scored from photos; 'heuristic' = derived from
                    # OSM tags + leg geometry; null = not an intersection.
                    "intersection_source": e.intersection_source,
                    "geometry": e.geometry,
                    "image_path": sample_image,
                    "hazards": hazards,
                    "reasons": reasons[:2],
                })
                await asyncio.sleep(max(0, req.step_ms) / 1000.0)

        yield _format_sse("done", {"summary": summary})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable proxy buffering so events arrive in real time
        },
    )
