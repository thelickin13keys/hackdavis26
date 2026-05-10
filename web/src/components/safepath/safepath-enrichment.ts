/**
 * Overlay backend safety data onto Mapbox-derived routes.
 *
 * Mapbox gives us route geometry, distances, turn-by-turn cues, and a
 * stress-based segment classification from its own annotations. Our backend
 * gives us per-edge Gemini safety scores for Davis. This module bridges them:
 *
 *   1. Fetch /scores GeoJSON once per page session (module-level cache).
 *   2. For each route segment, sample points along its polyline at fixed
 *      intervals.
 *   3. For each sample point, find the nearest scored edge in our backend
 *      data (within a 30 m radius — anything further isn't really "this
 *      segment").
 *   4. If we got coverage on at least half the samples, re-classify the
 *      segment's `level` from the *minimum* of those scores — a segment is
 *      only as safe as its scariest stretch.
 *   5. Recompute the route's overall 0-100 score from the length-weighted
 *      mean of all matched edge scores.
 *   6. Append intel bullets describing what our data added.
 *
 * If the backend is unreachable we fall back to the unmodified Mapbox route
 * silently — UX degrades, doesn't break.
 */

import {
  fetchIntersectionsFC,
  fetchScoresFC,
  type IntersectionFeature,
  type IntersectionsFC,
  type ScoreFeature,
  type ScoresFC,
} from "@/lib/safepath-api";
import type {
  Route,
  RouteIntel,
  RoutePoint,
  RouteSegment,
  SafetyLevel,
} from "./types";

// ---------- Tunables -------------------------------------------------------

const SAMPLE_INTERVAL_M = 30;        // along-route resolution for the snap
const NEAREST_EDGE_RADIUS_M = 60;    // max distance to consider a backend edge "this route"
const MIN_COVERAGE_FRACTION = 0.4;   // reclassify segment only if ≥40% of samples matched

// Intersection traversal — distance from a sample point to an intersection
// node below which we count the route as passing through that intersection.
const INTERSECTION_HIT_RADIUS_M = 18;

// Score penalty (in 0–100 space) per unprotected intersection traversed.
// Pushes the safety-Dijkstra'd route to favor signaled / all-way-stop routes
// over uncontrolled-crossing routes when both are otherwise comparable.
const UNPROTECTED_INTERSECTION_PENALTY = 6;
// Cap so a long route through 10+ unprotected nodes isn't murdered to 20/100.
const UNPROTECTED_INTERSECTION_PENALTY_CAP = 30;
// "Especially scary" — complex (5+ legs) AND uncontrolled — gets an extra hit.
const COMPLEX_UNPROTECTED_BONUS_PENALTY = 4;

// OSM tags that mean "this intersection has an actual control device" — the
// authoritative signal. These take precedence over Gemini's photo guess.
const PROTECTED_OSM_CONTROLS = new Set([
  "traffic_signals",
  "stop",
  "all_way_stop",
  "give_way",
  "mini_roundabout",
]);

// Gemini-reported control values that count as protected when no OSM tag exists.
const PROTECTED_GEMINI_CONTROLS = new Set([
  "signal",
  "signal_with_bike_phase",
  "stop",
  "all_way_stop",
  "yield",
  "roundabout",
]);

// ---------- Cached scores fetch -------------------------------------------

let scoresPromise: Promise<ScoresFC> | null = null;

async function loadScores(): Promise<ScoresFC | null> {
  if (!scoresPromise) {
    scoresPromise = fetchScoresFC().catch((err) => {
      // Reset on failure so the next route attempt can retry.
      scoresPromise = null;
      throw err;
    });
  }
  try {
    return await scoresPromise;
  } catch {
    return null;
  }
}

// Pre-filter to scored features only (the index is queried 100s of times per
// route; skipping nulls inside the hot loop matters).
let scoredFeatures: ScoreFeature[] | null = null;

