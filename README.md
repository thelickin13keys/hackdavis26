# Aggie Street Smarts

AI-powered bike routing that prioritizes safety over speed. Built for HackDavis 2026.

A vision-language model "walks" Davis on Google Street View, scoring every road segment and intersection for cyclist safety. Those scores feed a custom Dijkstra weight so the router can detour around scary streets instead of just minimizing distance. Riders see a color-coded route, a letter-grade safety summary, and a live "agent ride" preview of the trip via cached Street View frames.

```
┌────────────────┐   POST /route    ┌──────────────────────┐   per-edge weights   ┌─────────────────┐
│ web (Next.js)  │ ───────────────► │ backend (FastAPI)    │ ───────────────────► │ NetworkX graph  │
│  Mapbox GL JS  │ ◄─────────────── │  routing + scoring   │ ◄─── Gemini scores ──│  +OSMnx + OSM   │
└────────────────┘  safe/fast/λs    └──────────────────────┘                      └─────────────────┘
       ▲                                       ▲
       │                                       │
       └──── /demo/walk (SSE) ─── agent walk ──┘
```

## Layout

| Path        | What's there |
|-------------|--------------|
| `backend/`  | FastAPI app, scoring pipeline (`app.scoring`), routing graph (`app.routing`), SQLite store. |
| `web/`      | Next.js 16 frontend. Map canvas, side panel, route reasoning panel, Street-View tour. |
| `demo/`     | Standalone single-page demo UIs (`index.html`, `coverage.html`) served at `/demo/` by the backend. |
| `product.md`, `design.md` | Product brief and UI design notes. |

## Prerequisites

- **Python 3.11+** with [`uv`](https://docs.astral.sh/uv/) for the backend.
- **Node 20+** for the web app.
- **Mapbox token** — required for the map, geocoding, and Mapbox Directions fallback.
- **Google Maps API key** — Street View Static + Metadata APIs enabled. Metadata is used as a free presence-check before paying for the static image.
- **Gemini API key** — defaults to `gemini-3-flash-preview`, override with `GEMINI_MODEL`.

## Backend

```bash
cd backend
cp ../.env.example .env       # or hand-edit
uv sync
uv run uvicorn app.main:app --reload
```

`.env` keys (read by `app.config.Settings`):

```
GOOGLE_MAPS_API_KEY=...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3-flash-preview          # optional override
DAVIS_BBOX_NORTH=38.580
DAVIS_BBOX_SOUTH=38.520
DAVIS_BBOX_EAST=-121.690
DAVIS_BBOX_WEST=-121.790
SAMPLE_INTERVAL_M=80                          # sample spacing along each edge
STREETVIEW_RADIUS_M=100                       # Street View search radius
SAFETY_LAMBDA=0.5                             # default safety detour aggressiveness
INTERSECTION_PENALTY_M=60                     # per-scary-intersection "felt distance" added
```

### Scoring pipeline

Run from `backend/`:

```bash
uv run python -m app.scoring.pipeline extract            # download Davis bike network from OSM
uv run python -m app.scoring.pipeline score-edges        # multi-heading Street View + Gemini scoring
uv run python -m app.scoring.pipeline score-intersections
uv run python -m app.scoring.pipeline classify-intersections   # backfill OSM tag classification
uv run python -m app.scoring.pipeline aggregate          # recompute edge-level mean scores
uv run python -m app.scoring.pipeline all                # extract → score everything → aggregate
```

Useful flags on `score-edges` / `score-intersections`:

- `--bbox W,S,E,N` — restrict scoring to a sub-bbox of Davis.
- `--max-edges N` / `--max-nodes N` — cap work for quick iteration.
- `--workers 4` — concurrent Gemini calls. Higher numbers hit rate limits on `gemini-3-flash-preview`.
- `--force` — re-score even if a row already exists. Writes are incremental upserts (`INSERT … ON CONFLICT DO UPDATE`), so old data stays in place until each new score lands — a crash leaves no gaps.

Cached artifacts:

- `backend/data/safebike.db` — SQLite store (edges, samples, intersections, edge_scores).
- `backend/data/images/` — Street View JPEGs, named by content hash so they're reused across re-runs.

### Useful endpoints

| Method/Path              | Purpose |
|--------------------------|---------|
| `POST /route`            | Safest + fastest routes (plus `extra_lambdas` variants). |
| `GET /scores`            | All scored edges as GeoJSON, for the coverage map / safety overlay. |
| `GET /intersections`     | Intersection scores + OSM control + geometric type. |
| `GET /edge/{id}`         | Per-sample detail with images, hazards, infrastructure tags. |
| `GET /demo/walk?...`     | SSE stream that "walks" the safest route, emitting per-edge `step` events and `alert` toasts. |
| `GET /image?path=...`    | Cached Street View JPEG by relative path. |
| `GET /geocode?q=...`     | Address → lat/lon via Google. |

## Web app

```bash
cd web
npm install
echo "NEXT_PUBLIC_MAPBOX_TOKEN=pk.xxx" > .env.local
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" >> .env.local
npm run dev
```

Open <http://localhost:3000>. The page loads the SafePath safest/fastest routes alongside Mapbox Directions cycling variants, enriches everything with backend safety data, then re-sorts and re-names them as `Safest`, `Fastest`, `Alternative N`.

`.env.local` keys:

| Key | Default | What it does |
|-----|---------|--------------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` (or `…_API_KEY`) | — | Required for map tiles + Mapbox Directions + geocoding. |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend base URL. |
| `NEXT_PUBLIC_ENABLE_MAPBOX_ROUTES` | `true` | Set to `false`/`0`/`no` to drop Mapbox routes and use backend routing only. |
| `NEXT_PUBLIC_EXTRA_SAFETY_LAMBDAS` | `1.5,3.0` | Extra λ values for safety-Dijkstra variants. Empty string or `off` disables. Higher λ = safer but longer detours. |

## Standalone demo

Served by the backend at <http://localhost:8000/demo/>. Two pages:

- `/demo/index.html` — single-page SSE walk demo with route picker, safest/fastest toggle, and playback speed.
- `/demo/coverage.html` — coverage map showing which edges have been scored.

Pass `?token=pk.…` once to inject your Mapbox token.

## Scoring model in one paragraph

Per edge, the pipeline samples points every `SAMPLE_INTERVAL_M` along the polyline, grabs up to four Street View headings (forward + sides), and sends them to Gemini with the road's OSM tags as ground truth. Gemini returns a 1–10 safety score and an array of hazards with bounding boxes on a 0–1000 grid. Edge scores are the length-weighted mean of their samples. Intersections get the same treatment but use 4 cardinal-direction images plus OSM-tagged control type (signal/stop/uncontrolled) and a geometric classifier (T/Y/four-way/complex). Routing uses a callable Dijkstra weight: `length × (1 + λ × (10 − score) / 9) + intersection_penalty` — so a score-1 edge can "feel" up to `(1 + λ × 1) ×` longer than its actual length, and scary intersections add up to `INTERSECTION_PENALTY_M` extra "felt distance" to the entering edge.
