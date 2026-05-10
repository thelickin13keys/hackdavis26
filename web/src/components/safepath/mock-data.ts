import type { Route, StreetAnalysis } from "./types";

/**
 * Initial route skeleton inside the Davis bbox we've actually scored.
 * Live SafePath routing replaces this as soon as the app hydrates.
 */

// UC Davis Memorial Union
export const ORIGIN = { lng: -121.7494, lat: 38.5421 };
// Davis Food Co-op
export const DESTINATION = { lng: -121.7421, lat: 38.5485 };

export const ROUTES: Route[] = [
  {
    id: "safest",
    name: "Safest route",
    subtitle: "Well-lit - bike lanes - low traffic",
    durationMin: 28,
    distanceMi: 4.8,
    score: 92,
    segments: [
      {
        id: "s1",
        level: "safe",
        points: [
          ORIGIN,
          { lng: -122.4580, lat: 37.7760 },
          { lng: -122.4450, lat: 37.7830 },
        ],
      },
      {
        id: "s2",
        level: "caution",
        points: [
          { lng: -122.4450, lat: 37.7830 },
          { lng: -122.4300, lat: 37.7950 },
        ],
      },
      {
        id: "s3",
        level: "safe",
        points: [
          { lng: -122.4300, lat: 37.7950 },
          { lng: -122.4200, lat: 37.8020 },
          DESTINATION,
        ],
      },
    ],
  },
  {
    id: "balanced",
    name: "Balanced",
    subtitle: "Mostly bike lanes - 2 caution zones",
    durationMin: 22,
    distanceMi: 4.1,
    score: 71,
    segments: [
      {
        id: "b1",
        level: "safe",
        points: [
          ORIGIN,
          { lng: -122.4560, lat: 37.7740 },
        ],
      },
      {
        id: "b2",
        level: "caution",
        points: [
          { lng: -122.4560, lat: 37.7740 },
          { lng: -122.4380, lat: 37.7870 },
        ],
      },
      {
        id: "b3",
        level: "caution",
        points: [
          { lng: -122.4380, lat: 37.7870 },
          { lng: -122.4240, lat: 37.7970 },
        ],
      },
      {
        id: "b4",
        level: "safe",
        points: [
          { lng: -122.4240, lat: 37.7970 },
          DESTINATION,
        ],
      },
    ],
  },
  {
    id: "fastest",
    name: "Fastest",
    subtitle: "Crosses high-speed corridor",
    durationMin: 18,
    distanceMi: 3.6,
    score: 38,
    segments: [
      {
        id: "f1",
        level: "caution",
        points: [
          ORIGIN,
          { lng: -122.4480, lat: 37.7780 },
        ],
      },
      {
        id: "f2",
        level: "danger",
        points: [
          { lng: -122.4480, lat: 37.7780 },
          { lng: -122.4260, lat: 37.7980 },
        ],
      },
      {
        id: "f3",
        level: "caution",
        points: [
          { lng: -122.4260, lat: 37.7980 },
          DESTINATION,
        ],
      },
    ],
  },
];

export const STREET_ANALYSES: StreetAnalysis[] = [];
