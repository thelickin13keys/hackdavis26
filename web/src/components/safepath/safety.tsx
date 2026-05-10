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
    label: "Avoid",
    Icon: OctagonAlert,
  },
};

export function levelFromScore(score: number): SafetyLevel {
  if (score >= 71) return "safe";
  if (score >= 41) return "caution";
  return "danger";
}

export function levelStyles(level: SafetyLevel) {
  return STYLES[level];
}

/**
 * The single source of safety information per route. Color + icon + label
 * — never just color.
 */
export function SafetyScore({ score }: { score: number }) {
  const level = levelFromScore(score);
  const s = STYLES[level];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#1a1a1a] px-2 py-1"
      aria-label={`Safety score ${score} of 100, ${s.label}`}
    >
      <s.Icon className={`size-3.5 ${s.text}`} aria-hidden />
      <span className={`text-[11px] font-semibold ${s.text}`}>{s.label}</span>
      <span className="text-[11px] font-medium text-white">{score}</span>
    </span>
  );
}
