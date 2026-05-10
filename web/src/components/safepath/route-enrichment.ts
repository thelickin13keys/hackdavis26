import type { RawDirectionsLeg, RawDirectionsStep } from "./mapbox-route-steps";
import type { RouteIntel, RoutePoint } from "./types";

const MPH_FROM_MPS = 2.2369362920544;

type MaxspeedAnn = {
  speed?: number;
  unit?: string;
  unknown?: boolean;
  none?: boolean;
};

function mphFromMaxspeed(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as MaxspeedAnn;
  if (m.unknown || m.none) return null;
  if (typeof m.speed !== "number" || typeof m.unit !== "string") return null;
  return m.unit === "mph" ? m.speed : m.speed / 1.609344;
}

/** Mapbox Directions `annotation.maxspeed`, `distance`, `duration`, `speed` (+ leg summaries + intersections). */
export function extractMapboxSignals(
  legs: RawDirectionsLeg[] | undefined,
  cyclingSteps: RawDirectionsStep[],
) {
  const legSummaries: string[] = [];
  let motorwayTouches = 0;
  let tunnelTouches = 0;

  let peakPosted: number | null = null;
  let unknownLim = 0;
  let knownLim = 0;

  /** Distance-weighted average travel speed along annotated segments */
  let distWeight = 0;
  let speedNumerator = 0;

  const legList = legs ?? [];
  for (const leg of legList) {
    const summary = typeof leg.summary === "string" ? leg.summary.trim() : "";
    if (summary) legSummaries.push(summary);

    const ann = leg.annotation;
    if (!ann) continue;

    const maxs = ann.maxspeed ?? [];
    for (const x of maxs) {
      if (!x || typeof x !== "object") {
        unknownLim += 1;
        continue;
      }
      const raw = x as MaxspeedAnn;
      if (raw.unknown || raw.none) {
        unknownLim += 1;
        continue;
      }
      const mph = mphFromMaxspeed(x);
      if (mph != null) {
        knownLim += 1;
        peakPosted = peakPosted == null ? mph : Math.max(peakPosted, mph);
      } else unknownLim += 1;
    }

    const d = ann.distance ?? [];
    const s = ann.speed ?? [];
    for (let i = 0; i < Math.min(d.length, s.length); i++) {
      const dm = d[i]!;
      const mps = s[i]!;
      if (dm > 0 && mps >= 0) {
        distWeight += dm;
        speedNumerator += dm * mps;
      }
    }
  }

  for (const step of cyclingSteps) {
    const classes =
      step.intersections?.flatMap((x) =>
        Array.isArray(x.classes) ? x.classes : [],
      ) ?? [];
    const low = classes.map((c) => String(c).toLowerCase());
    if (low.includes("motorway")) motorwayTouches += 1;
    if (low.includes("tunnel")) tunnelTouches += 1;
  }

  const unknownLimitPct =
    knownLim + unknownLim > 0
      ? Math.round((unknownLim / (knownLim + unknownLim)) * 100)
      : null;

  const impliedTravelMph =
    distWeight > 1e-6 ? (speedNumerator / distWeight) * MPH_FROM_MPS : null;

  return {
    peakPostedMph: peakPosted,
    unknownLimitPct,
    impliedTravelMph,
    motorwayTouches,
    tunnelTouches,
    legSummaries: [...new Set(legSummaries)],
  };
}

/** Extracts congestion breakdown from Mapbox `congestion` annotation segments */
export function extractCongestionStats(legs: RawDirectionsLeg[] | undefined): {
  lowPct: number;
  moderatePct: number;
  heavyPct: number;
  severePct: number;
  available: boolean;
} {
  let low = 0, moderate = 0, heavy = 0, severe = 0, total = 0;
  for (const leg of legs ?? []) {
    for (const level of leg.annotation?.congestion ?? []) {
      if (!level || level === "unknown") continue;
      total += 1;
      if (level === "low") low += 1;
      else if (level === "moderate") moderate += 1;
      else if (level === "heavy") heavy += 1;
      else if (level === "severe") severe += 1;
    }
  }
  if (total === 0) return { lowPct: 0, moderatePct: 0, heavyPct: 0, severePct: 0, available: false };
  const pct = (n: number) => Math.round((n / total) * 100);
  return {
    lowPct: pct(low),
    moderatePct: pct(moderate),
    heavyPct: pct(heavy),
    severePct: pct(severe),
    available: true,
  };
}

/** Penalizes safety score using Mapbox-only signals when exposure is objectively higher */
export function mapboxPenaltyForScore(signal: ReturnType<typeof extractMapboxSignals>): number {
  let p = 0;
  if (signal.motorwayTouches > 0) {
    p += Math.min(22, signal.motorwayTouches * 8);
  }
  if (signal.tunnelTouches > 0) {
    p += Math.min(10, signal.tunnelTouches * 3);
  }
  if (signal.peakPostedMph != null) {
    if (signal.peakPostedMph >= 55) p += 10;
    else if (signal.peakPostedMph >= 45) p += 6;
    else if (signal.peakPostedMph >= 35) p += 3;
  }
  if (signal.impliedTravelMph != null && signal.impliedTravelMph >= 22) {
    p += signal.impliedTravelMph >= 28 ? 5 : 3;
  }
  if (signal.unknownLimitPct != null && signal.unknownLimitPct >= 65) {
    p += 2;
  }
  return Math.min(28, Math.round(p));
}

