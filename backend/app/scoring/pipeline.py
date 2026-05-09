"""End-to-end scoring pipeline.

Run with:
    python -m app.scoring.pipeline extract     # download Davis network → DB
    python -m app.scoring.pipeline score       # sample + Street View + Gemini
    python -m app.scoring.pipeline aggregate   # recompute per-edge mean scores
    python -m app.scoring.pipeline all         # all three in order
"""

from __future__ import annotations

import argparse
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from tqdm import tqdm

from app.config import settings
from app.db.store import (
    already_scored_edges,
    connect,
    init_db,
    insert_sample,
    recompute_edge_scores,
)
from app.scoring import gemini, network, streetview

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def cmd_extract() -> None:
    log.info("Downloading Davis OSM network…")
    g = network.download_davis_graph()
    n_nodes = g.number_of_nodes()
    n_edges = g.number_of_edges()
    log.info("Graph: %d nodes, %d edges. Persisting bikeable edges…", n_nodes, n_edges)
    persisted = network.persist_graph(g)
    log.info("Persisted %d bikeable edges to %s", persisted, settings.db_path)


def _score_one_sample(sv_client, gem_client, sample) -> dict | None:
    """Resolve metadata → fetch image → call Gemini. Returns row dict or None on skip."""
    meta = streetview.metadata(sv_client, sample.lat, sample.lon)
    if meta is None:
        return {
            "edge_id": sample.edge_id,
            "lat": sample.lat,
            "lon": sample.lon,
            "heading": sample.heading,
            "pano_id": None,
            "image_path": None,
            "score": None,
            "hazards": ["no_streetview"],
            "reasons": ["No Street View imagery available within 50m"],
            "raw": None,
        }
    image_path = streetview.fetch_image(sv_client, meta.pano_id, sample.heading)
    assessment = gemini.score_image(gem_client, image_path)
    return {
        "edge_id": sample.edge_id,
        "lat": sample.lat,
        "lon": sample.lon,
        "heading": sample.heading,
        "pano_id": meta.pano_id,
        "image_path": str(image_path),
        "score": assessment.score,
        "hazards": assessment.hazards,
        "reasons": assessment.reasons,
        "raw": assessment.raw,
    }


def cmd_score(max_edges: int | None = None, workers: int = 4, force: bool = False) -> None:
    init_db(settings.db_path)
    log.info("Loading network for sampling…")
    g = network.download_davis_graph()
    network.persist_graph(g)

    with connect(settings.db_path) as conn:
        scored = set() if force else already_scored_edges(conn)

    log.info("Generating sample points (skipping %d already-scored edges)…", len(scored))
    samples = []
    seen_edges: set[str] = set()
    for s in network.all_sample_points(g, settings.sample_interval_m):
        if s.edge_id in scored:
            continue
        samples.append(s)
        seen_edges.add(s.edge_id)
        if max_edges is not None and len(seen_edges) >= max_edges:
            break

    log.info("Will score %d samples across %d edges", len(samples), len(seen_edges))
    sv_client = streetview.make_client()
    gem_client = gemini.make_client()

    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_score_one_sample, sv_client, gem_client, s) for s in samples]
        for fut in tqdm(as_completed(futures), total=len(futures), desc="scoring"):
            try:
                row = fut.result()
            except Exception as exc:  # noqa: BLE001 — log and continue
                log.warning("sample failed: %s", exc)
                continue
            if row is not None:
                results.append(row)

    log.info("Persisting %d sample results…", len(results))
    with connect(settings.db_path) as conn:
        for r in results:
            insert_sample(
                conn,
                edge_id=r["edge_id"],
                lat=r["lat"],
                lon=r["lon"],
                heading=r["heading"],
                pano_id=r["pano_id"],
                image_path=r["image_path"],
                score=r["score"],
                hazards=r["hazards"],
                reasons=r["reasons"],
                raw_response=r["raw"],
            )
        n = recompute_edge_scores(conn)
    log.info("Recomputed %d edge mean scores", n)


def cmd_aggregate() -> None:
    with connect(settings.db_path) as conn:
        n = recompute_edge_scores(conn)
    log.info("Recomputed %d edge mean scores", n)


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("extract")
    p_score = sub.add_parser("score")
    p_score.add_argument("--max-edges", type=int, default=None,
                         help="Cap number of edges to score this run (useful for incremental runs).")
    p_score.add_argument("--workers", type=int, default=4)
    p_score.add_argument("--force", action="store_true",
                         help="Re-score edges that already have scored samples.")
    sub.add_parser("aggregate")
    sub.add_parser("all")
    args = parser.parse_args()

    if args.cmd == "extract":
        cmd_extract()
    elif args.cmd == "score":
        cmd_score(max_edges=args.max_edges, workers=args.workers, force=args.force)
    elif args.cmd == "aggregate":
        cmd_aggregate()
    elif args.cmd == "all":
        cmd_extract()
        cmd_score()
        cmd_aggregate()


if __name__ == "__main__":
    main()
