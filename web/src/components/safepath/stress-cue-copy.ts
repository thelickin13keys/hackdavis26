/**
 * Plain-language stress cues for **Why this route** (one short sentence each).
 *
 * **Mapbox wiring:** Keys are chosen in `mapbox-route-steps.ts` → `stressCueLineFromStep` from each
 * Directions step's `maneuver.type`, `maneuver.instruction`/names, bearings, distance, plus text heuristics
 * documented in Mapbox Directions (maneuver types, cycling profile).
 * New Mapbox maneuver types belong there first, then optionally add tuned copy here under a stable key.
 */
export const STRESS_CUE_COPY = {
  dangerFreeway:
    "Freeway or highway wording here scores as the riskiest part of the route.",

  motorwayInfrastructure:
    "Mapbox marks a motorway-class road class on this Directions step.",

  roundabout:
    "Roundabouts cross many paths, slow down and assume cars may miss you.",

  fork: "The path splits, double check you pick the right lane or side path.",

  merge: "Merging moves cars and bikes together, wait for clear space.",

  trafficSignal:
    "Traffic lights put most of the risk near turns, not while coasting.",

  endOfRoad:
    "Cars coming to a T may not look for riders crossing in front of them.",

  streetRename:
    "When the street name changes, paint and turning lanes can surprise you.",

  longNumberedRoad:
    "Long stretches on numbered roads usually mean heavier car traffic.",

  tightTurn: "Sharp bends block how far you can see.",

  construction: "Work zones can redraw lanes between rides.",

  tunnel: "Tunnels pinch width and glare, expect tight passes.",

  narrowRoad: "Thin roads leave little space when cars squeeze by.",

  bikeLaneEnds:
    "The protected bike lane ends here, expect closer traffic next.",

  bikeCrossing: "Marked bike crossings still clash with turning cars.",

  ramp: "Near ramps drivers speed up and tuck into merges fast.",

  wideArterial: "Broad streets widen the turns cars take across paths.",

  stackedSignals:
    "Many signals in a row often means drivers rush yellow lights.",

  gridAvenue: "Busy avenues get more sideways turns across paths.",

  highwayNearby:
    "Highway tags nearby bump the score even beside bike paths.",

  cautionFallback: [
    "This leg looks busier than a quiet residential stretch.",
    "Pay a little more attention here than on easy cruising stretches.",
    "We marked caution without one single named hazard matching our rules.",
  ],

  separatedBikePath:
    "Separated bike lanes keep cars mostly away, still watch driveway cuts.",

  localTurning:
    "Local turns mainly add risk where small streets touch bigger ones.",

  safeFallback: [
    "Versus merges or highways our rules rank this stretch as quieter.",
    "Mostly steady riding where the model sees fewer conflict tags.",
    "Looks calmer on paper, still trust what you see on the ground.",
  ],
} as const;

export type StressCueCopyKey = keyof typeof STRESS_CUE_COPY;

/** Pick rotating pool copy (stable per leg via variety hash). */
export function pickStressCueLine(
  key: StressCueCopyKey,
  varietyIndex: number,
  distanceM: number,
): string {
  const entry = STRESS_CUE_COPY[key];
  const salt = Math.abs(varietyIndex + Math.round(distanceM / 100));
  if (typeof entry === "string") return entry;
  return entry[salt % entry.length] ?? entry[0]!;
}
