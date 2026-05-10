import type { Route, StreetAnalysis } from "./types";

/**
 * Initial route skeleton from UC Davis to Woodstock's Pizza in Davis. Live
 * Mapbox Directions replaces this as soon as the app hydrates.
 */

export const ORIGIN = { lng: -121.760891, lat: 38.53908 };
export const DESTINATION = { lng: -121.738991, lat: 38.544777 };

export const ROUTES: Route[] = [
  {
    id: "safest",
    name: "Safest route",
    subtitle: "Well-lit · bike lanes · low traffic",
    durationMin: 18,
    distanceMi: 2.4,
    score: 92,
    segments: [
      {
        id: "s1",
        level: "safe",
        points: [
          ORIGIN,
          { lng: -121.7548, lat: 38.5405 },
          { lng: -121.7492, lat: 38.5424 },
        ],
      },
      {
        id: "s2",
        level: "caution",
        points: [
          { lng: -121.7492, lat: 38.5424 },
          { lng: -121.7444, lat: 38.5439 },
        ],
      },
      {
        id: "s3",
        level: "safe",
        points: [
          { lng: -121.7444, lat: 38.5439 },
          DESTINATION,
        ],
      },
    ],
  },
  {
    id: "balanced",
    name: "Balanced",
    subtitle: "Mostly bike lanes · 2 caution zones",
    durationMin: 14,
    distanceMi: 2.0,
    score: 71,
    segments: [
      {
        id: "b1",
        level: "safe",
        points: [
          ORIGIN,
          { lng: -121.7552, lat: 38.5389 },
        ],
      },
      {
        id: "b2",
        level: "caution",
        points: [
          { lng: -121.7552, lat: 38.5389 },
          { lng: -121.7482, lat: 38.5415 },
        ],
      },
      {
        id: "b3",
        level: "caution",
        points: [
          { lng: -121.7482, lat: 38.5415 },
          { lng: -121.7428, lat: 38.5427 },
        ],
      },
      {
        id: "b4",
        level: "safe",
        points: [
          { lng: -121.7428, lat: 38.5427 },
          DESTINATION,
        ],
      },
    ],
  },
  {
    id: "fastest",
    name: "Fastest",
    subtitle: "Crosses high-speed corridor",
    durationMin: 11,
    distanceMi: 1.7,
    score: 38,
    segments: [
      {
        id: "f1",
        level: "caution",
        points: [
          ORIGIN,
          { lng: -121.7542, lat: 38.5411 },
        ],
      },
      {
        id: "f2",
        level: "danger",
        points: [
          { lng: -121.7542, lat: 38.5411 },
          { lng: -121.7464, lat: 38.5451 },
        ],
      },
      {
        id: "f3",
        level: "caution",
        points: [
          { lng: -121.7464, lat: 38.5451 },
          DESTINATION,
        ],
      },
    ],
  },
];

export const STREET_ANALYSES: StreetAnalysis[] = [];
