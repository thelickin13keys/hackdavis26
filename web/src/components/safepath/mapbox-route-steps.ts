import type { NavigationCue, RoutePoint, RouteSegment, SafetyLevel } from "./types";
import { segmentNarrative } from "./segment-copy";

/** Directions v5 step (cycling) */
export type RawDirectionsStep = {
  distance: number;
  duration: number;
  geometry?: { type?: string; coordinates?: [number, number][] };
  name?: string;
  mode?: string;
  maneuver?: {
    type?: string;
    instruction?: string;
    modifier?: string;
    bearing_after?: number;
    bearing_before?: number;
  };
};

export type RawDirectionsLeg = { steps?: RawDirectionsStep[] };

export function collectCyclingSteps(legs: RawDirectionsLeg[] | undefined) {
  if (!legs?.length) return [];
  return legs.flatMap((leg) => leg.steps ?? []).filter((step) => {
    const mode = (step.mode ?? "cycling").toLowerCase();
    return mode === "cycling";
  });
}

const DANGER_RE =
  /\b(freeway|expressway|interstate|motorway|highway\s*\d+|i-\s*\d|us\s*-\s*\d|ca\s*-\s*\d+|state\s+route|sr\s*-\s*\d+|route\s+[0-9]{2,})\b/i;

/** Crossings / higher-complexity moves */
const CAUTION_MANEUVER = new Set([
  "roundabout",
  "rotary",
  "fork",
  "merge",
  "end of road",
  "new name",
  "traffic signal",
]);

const CAUTION_TEXT =
  /\b(boulevard|blvd\.?|arterial|avenue|traffic signals?|roundabout|rotary|ramp\b|bike crossing|bike lane ends|narrow|tunnel|construction)\b/i;

function deltaBearingDegrees(step: RawDirectionsStep): number {
  const a = step.maneuver?.bearing_before;
  const b = step.maneuver?.bearing_after;
  if (typeof a !== "number" || typeof b !== "number") return 0;
  let d = Math.abs(b - a) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/** Stress tier from Mapbox step context (better than slicing the polyline blindly). */
export function stressLevelFromStep(step: RawDirectionsStep): SafetyLevel {
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

  /** Short connector turns stay calmer unless sharp */
  return "safe";
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
  if (!uniq.length) return "Bike route · Mapbox directions";
  if (uniq.length === 1) return `${uniq[0]} · cycling`;
  return `${uniq[0]} → … → ${uniq[uniq.length - 1]}`;
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

  usable.forEach((step) => {
    const pts = stepToPoints(step);
    const level = stressLevelFromStep(step);
    const note = sanitizedStepLine(step);

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
