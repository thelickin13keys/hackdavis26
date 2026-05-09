"""End-to-end scoring pipeline.

Run with:
    python -m app.scoring.pipeline extract                # download Davis network
    python -m app.scoring.pipeline score-edges            # multi-heading edge scoring
    python -m app.scoring.pipeline score-intersections    # 4-way intersection scoring
    python -m app.scoring.pipeline aggregate              # recompute per-edge means
    python -m app.scoring.pipeline all                    # run everything
"""

from __future__ import annotations

import argparse
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx
from tqdm import tqdm

from app.config import settings
from app.db.store import (
    already_scored_edges,
    already_scored_intersections,
    connect,
    init_db,
    recompute_edge_scores,
    upsert_intersection_score,
    upsert_sample,
)
from app.scoring import gemini, network, streetview

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def cmd_extract() -> None:
    log.info("Downloading Davis OSM network…")
    g = network.download_davis_graph()
    log.info("Graph: %d nodes, %d edges", g.number_of_nodes(), g.number_of_edges())
    persisted = network.persist_graph(g)
    log.info("Persisted %d bikeable edges to %s", persisted, settings.db_path)
    nodes = network.intersection_samples(g)
    log.info("Identified %d intersections (degree>=3)", len(nodes))


def _fetch_images_for(
    sv_client: httpx.Client, lat: float, lon: float, headings: list[float]
) -> list[dict]:
    """Resolve metadata once, then fetch one image per heading. Returns image records."""
    meta = streetview.metadata(sv_client, lat, lon)
    if meta is None:
        return []
    images: list[dict] = []
    for h in headings:
        try:
            img_path = streetview.fetch_image(sv_client, meta.pano_id, h)
            images.append({"heading": h, "pano_id": meta.pano_id, "image_path": str(img_path)})
        except Exception as exc:  # noqa: BLE001
            log.warning("image fetch failed (pano=%s heading=%s): %s", meta.pano_id, h, exc)
    return images


def _score_edge_sample(sv_client, gem_client, sample) -> dict:
    images = _fetch_images_for(sv_client, sample.lat, sample.lon, sample.headings)
    if not images:
        return {
            "edge_id": sample.edge_id,
            "lat": sample.lat,
            "lon": sample.lon,
            "images": [],
            "score": None,
            "infrastructure": None,
            "hazards": ["no_streetview"],
            "reasons": ["No Street View imagery available within 50m"],
            "raw": None,
        }
    paths = [Path(im["image_path"]) for im in images]
    a = gemini.score_segment_images(gem_client, paths)
    return {
        "edge_id": sample.edge_id,
        "lat": sample.lat,
        "lon": sample.lon,
        "images": images,
        "score": a.score,
        "infrastructure": a.infrastructure,
        "hazards": a.hazards,
        "reasons": a.reasons,
        "raw": a.raw,
    }


def _score_intersection(sv_client, gem_client, isect) -> dict:
    images = _fetch_images_for(sv_client, isect.lat, isect.lon, isect.headings)
    if not images:
        return {
            "node_id": isect.node_id,
            "images": [],
            "score": None,
            "hazards": ["no_streetview"],
            "reasons": ["No Street View imagery at intersection"],
            "raw": None,
        }
    paths = [Path(im["image_path"]) for im in images]
    a = gemini.score_intersection_images(gem_client, paths)
    return {
        "node_id": isect.node_id,
        "images": images,
        "score": a.score,
        "hazards": a.hazards,
        "reasons": a.reasons,
        "raw": a.raw,
    }


def cmd_score_edges(max_edges: int | None, workers: int, force: bool) -> None:
    init_db(settings.db_path)
    log.info("Loading network…")
    g = network.download_davis_graph()
    network.persist_graph(g)

    with connect(settings.db_path) as conn:
        scored = set() if force else already_scored_edges(conn)

    samples: list = []
    seen_edges: set[str] = set()
    for s in network.all_sample_points(g, settings.sample_interval_m):
        if s.edge_id in scored:
            continue
        samples.append(s)
        seen_edges.add(s.edge_id)
        if max_edges is not None and len(seen_edges) >= max_edges:
            break

    log.info("Will score %d samples across %d edges (skip %d already-scored)",
             len(samples), len(seen_edges), len(scored))
    sv_client = streetview.make_client()
    gem_client = gemini.make_client()

    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_score_edge_sample, sv_client, gem_client, s) for s in samples]
        for fut in tqdm(as_completed(futures), total=len(futures), desc="edges"):
            try:
                results.append(fut.result())
            except Exception as exc:  # noqa: BLE001
                log.warning("edge sample failed: %s", exc)

    with connect(settings.db_path) as conn:
        for r in results:
            upsert_sample(
                conn,
                edge_id=r["edge_id"],
                lat=r["lat"],
                lon=r["lon"],
                images=r["images"],
                score=r["score"],
                infrastructure=r["infrastructure"],
                hazards=r["hazards"],
                reasons=r["reasons"],
                raw_response=r["raw"],
            )
        n = recompute_edge_scores(conn)
    log.info("Recomputed %d edge mean scores", n)


def cmd_score_intersections(max_nodes: int | None, workers: int, force: bool) -> None:
    init_db(settings.db_path)
    log.info("Loading network for intersection scan…")
    g = network.download_davis_graph()
    nodes = network.intersection_samples(g)

    with connect(settings.db_path) as conn:
        scored = set() if force else already_scored_intersections(conn)

    todo = [n for n in nodes if n.node_id not in scored]
    if max_nodes is not None:
        todo = todo[:max_nodes]
    log.info("Will score %d intersections (skip %d already-scored)", len(todo), len(scored))

    sv_client = streetview.make_client()
    gem_client = gemini.make_client()

    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_score_intersection, sv_client, gem_client, n) for n in todo]
        for fut in tqdm(as_completed(futures), total=len(futures), desc="intersections"):
            try:
                results.append(fut.result())
            except Exception as exc:  # noqa: BLE001
                log.warning("intersection failed: %s", exc)

    with connect(settings.db_path) as conn:
        for r in results:
            upsert_intersection_score(
                conn,
                node_id=r["node_id"],
                images=r["images"],
                score=r["score"],
                hazards=r["hazards"],
                reasons=r["reasons"],
                raw_response=r["raw"],
            )
    log.info("Persisted %d intersection scores", len(results))


def cmd_aggregate() -> None:
    with connect(settings.db_path) as conn:
        n = recompute_edge_scores(conn)
    log.info("Recomputed %d edge mean scores", n)


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("extract")

    p_e = sub.add_parser("score-edges")
    p_e.add_argument("--max-edges", type=int, default=None)
    p_e.add_argument("--workers", type=int, default=4)
    p_e.add_argument("--force", action="store_true")

    p_i = sub.add_parser("score-intersections")
    p_i.add_argument("--max-nodes", type=int, default=None)
    p_i.add_argument("--workers", type=int, default=4)
    p_i.add_argument("--force", action="store_true")

    sub.add_parser("aggregate")
    sub.add_parser("all")
    args = parser.parse_args()

    if args.cmd == "extract":
        cmd_extract()
    elif args.cmd == "score-edges":
        cmd_score_edges(args.max_edges, args.workers, args.force)
    elif args.cmd == "score-intersections":
        cmd_score_intersections(args.max_nodes, args.workers, args.force)
    elif args.cmd == "aggregate":
        cmd_aggregate()
    elif args.cmd == "all":
        cmd_extract()
        cmd_score_edges(None, 4, False)
        cmd_score_intersections(None, 4, False)
        cmd_aggregate()


if __name__ == "__main__":
    main()
