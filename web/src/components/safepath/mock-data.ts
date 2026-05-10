import type { Route, StreetAnalysis } from "./types";

/**
 * Initial route skeleton inside the Davis bbox we've actually scored.
 * Live SafePath routing replaces this as soon as the app hydrates.
 *
 * Each placeholder route is just a straight line between ORIGIN and
 * DESTINATION — no real geometry. We only ship 3 entries so the side panel
 * has stable placeholder cards to render during the brief loading flash;
 * the points all stay in Davis so the map doesn't zoom to a stale
 * out-of-area route during hydration.
 */

// 8th & F, downtown Davis
export const ORIGIN = { lng: -121.7400, lat: 38.5495 };
// 965 Olive Drive, Davis, California 95616, United States
export const DESTINATION = { lng: -121.73996, lat: 38.540026 };

const PLACEHOLDER_LINE = [ORIGIN, DESTINATION];

export const ROUTES: Route[] = [
  {
    id: "safest",
    name: "Safest route",
    subtitle: "Loading…",
    durationMin: 0,
    distanceMi: 0,
    score: 0,
    segments: [{ id: "s1", level: "safe", points: PLACEHOLDER_LINE }],
  },
  {
    id: "balanced",
    name: "Balanced",
    subtitle: "Loading…",
    durationMin: 0,
    distanceMi: 0,
    score: 0,
    segments: [{ id: "b1", level: "caution", points: PLACEHOLDER_LINE }],
  },
  {
    id: "fastest",
    name: "Fastest",
    subtitle: "Loading…",
    durationMin: 0,
    distanceMi: 0,
    score: 0,
    segments: [{ id: "f1", level: "danger", points: PLACEHOLDER_LINE }],
  },
];

export const STREET_ANALYSES: StreetAnalysis[] = [];