async function loadScoredFeatures(): Promise<ScoreFeature[] | null> {
  if (scoredFeatures) return scoredFeatures;
  const fc = await loadScores();
  if (!fc) return null;
  scoredFeatures = fc.features.filter((f) => f.properties.score != null);
  return scoredFeatures;
}

// ---------- Intersection cache + classification ---------------------------

let intersectionsPromise: Promise<IntersectionsFC> | null = null;
let intersectionFeatures: IntersectionFeature[] | null = null;

async function loadIntersections(): Promise<IntersectionFeature[] | null> {
  if (intersectionFeatures) return intersectionFeatures;
  if (!intersectionsPromise) {
    intersectionsPromise = fetchIntersectionsFC().catch((err) => {
      intersectionsPromise = null;
      throw err;
    });
  }
  try {
    const fc = await intersectionsPromise;
    // Drop pure pass-through nodes (degree<3); they're not real intersections.
    intersectionFeatures = fc.features.filter((f) => (f.properties.degree ?? 0) >= 3);
    return intersectionFeatures;
  } catch {
    return null;
  }
}

function isUnprotected(props: IntersectionFeature["properties"]): boolean {
  // OSM tag wins when present — it's authoritative ground truth.
  if (props.osm_control) {
    return !PROTECTED_OSM_CONTROLS.has(props.osm_control);
  }
  // Otherwise defer to Gemini's photo guess. If it's null too, treat as
  // unprotected (the conservative default — most untagged Davis residential
  // intersections genuinely are uncontrolled).
  if (props.gemini_control) {
    return !PROTECTED_GEMINI_CONTROLS.has(props.gemini_control);
  }
  return true;
}

// ---------- Geometry helpers ----------------------------------------------

function distMeters(a: RoutePoint, b: RoutePoint): number {
  const R = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const x = dLon * Math.cos((lat1 + lat2) / 2);
  return Math.sqrt(x * x + dLat * dLat) * R;
}

function pointToSegmentDistance(
  p: RoutePoint,
  a: RoutePoint,
  b: RoutePoint,
): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return distMeters(p, a);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy),
    ),
  );
  return distMeters(p, { lng: a.lng + t * dx, lat: a.lat + t * dy });
}

