import { AlertTriangle, OctagonAlert, ShieldCheck } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { SafetyLevel } from "./types";

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

/**
 * Safety badge showing letter grade with color-coded level.
 */
export function SafetyScore({ score }: { score: number }) {
  const level = levelFromScore(score);
  const s = STYLES[level];
  const grade = letterGrade(score);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#1a1a1a] px-2 py-1"
      aria-label={`Safety grade ${grade}, ${s.label}`}
    >
      <s.Icon className={`size-3.5 ${s.text}`} aria-hidden />
      <span className={`text-[11px] font-semibold ${s.text}`}>{s.label}</span>
      <span className={`text-[13px] font-bold tabular-nums ${s.text}`}>{grade}</span>
    </span>
  );
}
