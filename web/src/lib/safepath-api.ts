/**
 * Typed client for the SafePath backend (FastAPI service in /backend).
 *
 * Set NEXT_PUBLIC_API_URL to override the default localhost:8000 base.
 * The backend's CORS middleware allows all origins, so this is a plain
 * cross-origin fetch — no proxy needed.
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------- Types matching the backend response shape ---------------------

export type RouteEdge = {
  edge_id: string;
  u: number;
  v: number;
  name: string | null;
  length_m: number;
  /** Length-weighted mean of Gemini-derived sample scores, 1–10. Null if no
   *  scored samples on this edge (it'll typically still be inferred elsewhere). */
  score: number | null;
  /** Score of the destination intersection (Gemini or heuristic). 1–10 or null. */
  intersection_score: number | null;
  intersection_source: "gemini" | "heuristic" | null;
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
};

export type RouteSummary = {
  length_m: number;
  weighted_safety_score: number | null;
  scored_fraction: number;
  intersections_traversed: number;
  mean_intersection_score: number | null;
};

export type RouteResult = {
  edges: RouteEdge[];
  summary: RouteSummary;
};

/** A safety-lambda variant from /route. λ controls how much the router will
 *  detour to avoid low-score edges. Higher λ = more aggressive safety
 *  optimization at the cost of distance/time. */
export type RouteVariant = {
  lambda: number;
  edges: RouteEdge[];
  summary: RouteSummary;
};

export type RouteResponse = {
  safe: RouteResult;
  fast: RouteResult;
  /** Empty unless extra_lambdas was passed in the request. */
  variants: RouteVariant[];
};

export type Hazard = {
  type: string;
  severity: number;
  image_index: number;
  /** [ymin, xmin, ymax, xmax] on a 0–1000 grid normalized to image dimensions. */
  bbox?: [number, number, number, number];
  /** [y, x] on the same 0–1000 grid (single-point feature). */
  point?: [number, number];
  note?: string;
};

export type EdgeSampleImage = {
  heading: number;
  pano_id: string;
  image_path: string;
};

export type EdgeSample = {
  sample_id: number;
  lat: number;
  lon: number;
  images: EdgeSampleImage[];
  score: number | null;
  infrastructure: string | null;
  hazards: Hazard[];
  reasons: string[];
};

export type EdgeDetail = {
  edge_id: string;
  name: string | null;
  highway: string | null;
  length_m: number;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  mean_score: number | null;
  sample_count: number | null;
  samples: EdgeSample[];
};

export type GeocodeResult = {
  lat: number;
  lon: number;
  formatted_address: string;
};

/** GeoJSON FeatureCollection returned by /scores. Every bikeable edge is
 *  included; `score` is null for edges with no Gemini-measured samples and
 *  no inferred fallback. `sample_count` is 0 for inferred edges and >0 for
 *  measured ones — useful when displaying "verified" badges. */
export type ScoreFeature = {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: {
    edge_id: string;
    name: string | null;
    highway: string | null;
    length_m: number;
    score: number | null;
    sample_count: number;
  };
};

export type ScoresFC = {
  type: "FeatureCollection";
  features: ScoreFeature[];
};

/** GeoJSON Point feature for one intersection node from /intersections.
 *  `intersection_type` is the geometric shape (t/y/four_way/complex);
 *  `osm_control` is the raw OSM tag (traffic_signals/stop/...) and is
 *  authoritative when present; `gemini_control` is what the model thought
 *  from photos. */
export type IntersectionFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    node_id: number;
    degree: number;
    intersection_type: "t" | "y" | "four_way" | "complex" | null;
    osm_control:
      | "traffic_signals"
      | "stop"
      | "give_way"
      | "crossing"
      | "mini_roundabout"
      | "turning_loop"
      | "motorway_junction"
      | string
      | null;
    gemini_control:
      | "signal"
      | "signal_with_bike_phase"
      | "all_way_stop"
      | "stop"
      | "yield"
      | "uncontrolled"
      | "roundabout"
      | "unknown"
      | string
      | null;
    score: number | null;
  };
};

export type IntersectionsFC = {
  type: "FeatureCollection";
  features: IntersectionFeature[];
};

// ---------- Calls ----------------------------------------------------------

export async function fetchSafePathRoute(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  opts: { extraLambdas?: number[]; signal?: AbortSignal } = {},
): Promise<RouteResponse> {
  const r = await fetch(`${API_BASE}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      start_lat: start.lat,
      start_lon: start.lng,
      end_lat: end.lat,
      end_lon: end.lng,
      extra_lambdas: opts.extraLambdas,
    }),
    signal: opts.signal,
  });
  if (!r.ok) throw new Error(`SafePath route failed: ${r.status}`);
  return r.json() as Promise<RouteResponse>;
}

export async function fetchEdgeDetail(
  edgeId: string,
  signal?: AbortSignal,
): Promise<EdgeDetail> {
  const r = await fetch(
    `${API_BASE}/edge/${encodeURIComponent(edgeId)}`,
    { signal },
  );
  if (!r.ok) throw new Error(`SafePath edge detail failed: ${r.status}`);
  return r.json() as Promise<EdgeDetail>;
}

/** GeoJSON of every bikeable edge with its current score / inferred score /
 *  null. Cached in the enrichment module for the page session. */
export async function fetchScoresFC(signal?: AbortSignal): Promise<ScoresFC> {
  const r = await fetch(`${API_BASE}/scores`, { signal });
  if (!r.ok) throw new Error(`SafePath /scores failed: ${r.status}`);
  return r.json() as Promise<ScoresFC>;
}

/** GeoJSON of every intersection (degree>=3) with classification fields. */
export async function fetchIntersectionsFC(
  signal?: AbortSignal,
): Promise<IntersectionsFC> {
  const r = await fetch(`${API_BASE}/intersections`, { signal });
  if (!r.ok) throw new Error(`SafePath /intersections failed: ${r.status}`);
  return r.json() as Promise<IntersectionsFC>;
}

export async function safepathGeocode(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult | null> {
  const r = await fetch(
    `${API_BASE}/geocode?q=${encodeURIComponent(query)}`,
    { signal },
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`SafePath geocode failed: ${r.status}`);
  return r.json() as Promise<GeocodeResult>;
}

/** URL for a cached Street View image returned by /edge/{id}. */
export function safepathImageUrl(path: string): string {
  return `${API_BASE}/image?path=${encodeURIComponent(path)}`;
}

/** URL for the SSE demo-walk stream. Frontends can subscribe with EventSource. */
export function safepathDemoWalkUrl(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  opts: { weight?: "cost_safe" | "cost_fast"; speedMps?: number; timeScale?: number } = {},
): string {
  const params = new URLSearchParams({
    start_lat: String(start.lat),
    start_lon: String(start.lng),
    end_lat: String(end.lat),
    end_lon: String(end.lng),
    weight: opts.weight ?? "cost_safe",
  });
  if (opts.speedMps != null) params.set("speed_mps", String(opts.speedMps));
  if (opts.timeScale != null) params.set("time_scale", String(opts.timeScale));
  return `${API_BASE}/demo/walk?${params.toString()}`;
}