function pointToPolylineDistance(p: RoutePoint, line: RoutePoint[]): number {
  if (line.length < 2) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < line.length - 1; i += 1) {
    const d = pointToSegmentDistance(p, line[i], line[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

/** Sample a polyline at fixed-meter intervals. Endpoints always included so
 *  we don't lose the start/finish of short segments. */
function sampleAlongPolyline(
  line: RoutePoint[],
  intervalM: number,
): RoutePoint[] {
  if (line.length === 0) return [];
  if (line.length === 1) return [line[0]];
  const out: RoutePoint[] = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    const d = distMeters(a, b);
    if (d === 0) continue;
    let walked = -carry;
    while (walked + intervalM <= d) {
      walked += intervalM;
      const t = walked / d;
      out.push({ lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t });
    }
    carry = d - walked;
  }
  // Always include the endpoint.
  const last = line[line.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function nearestScoredEdge(
  features: ScoreFeature[],
  p: RoutePoint,
  radiusM: number,
): ScoreFeature | null {
  let best: { f: ScoreFeature; d: number } | null = null;
  // Cheap bbox prefilter: skip edges whose first vertex is wildly far away.
  // For Davis-scale this still reduces the inner loop a lot since most
  // features are nowhere near a given point.
  const latBudgetDeg = (radiusM * 4) / 111000;
  for (const f of features) {
    const coords = f.geometry.coordinates;
    if (coords.length < 2) continue;
    const headLat = coords[0][1];
    if (Math.abs(headLat - p.lat) > latBudgetDeg) continue;
    const line = coords.map(([lng, lat]) => ({ lng, lat }));
    const d = pointToPolylineDistance(p, line);
    if (d > radiusM) continue;
    if (!best || d < best.d) best = { f, d };
  }
  return best?.f ?? null;
}

// ---------- Score → level mapping (matches backend thresholds) ------------

function scoreToLevel(score: number): SafetyLevel {
  if (score >= 7) return "safe";
  if (score >= 4) return "caution";
  return "danger";
}

// ---------- Per-segment enrichment ----------------------------------------

type SegmentEnrichment = {
  segment: RouteSegment;
  /** Length-weighted contribution of this segment to the route safety score. */
  weight: number;
  /** Sum of (score × weight) — combine across segments for the route mean. */
  weightedScoreSum: number;
  /** Whether we had enough coverage to actually reclassify. */
  reclassified: boolean;
  /** Tags collected from the matched backend edges (used in intel). */
  edgeNames: Set<string>;
  worstScore: number | null;
};

function enrichSegment(
  segment: RouteSegment,
  features: ScoreFeature[],
): SegmentEnrichment {
  const samples = sampleAlongPolyline(segment.points, SAMPLE_INTERVAL_M);
  const matchedScores: number[] = [];
  const edgeNames = new Set<string>();

  for (const pt of samples) {
    const edge = nearestScoredEdge(features, pt, NEAREST_EDGE_RADIUS_M);
    if (edge && edge.properties.score != null) {
      matchedScores.push(edge.properties.score);
      if (edge.properties.name) edgeNames.add(edge.properties.name);
    }
  }

  // Approximate segment length in meters for weighting.
  let length = 0;
  for (let i = 1; i < segment.points.length; i += 1) {
    length += distMeters(segment.points[i - 1], segment.points[i]);
  }

  if (matchedScores.length === 0 || samples.length === 0) {
    return {
      segment,
      weight: length,
      weightedScoreSum: 0,
      reclassified: false,
      edgeNames,
      worstScore: null,
    };
  }

  const coverage = matchedScores.length / samples.length;
  const meanScore =
    matchedScores.reduce((a, b) => a + b, 0) / matchedScores.length;
  const worstScore = Math.min(...matchedScores);

  // Reclassify the segment level when coverage is solid. We use the MEAN
  // score so a segment that's mostly above 7 still gets the "safe" bucket
  // even if one sample dips into caution territory. Worst-score is still
  // surfaced in the stress note so the user can see when there's a sketchy
  // sub-block within an otherwise-safe segment.
  let nextLevel: SafetyLevel = segment.level;
  let reclassified = false;
  if (coverage >= MIN_COVERAGE_FRACTION) {
    nextLevel = scoreToLevel(meanScore);
    reclassified = true;
  }

  // Append a per-segment stress note describing what we found.
  const stressNote = formatSegmentNote(meanScore, worstScore, edgeNames);
  const stressNotes = stressNote
    ? [...(segment.stressNotes ?? []), stressNote]
    : segment.stressNotes;

  return {
    segment: { ...segment, level: nextLevel, stressNotes },
    weight: length,
    weightedScoreSum: meanScore * length,
    reclassified,
    edgeNames,
    worstScore,
  };
}

function formatSegmentNote(
  meanScore: number,
  worstScore: number,
  edgeNames: Set<string>,
): string | null {
  const namesPart =
    edgeNames.size > 0 ? `via ${[...edgeNames].slice(0, 2).join(" / ")} ` : "";
  if (worstScore < 4) {
    return `Backend safety ${meanScore.toFixed(1)}/10 ${namesPart}— low-score block detected (${worstScore.toFixed(1)})`.trim();
  }
  if (worstScore < 7) {
    return `Backend safety ${meanScore.toFixed(1)}/10 ${namesPart}— mixed coverage`.trim();
  }
  return `Backend safety ${meanScore.toFixed(1)}/10 ${namesPart}— calm stretch`.trim();
}

// ---------- Public entrypoint ---------------------------------------------

// ---------- Route-level intersection traversal detection ------------------

/** Walk every sample point of every segment and record any intersection node
 *  within INTERSECTION_HIT_RADIUS_M. Returns the unique set of features
 *  traversed by the route. */
function intersectionsAlongRoute(
  route: Route,
  intersections: IntersectionFeature[],
): IntersectionFeature[] {
  if (intersections.length === 0) return [];

  // Bounding box of the route (with padding) so we only test ~the few hundred
  // intersections actually near the route, not all 5000+.
  let minLat = Number.POSITIVE_INFINITY,
    maxLat = Number.NEGATIVE_INFINITY,
    minLng = Number.POSITIVE_INFINITY,
    maxLng = Number.NEGATIVE_INFINITY;
  for (const seg of route.segments) {
    for (const p of seg.points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
  }
  const padDeg = INTERSECTION_HIT_RADIUS_M / 111000;
  const candidates = intersections.filter((f) => {
    const [lng, lat] = f.geometry.coordinates;
    return (
      lat >= minLat - padDeg &&
      lat <= maxLat + padDeg &&
      lng >= minLng - padDeg &&
      lng <= maxLng + padDeg
    );
  });

  const hit = new Map<number, IntersectionFeature>();
  for (const seg of route.segments) {
    const samples = sampleAlongPolyline(seg.points, SAMPLE_INTERVAL_M);
    for (const pt of samples) {
      for (const f of candidates) {
        if (hit.has(f.properties.node_id)) continue;
        const [lng, lat] = f.geometry.coordinates;
        const d = distMeters(pt, { lng, lat });
        if (d <= INTERSECTION_HIT_RADIUS_M) {
          hit.set(f.properties.node_id, f);
        }
      }
    }
  }
  return [...hit.values()];
}

export async function enrichRouteWithSafetyData(route: Route): Promise<Route> {
  const features = await loadScoredFeatures();
  if (!features || features.length === 0) {
    return route;
  }
  const intersections = (await loadIntersections()) ?? [];

  const enrichments = route.segments.map((s) => enrichSegment(s, features));

  const totalLength = enrichments.reduce((a, e) => a + e.weight, 0);
  const matchedLength = enrichments
    .filter((e) => e.reclassified)
    .reduce((a, e) => a + e.weight, 0);
  const totalWeightedScore = enrichments.reduce(
    (a, e) => a + e.weightedScoreSum,
    0,
  );
  const matchedScoreLength = enrichments
    .filter((e) => e.weightedScoreSum > 0)
    .reduce((a, e) => a + e.weight, 0);

  const meanScore10 =
    matchedScoreLength > 0 ? totalWeightedScore / matchedScoreLength : null;

  // Blend backend score with the existing Mapbox 0-100 score:
  //  * If we have ≥30% coverage, bias heavily toward backend (0.7).
  //  * Below that, just nudge.
  let nextScore = route.score;
  if (meanScore10 != null && totalLength > 0) {
    const coverage = matchedScoreLength / totalLength;
    const backend100 = Math.round(meanScore10 * 10);
    const weight = coverage >= 0.3 ? 0.7 : 0.35;
    nextScore = Math.round(route.score * (1 - weight) + backend100 * weight);
    nextScore = Math.max(20, Math.min(99, nextScore));
  }

  // Intersection-traversal penalty: heavier emphasis on AVOIDING unprotected
  // crossings. Counted after the edge-score blend so it stacks on top.
  const traversed = intersectionsAlongRoute(route, intersections);
  const unprotected = traversed.filter((f) => isUnprotected(f.properties));
  const complexUnprotected = unprotected.filter(
    (f) => f.properties.intersection_type === "complex",
  );
  let intersectionPenalty =
    unprotected.length * UNPROTECTED_INTERSECTION_PENALTY +
    complexUnprotected.length * COMPLEX_UNPROTECTED_BONUS_PENALTY;
  if (intersectionPenalty > UNPROTECTED_INTERSECTION_PENALTY_CAP) {
    intersectionPenalty = UNPROTECTED_INTERSECTION_PENALTY_CAP;
  }
  if (intersectionPenalty > 0) {
    nextScore = Math.max(20, nextScore - intersectionPenalty);
  }

  // Append backend-derived bullets to the existing Mapbox intel block.
  const existingLines = route.intel?.mapbox.lines ?? [];
  const backendLines: string[] = [];
  if (meanScore10 != null) {
    backendLines.push(
      `Backend safety: ${meanScore10.toFixed(1)} / 10 across ` +
        `${((matchedScoreLength / Math.max(totalLength, 1)) * 100).toFixed(0)}% scored coverage.`,
    );
  } else {
    backendLines.push("Backend safety: no scored coverage along this route.");
  }
  const reclassifiedCount = enrichments.filter((e) => e.reclassified).length;
  if (reclassifiedCount > 0) {
    backendLines.push(
      `Reclassified ${reclassifiedCount} of ${enrichments.length} ` +
        `segment${enrichments.length === 1 ? "" : "s"} from Gemini-scored Street View.`,
    );
  }
  const worstSeg = enrichments.reduce<SegmentEnrichment | null>(
    (worst, e) =>
      e.worstScore != null &&
      (worst === null || worst.worstScore == null || e.worstScore < worst.worstScore!)
        ? e
        : worst,
    null,
  );
  if (worstSeg && worstSeg.worstScore != null && worstSeg.worstScore < 4) {
    const names = [...worstSeg.edgeNames].slice(0, 2).join(" / ");
    backendLines.push(
      `Worst block: ${worstSeg.worstScore.toFixed(1)} / 10` +
        (names ? ` near ${names}` : "") + ".",
    );
  }

  // Intersection summary bullet with the "avoid X crossings" story.
  if (traversed.length > 0) {
    const protectedCount = traversed.length - unprotected.length;
    const parts: string[] = [];
    parts.push(
      `${traversed.length} intersection${traversed.length === 1 ? "" : "s"} along route` +
        ` (${protectedCount} controlled, ${unprotected.length} unprotected)`,
    );
    if (unprotected.length > 0) {
      const types = new Map<string, number>();
      for (const f of unprotected) {
        const t = f.properties.intersection_type ?? "unknown";
        types.set(t, (types.get(t) ?? 0) + 1);
      }
      const breakdown = [...types.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${n} ${t === "four_way" ? "4-way" : t}`)
        .join(", ");
      parts.push(`Unprotected: ${breakdown}`);
      parts.push(
        `Score penalty: −${intersectionPenalty} for unprotected crossings` +
          (intersectionPenalty === UNPROTECTED_INTERSECTION_PENALTY_CAP
            ? " (capped)"
            : "") + ".",
      );
    }
    backendLines.push(parts.join(" — "));
  }

  const intel: RouteIntel = {
    ...(route.intel ?? { mapbox: { lines: [], scorePenalty: 0, peakPostedMph: null, motorwayTouches: 0, tunnelTouches: 0 } }),
    mapbox: {
      ...(route.intel?.mapbox ?? {
        lines: [],
        scorePenalty: 0,
        peakPostedMph: null,
        motorwayTouches: 0,
        tunnelTouches: 0,
      }),
      lines: [...existingLines, ...backendLines],
    },
  };

  return {
    ...route,
    score: nextScore,
    segments: enrichments.map((e) => e.segment),
    intel,
  };
}

export async function enrichRoutesWithSafetyData(
  routes: Route[],
): Promise<Route[]> {
  // Pre-warm both caches so parallel route work doesn't race the fetches.
  await Promise.all([loadScoredFeatures(), loadIntersections()]);
  return Promise.all(routes.map(enrichRouteWithSafetyData));
}
