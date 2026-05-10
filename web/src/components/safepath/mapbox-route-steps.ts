import type { NavigationCue, RoutePoint, RouteSegment, SafetyLevel } from "./types";
import { segmentNarrative } from "./segment-copy";
import {
  pickStressCueLine,
  type StressCueCopyKey,
} from "./stress-cue-copy";

/** Directions v5 step (cycling); intersections carry Mapbox `classes` eg tunnel / motorway */
export type RawDirectionsStep = {
  distance: number;
  duration: number;
  geometry?: { type?: string; coordinates?: [number, number][] };
  name?: string;
  mode?: string;
  intersections?: { classes?: string[] }[];
  maneuver?: {
    type?: string;
    instruction?: string;
    modifier?: string;
    bearing_after?: number;
    bearing_before?: number;
  };
};

export type RawDirectionsLeg = {
  steps?: RawDirectionsStep[];
  summary?: string;
  annotation?: {
    distance?: number[];
    duration?: number[];
    speed?: number[];
    maxspeed?: unknown[];
    congestion?: (string | null)[];
    congestion_numeric?: (number | null)[];
  };
};

export function collectCyclingSteps(legs: RawDirectionsLeg[] | undefined) {
  if (!legs?.length) return [];
  return legs.flatMap((leg) => leg.steps ?? []).filter((step) => {
    const mode = (step.mode ?? "cycling").toLowerCase();
    return mode === "cycling";
  });
}

const DANGER_RE =
  /\b(freeway|expressway|interstate|motorway|highway\s*\d+|i-\s*\d|us\s*-\s*\d|ca\s*-\s*\d+|state\s+route|sr\s*-\s*\d+|route\s+[0-9]{2,})\b/i;

/**
 * Mapbox Directions API v5 `maneuver.type` values we score as higher attention.
 * @see https://docs.mapbox.com/api/navigation/directions/#maneuver-types
 */
const MAPBOX_ROUNDABOUT_TYPES = new Set([
  "roundabout",
  "rotary",
  "roundabout turn",
  "exit roundabout",
  "exit rotary",
]);

const MAPBOX_RAMP_TYPES = new Set(["on ramp", "off ramp"]);

/** Crossings / higher-complexity moves (subset of Mapbox + text heuristics). */
const CAUTION_MANEUVER = new Set([
  ...MAPBOX_ROUNDABOUT_TYPES,
  ...MAPBOX_RAMP_TYPES,
  "fork",
  "merge",
  "end of road",
  "new name",
  /** Reported on some profiles / regions; harmless if unused. */
  "traffic signal",
]);

const CAUTION_TEXT =
  /\b(boulevard|blvd\.?|arterial|avenue|traffic signals?|roundabout|rotary|ramp\b|bike crossing|bike lane ends|narrow|tunnel|construction)\b/i;

const SAFETY_WEIGHT: Record<SafetyLevel, number> = {
  safe: 0,
  caution: 1,
  danger: 2,
};

export function worstSafetyLevel(a: SafetyLevel, b: SafetyLevel): SafetyLevel {
  return SAFETY_WEIGHT[a] >= SAFETY_WEIGHT[b] ? a : b;
}

function intersectionClassSet(step: RawDirectionsStep): Set<string> {
  const out = new Set<string>();
  for (const ix of step.intersections ?? []) {
    for (const c of ix.classes ?? []) {
      out.add(String(c).toLowerCase());
    }
  }
  return out;
}

/** motorway / tunnel come from Directions `intersections.classes` (@see Mapbox route step cycling). */
function stressFromIntersectionClasses(
  step: RawDirectionsStep,
): SafetyLevel | null {
  const classes = intersectionClassSet(step);
  if (classes.has("motorway")) return "danger";
  if (classes.has("tunnel")) return "caution";
  return null;
}

/** Heuristic tier from cue text alone (excluding intersection classes merge). */
function stressLevelFromHeuristic(step: RawDirectionsStep): SafetyLevel {
  const text = [
    step.name,
    step.maneuver?.instruction,
    step.maneuver?.modifier,
  ]
    .filter(Boolean)
    .join(" ");

  const type = (step.maneuver?.type ?? "").toLowerCase();
  const mod = (step.maneuver?.modifier ?? "").toLowerCase();

  if (DANGER_RE.test(text)) return "danger";

  if (CAUTION_MANEUVER.has(type)) return "caution";

  if (step.distance >= 850 && /\b(ca-|us-|i-|rte|route)\d/i.test(text)) {
    return "caution";
  }

  const turnSharply =
    deltaBearingDegrees(step) >= 105 &&
    (type === "turn" || mod.includes("uturn"));

  if (turnSharply) return "caution";

  if (CAUTION_TEXT.test(text.toLowerCase())) return "caution";

  return "safe";
}

/** Stress tier from Mapbox step context (better than slicing the polyline blindly). */
export function stressLevelFromStep(step: RawDirectionsStep): SafetyLevel {
  const ix = stressFromIntersectionClasses(step);
  const heuristic = stressLevelFromHeuristic(step);
  return ix == null ? heuristic : worstSafetyLevel(ix, heuristic);
}