export function mapboxInsightBullets(signal: ReturnType<typeof extractMapboxSignals>): string[] {
  const out: string[] = [];

  if (signal.peakPostedMph != null) {
    const unk =
      signal.unknownLimitPct != null
        ? ` About ${signal.unknownLimitPct}% of limit tags are unknown.`
        : "";
    out.push(
      `Directions reports posted limits up to about ${signal.peakPostedMph.toFixed(0)} mph along the snapped path.${unk}`,
    );
  } else if (signal.unknownLimitPct != null) {
    out.push(
      `Posted speed-limit tags look sparse (${signal.unknownLimitPct}% unknown), lean on roadway signage.`,
    );
  }
  if (signal.impliedTravelMph != null) {
    out.push(
      `Router timing implies ~${signal.impliedTravelMph.toFixed(0)} mph smooth travel excluding your stops.`,
    );
  }
  if (signal.motorwayTouches > 0 || signal.tunnelTouches > 0) {
    out.push(
      `Road classes on the Directions steps include ${signal.motorwayTouches > 0 ? `${signal.motorwayTouches} motorway-class touch${signal.motorwayTouches === 1 ? "" : "es"}` : ""}${signal.motorwayTouches > 0 && signal.tunnelTouches > 0 ? " and " : ""}${signal.tunnelTouches > 0 ? `${signal.tunnelTouches} tunnel touch${signal.tunnelTouches === 1 ? "" : "es"}` : ""}.`,
    );
  }
  return out.slice(0, 5);
}

type OpenMeteoCurrent = {
  visibility?: number;
  windspeed_10m?: number;
  precipitation?: number;
  rain?: number;
  snowfall?: number;
  cloud_cover?: number;
  weather_code?: number;
};

type OpenMeteoResponse = {
  current?: OpenMeteoCurrent;
};

async function openMeteoAt(point: RoutePoint): Promise<OpenMeteoResponse | undefined> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(point.lat));
  url.searchParams.set("longitude", String(point.lng));
  url.searchParams.set(
    "current",
    [
      "visibility",
      "windspeed_10m",
      "precipitation",
      "rain",
      "snowfall",
      "weather_code",
      "cloud_cover",
    ].join(","),
  );
  url.searchParams.set("wind_speed_unit", "ms");
  const res = await fetch(url.toString());
  if (!res.ok) return undefined;
  return (await res.json()) as OpenMeteoResponse;
}

const MPS_TO_MPH = 2.23694;

function windSafety(mph: number): "safe" | "caution" | "danger" {
  if (mph < 15) return "safe";
  if (mph < 25) return "caution";
  return "danger";
}

function precipSafety(mmh: number): "safe" | "caution" | "danger" {
  if (mmh < 2) return "caution";
  return "danger";
}

function snowSafety(cm: number): "safe" | "caution" | "danger" {
  if (cm < 1) return "caution";
  return "danger";
}

function worstSafety(
  levels: ("safe" | "caution" | "danger")[],
): "safe" | "caution" | "danger" {
  if (levels.includes("danger")) return "danger";
  if (levels.includes("caution")) return "caution";
  return "safe";
}

/** Mapbox publishes traffic + routing, but not roadside weather - Open-Meteo is CC BY 4.0 - no token */
export async function fetchRouteWeatherOutlook(
  points: RoutePoint[],
): Promise<NonNullable<RouteIntel["conditions"]>> {
  const out: string[] = [];
  const items: NonNullable<RouteIntel["conditions"]>["items"] = [];

  if (points.length < 2)
    return { lines: [], attribution: "Open-Meteo (CC BY 4.0)." };

  const mid = points[Math.floor(points.length / 2)]!;
  const nearEnd = points[Math.min(points.length - 1, points.length - 5)]!;
  const labels: [RoutePoint, string][] = [
    [mid, "Mid-route"],
    [nearEnd, "Near arrival"],
  ];

  try {
    for (const [pt, hint] of labels) {
      const data = await openMeteoAt(pt);
      const c = data?.current;
      if (!c) continue;

      const parts: string[] = [];
      const safetyLevels: ("safe" | "caution" | "danger")[] = [];

      // Visibility skipped urban density naturally limits it and would produce false warnings

      const w = c.windspeed_10m;
      if (typeof w === "number" && w >= 6) {
        const mph = w * MPS_TO_MPH;
        parts.push(`${mph.toFixed(0)} mph wind`);
        safetyLevels.push(windSafety(mph));
      }

      const p = typeof c.rain === "number" ? c.rain : c.precipitation;
      if (typeof p === "number" && p > 0.5) {
        parts.push(`${p.toFixed(1)} mm/h rain`);
        safetyLevels.push(precipSafety(p));
      } else if (typeof c.snowfall === "number" && c.snowfall > 0.2) {
        parts.push(`${c.snowfall.toFixed(1)} cm snowfall`);
        safetyLevels.push(snowSafety(c.snowfall));
      }

      const cc =
        typeof c.cloud_cover === "number" ? Math.round(c.cloud_cover) : null;
      if (cc != null && cc >= 88) parts.push("very cloudy");

      if (parts.length === 0) continue;

      const safety = worstSafety(safetyLevels);
      const detail = parts.join(", ") + ".";
      out.push(`${hint}: ${detail}`);
      items!.push({ hint, safety, detail });
      if (out.length >= 2) break;
    }
  } catch {
    /** ignore */
  }

  return {
    lines: out.slice(0, 2),
    items: items!.slice(0, 2),
    attribution:
      "Open-Meteo (CC BY 4.0) roadside weather snapshot, not routing data.",
  };
}
