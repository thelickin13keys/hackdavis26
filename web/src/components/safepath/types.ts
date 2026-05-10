export type SafetyLevel = "safe" | "caution" | "danger";

export type RoutePoint = { lng: number; lat: number };

export type RouteSegment = {
  id: string;
  level: SafetyLevel;
  points: RoutePoint[];
  /** Legacy single-line blurbs (mock routes & fallback splits) */
  reason?: string;
  /** One sanitized line per Directions step merged here (accordion) */
  stressNotes?: string[];
};

/** Turn-by-turn from Mapbox Directions (cycling steps) — shown after “Start route”. */
export type NavigationCue = {
  id: string;
  instruction: string;
  distanceM: number;
  durationSec: number;
};

export type Route = {
  id: string;
  name: string;
  subtitle: string;
  durationMin: number;
  distanceMi: number;
  score: number; // 0-100
  segments: RouteSegment[];
  navigationCues?: NavigationCue[];
};

export type StreetAnalysis = {
  id: string;
  street: string;
  imageHue: number;
  level: SafetyLevel;
  tags: { label: string; level: SafetyLevel }[];
  description: string;
};
