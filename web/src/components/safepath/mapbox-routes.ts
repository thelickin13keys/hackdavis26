import type { Route, RouteIntel, RoutePoint } from "./types";
import type { RawDirectionsLeg } from "./mapbox-route-steps";
import {
  buildSegmentsFromSteps,
  collectCyclingSteps,
  navigationCuesFromSteps,
  scoreFromStressSegments,
  streetSummaryFromSteps,
} from "./mapbox-route-steps";
import {
  extractCongestionStats,
  extractMapboxSignals,
  fetchRouteWeatherOutlook,
  mapboxInsightBullets,
  mapboxPenaltyForScore,
} from "./route-enrichment";
import { fetchRouteCrimeIntel } from "./crime-intel";

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
  legs?: RawDirectionsLeg[];
};

type DirectionsResponse = {
  message?: string;
  routes?: DirectionsRoute[];
};

type RouteVariant = {
  route: DirectionsRoute;
};

/** Display labels - geometry + tiers come from Mapbox Directions steps */
const ROUTE_META: Array<{
  id: string;
  name: string;
  subtitleHint: string;
}> = [
  {
    id: "safest",
    name: "Safest route",
    subtitleHint: "Cycling route - lower-stress streets",
  },
  {
    id: "balanced",
    name: "Balanced",
    subtitleHint: "Direct route - some shared streets",
  },
  {
    id: "fastest",
    name: "Alternate",
    subtitleHint: "Different corridor - compare tradeoffs",
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

  return Promise.all(
    variants.map(async ({ route: source }, index) => {
      const meta = ROUTE_META[index] ?? {
        id: `route-${index + 1}`,
        name: `Alternative ${index + 1}`,
        subtitleHint: "Mapbox cycling route",
      };
      const linePoints =
        source.geometry?.coordinates.map(([lng, lat]) => ({ lng, lat })) ?? [];

      const steps = collectCyclingSteps(source.legs);
      const segments = buildSegmentsFromSteps(steps, linePoints);
      const baseScore = scoreFromStressSegments(segments);
      const signals = extractMapboxSignals(source.legs, steps);
      const congestion = extractCongestionStats(source.legs);
      const penalty = mapboxPenaltyForScore(signals);

      let subtitle = streetSummaryFromSteps(steps);
      if (!subtitle || subtitle === "Bike route - Mapbox directions")
        subtitle = meta.subtitleHint;

      const cues = navigationCuesFromSteps(steps);

      let intel: RouteIntel | undefined;

      let lines = mapboxInsightBullets(signals);
      lines = [...new Map(lines.map((l) => [l.trim(), l])).keys()].filter(
        Boolean,
      );
      if (lines.length === 0 && penalty === 0) {
        lines = [
          "Directions annotations did not expose extra roadway stats beyond the step text on this corridor.",
        ];
      }
      intel = {
        mapbox: {
          lines,
          scorePenalty: penalty,
          peakPostedMph: signals.peakPostedMph,
          motorwayTouches: signals.motorwayTouches,
          tunnelTouches: signals.tunnelTouches,
          congestion,
        },
      };

      // Fetch weather and crime data in parallel
      const [outlook, crimeIntel] = await Promise.all([
        linePoints.length >= 2
          ? fetchRouteWeatherOutlook(linePoints).catch(() => ({
              lines: [],
              attribution: "Open-Meteo data unavailable.",
            }))
          : Promise.resolve({ lines: [], attribution: "" }),
        fetchRouteCrimeIntel(linePoints).catch(() => null),
      ]);

      if (outlook.lines.filter(Boolean).length > 0) {
        intel = { ...intel, conditions: outlook };
      }

      if (crimeIntel && !crimeIntel.outsideCoverage) {
        intel = { ...intel, crime: crimeIntel };
      }

      // Apply crime penalty on top of Mapbox road penalty
      const crimePenalty = crimeIntel?.outsideCoverage ? 0 : (crimeIntel?.scorePenalty ?? 0);
      const finalScore = Math.round(
        Math.max(22, Math.min(97, baseScore - penalty - crimePenalty)),
      );

      const result: Route = {
        id: meta.id,
        name: meta.name,
        durationMin: Math.max(1, Math.round(source.duration / 60)),
        distanceMi: source.distance / 1609.344,
        score: finalScore,
        subtitle,
        segments,
        navigationCues: cues.length ? cues : undefined,
        intel,
      };
      return result;
    }),
  );
}

const MAX_ROUTE_COUNT = 4;

async function collectRouteVariants(
  origin: RoutePoint,
  destination: RoutePoint,
) {
  const variants: RouteVariant[] = [];
  const seen = new Set<string>();

  // Primary call — Mapbox returns up to 3 routes with alternatives=true
  const directRoutes = await requestDirections([origin, destination], true);
  for (const route of directRoutes) {
    addVariant(variants, seen, { route });
  }

  // Via-waypoint detour calls — force different corridors by nudging the midpoint
  const mid: RoutePoint = {
    lng: (origin.lng + destination.lng) / 2,
    lat: (origin.lat + destination.lat) / 2,
  };
  const latOff = 0.003; // ~333 m
  const lngOff = 0.003 / Math.cos((mid.lat * Math.PI) / 180);

  const viaPoints: RoutePoint[] = [
    { lng: mid.lng,                lat: mid.lat + latOff },              // N
    { lng: mid.lng,                lat: mid.lat - latOff },              // S
    { lng: mid.lng + lngOff,       lat: mid.lat },                       // E
    { lng: mid.lng - lngOff,       lat: mid.lat },                       // W
    { lng: mid.lng + lngOff * 0.6, lat: mid.lat + latOff * 0.6 },       // NE
    { lng: mid.lng - lngOff * 0.6, lat: mid.lat - latOff * 0.6 },       // SW
  ];

  const detourResults = await Promise.allSettled(
    viaPoints.map((via) => requestDirections([origin, via, destination], false)),
  );
  for (const result of detourResults) {
    if (result.status === "fulfilled") {
      for (const route of result.value) {
        addVariant(variants, seen, { route });
      }
    }
  }

  return variants.slice(0, MAX_ROUTE_COUNT);
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
  url.searchParams.set("steps", "true");
  /** Per-segment durations, inferred speeds & posted limits @see annotations */
  url.searchParams.set(
    "annotations",
    "distance,duration,speed,maxspeed,congestion,congestion_numeric",
  );
  /** Match Mapbox step model: separate enter vs exit roundabout legs when routing supplies them */
  url.searchParams.set("roundabout_exits", "true");
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

