export type SafetyLevel = "safe" | "caution" | "danger";

export type RoutePoint = { lng: number; lat: number };

export type RouteSegment = {
  id: string;
  level: SafetyLevel;
  points: RoutePoint[];
  /** Narrative shown in “Why this route” accordion */
  reason?: string;
};

export type Route = {
  id: string;
  name: string;
  subtitle: string;
  durationMin: number;
  distanceMi: number;
  score: number; // 0-100
  segments: RouteSegment[];
};

export type StreetAnalysis = {
  id: string;
  street: string;
  imageHue: number;
  level: SafetyLevel;
  tags: { label: string; level: SafetyLevel }[];
  description: string;
};
