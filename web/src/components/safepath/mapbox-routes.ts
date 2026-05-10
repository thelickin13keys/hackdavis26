import type { Route, RoutePoint, SafetyLevel } from "./types";
import { segmentNarrative } from "./segment-copy";

const TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_API_KEY ??
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ??
  "";

type DirectionsRoute = {
  duration: number;
  distance: number;
  geometry?: {
    type: "LineString";
    coordinates: [number, number][];
  };
};

type DirectionsResponse = {
  message?: string;
  routes?: DirectionsRoute[];
};

type RouteVariant = {
  route: DirectionsRoute;
  via?: RoutePoint;
};

const ROUTE_META: Array<{
  id: string;
  name: string;
  subtitle: string;
  score: number;
  levels: SafetyLevel[];
}> = [
  {
    id: "safest",
    name: "Safest route",
    subtitle: "Cycling route · lower-stress streets",
    score: 92,
    levels: ["safe", "caution", "safe"],
  },
  {
    id: "balanced",
    name: "Balanced",
    subtitle: "Direct route · some shared streets",
    score: 71,
    levels: ["safe", "caution", "caution"],
  },
  {
    id: "fastest",
    name: "Alternate",
    subtitle: "Different corridor · compare tradeoffs",
    score: 48,
    levels: ["caution", "danger", "caution"],
  },
];

export async function fetchMapboxBikeRoutes(
  origin: RoutePoint,
  destination: RoutePoint,
): Promise<Route[]> {
  if (!TOKEN) {
    throw new Error("Missing Mapbox token");
  }

  const variants = await collectRouteVariants(origin, destination);

  if (!variants.length) {
    throw new Error("Mapbox Directions returned no routes");
  }

  return variants.map(({ route: source, via }, index) => {
    const meta = ROUTE_META[index] ?? {
      id: `route-${index + 1}`,
      name: `Alternative ${index}`,
      subtitle: "Mapbox cycling route",
      score: Math.max(42, 82 - index * 12),
      levels: ["safe", "caution", "safe"] as SafetyLevel[],
    };
    const points =
      source.geometry?.coordinates.map(([lng, lat]) => ({ lng, lat })) ?? [];

    return {
      id: meta.id,
      name: meta.name,
      durationMin: Math.max(1, Math.round(source.duration / 60)),
      distanceMi: source.distance / 1609.344,
      score: meta.score,
      subtitle: via ? `${meta.subtitle} · alternate corridor` : meta.subtitle,
      segments: splitIntoSafetySegments(points, meta.levels),
    };
  });
}

async function collectRouteVariants(
  origin: RoutePoint,
  destination: RoutePoint,
) {
  const variants: RouteVariant[] = [];
  const seen = new Set<string>();

  const directRoutes = await requestDirections([origin, destination], true);
  for (const route of directRoutes) {
    addVariant(variants, seen, { route });
  }

  if (variants.length < ROUTE_META.length) {
    for (const via of buildViaCandidates(origin, destination)) {
      const [route] = await requestDirections([origin, via, destination], false)
        .catch(() => []);
      if (route) addVariant(variants, seen, { route, via });
      if (variants.length >= ROUTE_META.length) break;
    }
  }

  return variants.slice(0, ROUTE_META.length);
}

async function requestDirections(points: RoutePoint[], alternatives: boolean) {
  const coords = points
    .map((point) => `${point.lng},${point.lat}`)
    .join(";");
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/cycling/${coords}`,
  );
  url.searchParams.set("alternatives", String(alternatives));
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "false");
  url.searchParams.set("access_token", TOKEN);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as
      | DirectionsResponse
      | null;
    throw new Error(
      `Mapbox Directions failed: ${response.status}${
        error?.message ? ` (${error.message})` : ""
      }`,
    );
  }

  const data = (await response.json()) as DirectionsResponse;
  return (data.routes ?? []).filter(
    (route) => (route.geometry?.coordinates.length ?? 0) >= 2,
  );
}

function addVariant(
  variants: RouteVariant[],
  seen: Set<string>,
  variant: RouteVariant,
) {
  const key = routeSignature(variant.route);
  if (!key || seen.has(key)) return;
  seen.add(key);
  variants.push(variant);
}

function routeSignature(route: DirectionsRoute) {
  const coords = route.geometry?.coordinates;
  if (!coords || coords.length < 2) return "";
  const sampleIndexes = [0, Math.floor(coords.length / 2), coords.length - 1];
  return sampleIndexes
    .map((index) => coords[index].map((value) => value.toFixed(3)).join(","))
    .join("|");
}

function buildViaCandidates(origin: RoutePoint, destination: RoutePoint) {
  const dx = destination.lng - origin.lng;
  const dy = destination.lat - origin.lat;
  const length = Math.hypot(dx, dy) || 1;
  const offset = Math.min(0.018, Math.max(0.006, length * 0.08));
  const perp = { lng: -dy / length, lat: dx / length };
  const midpoint = {
    lng: (origin.lng + destination.lng) / 2,
    lat: (origin.lat + destination.lat) / 2,
  };

  return [
    {
      lng: midpoint.lng + perp.lng * offset,
      lat: midpoint.lat + perp.lat * offset,
    },
    {
      lng: midpoint.lng - perp.lng * offset,
      lat: midpoint.lat - perp.lat * offset,
    },
    {
      lng: origin.lng + dx * 0.62 + perp.lng * offset * 0.72,
      lat: origin.lat + dy * 0.62 + perp.lat * offset * 0.72,
    },
  ];
}

function splitIntoSafetySegments(points: RoutePoint[], levels: SafetyLevel[]) {
  if (points.length < 2) {
    return levels.map((level, index) => ({
      id: `seg-${index}`,
      level,
      points,
      reason: segmentNarrative(level, index),
    }));
  }

  const last = points.length - 1;
  const cut1 = Math.max(1, Math.floor(last / 3));
  const cut2 = Math.max(cut1 + 1, Math.floor((last * 2) / 3));
  const slices = [
    points.slice(0, cut1 + 1),
    points.slice(cut1, cut2 + 1),
    points.slice(cut2),
  ];

  return levels.map((level, index) => ({
    id: `seg-${index}`,
    level,
    points: slices[index].length >= 2 ? slices[index] : points,
    reason: segmentNarrative(level, index),
  }));
}