function deltaBearingDegrees(step: RawDirectionsStep): number {
  const a = step.maneuver?.bearing_before;
  const b = step.maneuver?.bearing_after;
  if (typeof a !== "number" || typeof b !== "number") return 0;
  let d = Math.abs(b - a) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function stepToPoints(step: RawDirectionsStep): RoutePoint[] {
  const c = step.geometry?.coordinates;
  if (!c?.length) return [];
  return c.map(([lng, lat]) => ({ lng, lat }));
}

function dedupeJoin(a: RoutePoint[], b: RoutePoint[]): RoutePoint[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const last = a[a.length - 1]!;
  const first = b[0]!;
  const same =
    Math.abs(last.lng - first.lng) < 1e-7 &&
    Math.abs(last.lat - first.lat) < 1e-7;
  return same ? [...a, ...b.slice(1)] : [...a, ...b];
}

function segmentLengthApproxMeters(points: RoutePoint[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = ((b.lng - a.lng) * Math.PI) / 180;
    const dy = ((b.lat - a.lat) * Math.PI) / 180;
    const mx =
      dx * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180) * 6371000;
    const my = dy * 6371000;
    m += Math.hypot(mx, my);
  }
  return m;
}

export function scoreFromStressSegments(segments: RouteSegment[]): number {
  let safeM = 0,
    cautionM = 0,
    dangerM = 0;
  for (const s of segments) {
    const len = Math.max(1e-6, segmentLengthApproxMeters(s.points));
    if (s.level === "safe") safeM += len;
    else if (s.level === "caution") cautionM += len;
    else dangerM += len;
  }
  const total = safeM + cautionM + dangerM;
  const weighted =
    (safeM * 100 + cautionM * 62 + dangerM * 28) / Math.max(total, 1);
  return Math.round(Math.max(22, Math.min(97, weighted)));
}

export function streetSummaryFromSteps(steps: RawDirectionsStep[]): string {
  const names = steps
    .map((s) => s.name?.trim())
    .filter((n): n is string => Boolean(n && n.length > 1));
  const uniq: string[] = [];
  for (const n of names) {
    if (uniq.length === 0 || uniq[uniq.length - 1] !== n) uniq.push(n);
    if (uniq.length > 14) break;
  }
  if (!uniq.length) return "Cycling route";
  if (uniq.length === 1) return uniq[0]!;
  return `${uniq[0]} to ${uniq[uniq.length - 1]}`;
}

/** Normalize Directions / geocoder quirks for UI (accordion + list). */
export function sanitizeDirectionsLine(raw: string): string {
  let s = raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1");

  // Collapse double+ periods (never decimals in prose here)
  s = s.replace(/\.{2,}/g, ".");

  // ". )." / "). ." artefacts
  s = s.replace(/\)\s*\.\s*\.$/, ").");
  s = s.replace(/\.\s*\.$/, ".");

  s = s.trim();

  const last = s.at(-1);
  if (last && ![",", ".", "!", "?"].includes(last)) {
    s = `${s}.`;
  }

  return s.trim();
}

function formatInstruction(step: RawDirectionsStep): string {
  const ins = step.maneuver?.instruction?.trim();
  if (ins) return ins;
  const n = step.name?.trim();
  if (n) return `Along ${n}`;
  return `Continue (${Math.round(step.distance)} m)`;
}

export function sanitizedStepLine(step: RawDirectionsStep): string {
  return sanitizeDirectionsLine(formatInstruction(step));
}

/**
 * One plain sentence per Directions leg for **Why this route** (not turn-by-turn).
 * Classification mirrors `stressLevelFromStep`; copy lives in `stress-cue-copy.ts` so new reasons scale by editing keyed strings.
 */
