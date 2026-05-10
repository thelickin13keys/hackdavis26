import { AlertTriangle, OctagonAlert, ShieldCheck } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { RoutePoint, RouteSegment, SafetyLevel } from "./types";

type SafetyStyle = {
  border: string;
  text: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const STYLES: Record<SafetyLevel, SafetyStyle> = {
  safe: {
    border: "border-[#06C167]",
    text: "text-[#06C167]",
    label: "Safe",
    Icon: ShieldCheck,
  },
  caution: {
    border: "border-[#F5A623]",
    text: "text-[#F5A623]",
    label: "Caution",
    Icon: AlertTriangle,
  },
  danger: {
    border: "border-[#E83B3B]",
    text: "text-[#E83B3B]",
    label: "Serious warning",
    Icon: OctagonAlert,
  },
};

export function letterGrade(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 85) return "A";
  if (score >= 80) return "A-";
  if (score >= 75) return "B+";
  if (score >= 70) return "B";
  if (score >= 65) return "B-";
  if (score >= 60) return "C+";
  if (score >= 55) return "C";
  if (score >= 50) return "C-";
  if (score >= 45) return "D+";
  if (score >= 40) return "D";
  return "F";
}

export function levelFromScore(score: number): SafetyLevel {
  if (score >= 71) return "safe";
  if (score >= 41) return "caution";
  return "danger";
}

export function levelStyles(level: SafetyLevel) {
  return STYLES[level];
}

// ---------- Length-weighted ratios -----------------------------------------

function approxSegmentLengthM(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    // Equirectangular approximation — fine at the ~5 km scales of one route.
    const dLat = (b.lat - a.lat) * 111000;
    const dLng = (b.lng - a.lng) * 111000 * Math.cos((a.lat * Math.PI) / 180);
    total += Math.sqrt(dLat * dLat + dLng * dLng);
  }
  return total;
}

export type LevelRatios = {
  safe: number;    // 0-100, length-weighted percentage
  caution: number;
  danger: number;
};

// Weights for converting a length-percentage breakdown back into a single
// 0–100 score so the letter grade can be derived from the actual ratio rather
// than the upstream Mapbox/SafePath blend. Tuned so:
//   * 100% safe   → 100 (A+)
//   * 100% caution →  50 (C-)
//   * 100% danger →   0 (F)
//   * 50/50 safe/caution → 75 (B+)
const SCORE_WEIGHT_SAFE = 1.0;
const SCORE_WEIGHT_CAUTION = 0.5;
const SCORE_WEIGHT_DANGER = 0.0;

/** Compute a 0-100 safety score from level percentages. Used by letter-grade
 *  display so the grade reflects the actual safe/caution/danger composition
 *  of the route's geometry, not the (possibly-stale) route.score. */
export function scoreFromRatios(ratios: LevelRatios): number {
  return Math.round(
    ratios.safe * SCORE_WEIGHT_SAFE +
      ratios.caution * SCORE_WEIGHT_CAUTION +
      ratios.danger * SCORE_WEIGHT_DANGER,
  );
}

/** Convenience: segments → 0-100 score derived from length-weighted level
 *  ratios. Combine with `letterGrade` for a one-shot grade-from-segments. */
export function scoreFromSegments(segments: RouteSegment[]): number {
  return scoreFromRatios(levelLengthRatios(segments));
}

/** Compute the percentage of total route length spent in each level. Numbers
 *  may not sum to exactly 100 due to rounding; that's fine for display. */
export function levelLengthRatios(segments: RouteSegment[]): LevelRatios {
  let safe = 0;
  let caution = 0;
  let danger = 0;
  for (const seg of segments) {
    const len = approxSegmentLengthM(seg.points);
    if (seg.level === "safe") safe += len;
    else if (seg.level === "caution") caution += len;
    else danger += len;
  }
  const total = safe + caution + danger;
  if (total <= 0) return { safe: 0, caution: 0, danger: 0 };
  return {
    safe: Math.round((safe / total) * 100),
    caution: Math.round((caution / total) * 100),
    danger: Math.round((danger / total) * 100),
  };
}

/** Render the safe / caution / danger length percentages as three colored
 *  numbers separated by thin gray dots. Tabular numerals so the badge doesn't
 *  jitter between routes. `size` controls the px font-size. */
export function LevelRatioReadout({
  ratios,
  size = 13,
}: {
  ratios: LevelRatios;
  size?: number;
}) {
  return (
    <span
      className="inline-flex items-baseline gap-1 font-bold tabular-nums"
      style={{ fontSize: size }}
      aria-label={`${ratios.safe}% safe, ${ratios.caution}% caution, ${ratios.danger}% danger`}
    >
      <span className="text-[#06C167]">{ratios.safe}</span>
      <span className="text-[#525252]" style={{ fontSize: size - 2 }}>·</span>
      <span className="text-[#F5A623]">{ratios.caution}</span>
      <span className="text-[#525252]" style={{ fontSize: size - 2 }}>·</span>
      <span className="text-[#E83B3B]">{ratios.danger}</span>
    </span>
  );
}

/**
 * Safety badge showing a letter grade with a color-coded level chip.
 *
 * Color, label, and letter are all derived from the same source: the route's
 * length-weighted segment composition. So a 100%-safe route shows green +
 * "Safe" + "A+", and a route with serious red exposure shows red + "Serious
 * warning" + low letter — they never disagree.
 *
 * The `score` prop is accepted for API compatibility but no longer used.
 */
export function SafetyScore({
  segments,
}: {
  /** Kept for compat with older callers; unused. */
  score?: number;
  segments: RouteSegment[];
}) {
  const ratios = levelLengthRatios(segments);
  const ratioScore = scoreFromRatios(ratios);
  const level = levelFromScore(ratioScore);
  const s = STYLES[level];
  const grade = letterGrade(ratioScore);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#1a1a1a] px-2 py-1"
      aria-label={`Safety grade ${grade}, ${s.label}, ${ratios.safe}% safe, ${ratios.caution}% caution, ${ratios.danger}% danger`}
    >
      <s.Icon className={`size-3.5 ${s.text}`} aria-hidden />
      <span className={`text-[11px] font-semibold ${s.text}`}>{s.label}</span>
      <span className={`text-[13px] font-bold tabular-nums ${s.text}`}>{grade}</span>
    </span>
  );
}
