import type { Route, StreetAnalysis } from "./types";

/**
 * Three demo routes from a Capitol-area origin to the Tower Bridge area in
 * downtown Sacramento (~0.7 mi). Coordinates are real lng/lat so they render
 * on top of the live Mapbox street network.
 */

export const ORIGIN = { lng: -121.4944, lat: 38.5816 };
export const DESTINATION = { lng: -121.7494, lat: 38.5422 };

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
          { lng: -121.4944, lat: 38.5816 },
          { lng: -121.4944, lat: 38.583 },
          { lng: -121.4985, lat: 38.583 },
        ],
      },
      {
        id: "s2",
        level: "caution",
        points: [
          { lng: -121.4985, lat: 38.583 },
          { lng: -121.502, lat: 38.583 },
        ],
      },
      {
        id: "s3",
        level: "safe",
        points: [
          { lng: -121.502, lat: 38.583 },
          { lng: -121.502, lat: 38.5807 },
          { lng: -121.5066, lat: 38.5807 },
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
          { lng: -121.4944, lat: 38.5816 },
          { lng: -121.4985, lat: 38.5816 },
        ],
      },
      {
        id: "b2",
        level: "caution",
        points: [
          { lng: -121.4985, lat: 38.5816 },
          { lng: -121.502, lat: 38.5816 },
        ],
      },
      {
        id: "b3",
        level: "caution",
        points: [
          { lng: -121.502, lat: 38.5816 },
          { lng: -121.502, lat: 38.5807 },
        ],
      },
      {
        id: "b4",
        level: "safe",
        points: [
          { lng: -121.502, lat: 38.5807 },
          { lng: -121.5066, lat: 38.5807 },
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
          { lng: -121.4944, lat: 38.5816 },
          { lng: -121.4944, lat: 38.5805 },
        ],
      },
      {
        id: "f2",
        level: "danger",
        points: [
          { lng: -121.4944, lat: 38.5805 },
          { lng: -121.5005, lat: 38.5805 },
        ],
      },
      {
        id: "f3",
        level: "caution",
        points: [
          { lng: -121.5005, lat: 38.5805 },
          { lng: -121.5066, lat: 38.5805 },
          { lng: -121.5066, lat: 38.5807 },
        ],
      },
    ],
  },
];

export const STREET_ANALYSES: StreetAnalysis[] = [];