export function stressCueLineFromStep(
  step: RawDirectionsStep,
  varietyIndex: number,
): string {
  const textRaw = [
    step.name,
    step.maneuver?.instruction,
    step.maneuver?.modifier,
  ]
    .filter(Boolean)
    .join(" ");
  const textLower = textRaw.toLowerCase();
  const level = stressLevelFromStep(step);
  const type = (step.maneuver?.type ?? "").toLowerCase();
  const mod = (step.maneuver?.modifier ?? "").toLowerCase();
  const bend = deltaBearingDegrees(step);
  const dist = step.distance;
  const onCycleway =
    /\b(cycleway|bike path|cycle track|bike trail)\b/i.test(textRaw);
  const roadway = intersectionClassSet(step);

  let key: StressCueCopyKey;
  if (roadway.has("motorway")) {
    key = "motorwayInfrastructure";
  } else if (level === "danger" || DANGER_RE.test(textRaw)) {
    key = "dangerFreeway";
  } else if (MAPBOX_ROUNDABOUT_TYPES.has(type) || /roundabout|rotary/i.test(textRaw)) {
    key = "roundabout";
  } else if (MAPBOX_RAMP_TYPES.has(type)) {
    key = "ramp";
  } else if (type === "fork") {
    key = "fork";
  } else if (type === "merge") {
    key = "merge";
  } else if (
    type === "traffic signal" ||
    /\btraffic light|\bsignalized\b|\bat the signals?\b/i.test(textRaw)
  ) {
    key = "trafficSignal";
  } else if (type === "end of road") {
    key = "endOfRoad";
  } else if (type === "new name") {
    key = "streetRename";
  } else if (
    dist >= 850 &&
    /\b(ca-|us-|i-|rte|route\s*\d|sr\s*-?\s*\d)\b/i.test(textRaw)
  ) {
    key = "longNumberedRoad";
  } else if (bend >= 105 && (type === "turn" || mod.includes("uturn"))) {
    key = "tightTurn";
  } else if (/\bconstruction\b/i.test(textLower)) {
    key = "construction";
  } else if (roadway.has("tunnel") || /\btunnel\b/i.test(textLower)) {
    key = "tunnel";
  } else if (/\bnarrow\b/i.test(textLower)) {
    key = "narrowRoad";
  } else if (/bike\s*lane\s*ends?|lane\s+ends\b/i.test(textRaw)) {
    key = "bikeLaneEnds";
  } else if (/bike\s*cross/i.test(textLower)) {
    key = "bikeCrossing";
  } else if (/\bramp\b/i.test(textLower)) {
    key = "ramp";
  } else if (/\boulevard\b|\bblvd\.?\b|\barterial\b/i.test(textLower)) {
    key = "wideArterial";
  } else if (/traffic\s+signals?\b/i.test(textLower)) {
    key = "stackedSignals";
  } else if (/\bavenue\b/i.test(textLower)) {
    key = "gridAvenue";
  } else if (/\b(highway\s*\d+|motorway)\b/i.test(textLower)) {
    key = "highwayNearby";
  } else if (level === "caution") {
    key = "cautionFallback";
  } else if (onCycleway) {
    key = "separatedBikePath";
  } else if (
    type === "turn" ||
    mod.includes("left") ||
    mod.includes("right")
  ) {
    key = "localTurning";
  } else {
    key = "safeFallback";
  }

  const body = pickStressCueLine(key, varietyIndex, dist);

  const label =
    typeof step.name === "string"
      ? step.name.trim().replace(/\s+/g, " ")
      : "";
  if (
    label.length >= 2 &&
    !body.toLowerCase().includes(label.toLowerCase())
  ) {
    return `${label}: ${lcFirstSentence(body)}`;
  }
  return body;
}

function lcFirstSentence(s: string): string {
  const t = s.trim();
  if (!t.length) return t;
  return t.slice(0, 1).toLowerCase() + t.slice(1);
}

function pushUniqueStressNote(seg: RouteSegment, line: string) {
  if (!seg.stressNotes) seg.stressNotes = [];
  const last = seg.stressNotes[seg.stressNotes.length - 1];
  if (last === line) return;
  seg.stressNotes.push(line);
}

export function navigationCuesFromSteps(steps: RawDirectionsStep[]): NavigationCue[] {
  return steps.map((step, i) => ({
    id: `cue-${i}`,
    instruction: sanitizedStepLine(step),
    distanceM: step.distance,
    durationSec: Math.round(step.duration),
  }));
}

/** Map lines + per-step accordion notes from Directions geometry */
export function buildSegmentsFromSteps(
  steps: RawDirectionsStep[],
  fullLineFallback: RoutePoint[],
): RouteSegment[] {
  const usable = steps.filter((s) => stepToPoints(s).length >= 2);
  if (!usable.length) {
    return fallbackThreeWaySplit(fullLineFallback);
  }

  const out: RouteSegment[] = [];

  usable.forEach((step, stepIndex) => {
    const pts = stepToPoints(step);
    const level = stressLevelFromStep(step);
    const note = stressCueLineFromStep(step, stepIndex);

    const prev = out[out.length - 1];
    if (prev && prev.level === level) {
      prev.points = dedupeJoin(prev.points, pts);
      pushUniqueStressNote(prev, note);
    } else {
      out.push({
        id: `seg-${out.length}`,
        level,
        points: pts,
        stressNotes: [note],
      });
    }
  });

  if (!out.length) return fallbackThreeWaySplit(fullLineFallback);
  return out;
}

function fallbackThreeWaySplit(points: RoutePoint[]): RouteSegment[] {
  const levels = ["safe", "caution", "safe"] as const;
  if (points.length < 2)
    return levels.map((level, index) => ({
      id: `seg-${index}`,
      level,
      points,
      reason: segmentNarrative(level, index),
    }));
  const last = points.length - 1;
  const cut1 = Math.max(1, Math.floor(last / 3));
  const cut2 = Math.max(cut1 + 1, Math.floor((last * 2) / 3));
  return levels.map((level, index) => {
    const slice = [
      points.slice(0, cut1 + 1),
      points.slice(cut1, cut2 + 1),
      points.slice(cut2),
    ][index]!;
    return {
      id: `seg-${index}`,
      level,
      points: slice.length >= 2 ? slice : points,
      reason: segmentNarrative(level, index),
    };
  });
}
