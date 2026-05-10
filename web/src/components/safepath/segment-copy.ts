import type { SafetyLevel } from "./types";

const SAFE: readonly string[] = [
  "Calmer corridor with slower traffic or good bike infrastructure.",
  "Straighter sight lines and fewer merge conflicts.",
  "Mostly residential or campus-adjacent streets with predictable movement.",
];

const CAUTION: readonly string[] = [
  "Shared lane or higher vehicle volume — stay visible and predictable.",
  "Approach crossings with extra caution and signal timing in mind.",
  "Mix of bikes and cars; watch for driveways and parked cars.",
];

const DANGER: readonly string[] = [
  "Higher-speed corridor — minimize time here and prefer crossings at signals.",
  "Busier arterial — merge early and take the lane only when safe.",
  "Complex intersections or limited protection — proceed carefully.",
];

const BY_LEVEL = {
  safe: SAFE,
  caution: CAUTION,
  danger: DANGER,
} as const;

export function segmentNarrative(level: SafetyLevel, sliceIndex: number): string {
  const pool = BY_LEVEL[level];
  return pool[sliceIndex % pool.length] ?? pool[0];
}
