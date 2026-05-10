import type { RoutePoint } from "./types";

export type CrimeIntel = {
  totalIncidents: number;
  violentCount: number;
  topCategories: string[];
  violentCategories: string[];
  scorePenalty: number;
  lines: string[];
  level: "safe" | "caution" | "danger";
  attribution: string;
  outsideCoverage: boolean;
  city?: string;
};

// ─── City registry ────────────────────────────────────────────────────────────
// Each entry: public Socrata open-data endpoint, bounding box, field names.
// No API key required — all datasets are CC0 / public domain.

type CityDef = {
  name: string;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  /**
   * Socrata JSON endpoint. `null` means the city is recognized (bounding-box
   * matched) but has no public incident-level open-data API — we surface a
   * graceful "limited coverage" note instead of silently skipping it.
   */
  endpoint: string | null;
  latField: string;
  lngField: string;
  /** SoQL date field used for the 7-day cutoff */
  dateField: string;
  /** Column that holds the offense category/description */
  categoryField: string;
  /** Extra $where clause appended to ensure lat/lng are not null */
  extraFilter?: string;
};

const CITIES: CityDef[] = [
  {
    name: "San Francisco",
    bounds: { minLat: 37.63, maxLat: 37.84, minLng: -122.53, maxLng: -122.35 },
    endpoint: "https://data.sfgov.org/resource/wg3w-h783.json",
    latField: "latitude",
    lngField: "longitude",
    dateField: "incident_date",
    categoryField: "incident_category",
  },
  {
    name: "Los Angeles",
    bounds: { minLat: 33.70, maxLat: 34.34, minLng: -118.67, maxLng: -118.15 },
    endpoint: "https://data.lacity.org/resource/2nrs-mtv8.json",
    latField: "lat",
    lngField: "lon",
    dateField: "date_occ",
    categoryField: "crm_cd_desc",
    extraFilter: "lat IS NOT NULL AND lon IS NOT NULL AND lat != 0",
  },
  {
    name: "Chicago",
    bounds: { minLat: 41.64, maxLat: 42.02, minLng: -87.94, maxLng: -87.52 },
    endpoint: "https://data.cityofchicago.org/resource/ijzp-q8t2.json",
    latField: "latitude",
    lngField: "longitude",
    dateField: "date",
    categoryField: "primary_type",
    extraFilter: "latitude IS NOT NULL",
  },
  {
    name: "New York City",
    bounds: { minLat: 40.50, maxLat: 40.92, minLng: -74.26, maxLng: -73.70 },
    endpoint: "https://data.cityofnewyork.us/resource/5uac-w243.json",
    latField: "latitude",
    lngField: "longitude",
    dateField: "cmplnt_fr_dt",
    categoryField: "ofns_desc",
    extraFilter: "latitude IS NOT NULL",
  },
  {
    name: "Seattle",
    bounds: { minLat: 47.49, maxLat: 47.74, minLng: -122.44, maxLng: -122.23 },
    endpoint: "https://data.seattle.gov/resource/tazs-3rd5.json",
    latField: "latitude",
    lngField: "longitude",
    dateField: "offense_start_datetime",
    categoryField: "offense_parent_group",
    extraFilter: "latitude IS NOT NULL",
  },
  {
    name: "Austin",
    bounds: { minLat: 30.10, maxLat: 30.52, minLng: -97.95, maxLng: -97.57 },
    endpoint: "https://data.austintexas.gov/resource/fdj4-gpfu.json",
    latField: "latitude",
    lngField: "longitude",
    dateField: "occurred_date",
    categoryField: "highest_offense_desc",
    extraFilter: "latitude IS NOT NULL",
  },
  {
    name: "Denver",
    bounds: { minLat: 39.61, maxLat: 39.91, minLng: -105.11, maxLng: -104.72 },
    endpoint: "https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_CRIME_PUBLICCRIMESDATA_P/FeatureServer/0/query",
    latField: "geo_lat",
    lngField: "geo_lon",
    dateField: "first_occurrence_date",
    categoryField: "offense_type_id",
    extraFilter: "geo_lat IS NOT NULL",
  },
  {
    name: "Portland",
    bounds: { minLat: 45.43, maxLat: 45.65, minLng: -122.84, maxLng: -122.47 },
    endpoint: "https://www.portlandoregon.gov/police/OpenData/CrimeData/CrimeData_2024.csv",
    latField: "OpenDataLat",
    lngField: "OpenDataLon",
    dateField: "OccurDate",
    categoryField: "OffenseCategory",
  },
  {
    // Davis PD publishes crime statistics but has no public incident-level
    // Socrata API. endpoint: null triggers a "limited coverage" note in the UI
    // without affecting the route score.
    name: "Davis",
    bounds: { minLat: 38.52, maxLat: 38.57, minLng: -121.78, maxLng: -121.70 },
    endpoint: null,
    latField: "",
    lngField: "",
    dateField: "",
    categoryField: "",
  },
];

// ─── Category classification (keyword-based, works across all schemas) ─────────

const VIOLENT_KEYWORDS =
  /\b(assault|rob(?:bery)?|homicide|murder|rape|sex(?:ual)?\s+assault|weapon|kidnap|shooting|stabbing|carjack|aggravated|battery|threat|intimidat|human\s+traff)\b/i;

const PROPERTY_KEYWORDS =
  /\b(theft|larceny|burglary|vandal|damage|motor\s+vehicle\s+theft|stolen|arson|trespass|fraud|forgery|embezzl)\b/i;

function classifyCategory(cat: string | undefined): "violent" | "property" | "other" {
  if (!cat) return "other";
  if (VIOLENT_KEYWORDS.test(cat)) return "violent";
  if (PROPERTY_KEYWORDS.test(cat)) return "property";
  return "other";
}

// ─── City detection ────────────────────────────────────────────────────────────

function detectCity(pt: RoutePoint): CityDef | null {
  for (const city of CITIES) {
    const { minLat, maxLat, minLng, maxLng } = city.bounds;
    if (
      pt.lat >= minLat &&
      pt.lat <= maxLat &&
      pt.lng >= minLng &&
      pt.lng <= maxLng
    ) {
      return city;
    }
  }
  return null;
}

// ─── Bounding box helpers ──────────────────────────────────────────────────────

/** Compute a tight bounding box ~radiusM metres around a point. */
function pointBox(pt: RoutePoint, radiusM: number) {
  const latDelta = radiusM / 111_000;
  const lngDelta = radiusM / (111_000 * Math.cos((pt.lat * Math.PI) / 180));
  return {
    minLat: pt.lat - latDelta,
    maxLat: pt.lat + latDelta,
    minLng: pt.lng - lngDelta,
    maxLng: pt.lng + lngDelta,
  };
}

// ─── Socrata query ─────────────────────────────────────────────────────────────

type SocrataRow = Record<string, string | undefined>;

async function queryCity(
  city: CityDef,
  pt: RoutePoint,
  radiusM: number,
  cutoffStr: string,
  signal?: AbortSignal,
): Promise<SocrataRow[]> {
  if (!city.endpoint) return [];

  const box = pointBox(pt, radiusM);

  const clauses: string[] = [
    `${city.latField} >= '${box.minLat}'`,
    `${city.latField} <= '${box.maxLat}'`,
    `${city.lngField} >= '${box.minLng}'`,
    `${city.lngField} <= '${box.maxLng}'`,
    `${city.dateField} >= '${cutoffStr}'`,
  ];
  if (city.extraFilter) clauses.push(city.extraFilter);

  // Denver uses ArcGIS REST, not Socrata — skip
  if (city.endpoint.includes("arcgis.com")) return [];

  const url = new URL(city.endpoint);
  url.searchParams.set("$where", clauses.join(" AND "));
  url.searchParams.set("$select", `${city.categoryField}`);
  url.searchParams.set("$limit", "100");

  const res = await fetch(url.toString(), {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  return (await res.json()) as SocrataRow[];
}

// ─── Route sampling ────────────────────────────────────────────────────────────

function sampleIndices(total: number, count: number): number[] {
  if (total < 3) return [];
  const inner = total - 2;
  const step = Math.max(1, Math.floor(inner / (count + 1)));
  const indices: number[] = [];
  for (let i = 1; indices.length < count && i < total - 1; i += step) {
    indices.push(i);
  }
  return indices;
}

function titleCase(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function fetchRouteCrimeIntel(
  routePoints: RoutePoint[],
  signal?: AbortSignal,
): Promise<CrimeIntel> {
  const noData = (outsideCoverage = false, city?: string): CrimeIntel => ({
    totalIncidents: 0,
    violentCount: 0,
    topCategories: [],
    violentCategories: [],
    scorePenalty: 0,
    lines: [],
    level: "safe",
    attribution: "Socrata Open Data crime reports.",
    outsideCoverage,
    city,
  });

  if (routePoints.length < 2) return noData(true);

  // Detect city from route midpoint
  const midPt = routePoints[Math.floor(routePoints.length / 2)]!;
  const city = detectCity(midPt);
  if (!city) return noData(true);

  // City recognised but no open incident API — surface a helpful note
  if (!city.endpoint) {
    return {
      totalIncidents: 0,
      violentCount: 0,
      topCategories: [],
      violentCategories: [],
      scorePenalty: 0,
      lines: [
        `${city.name} PD publishes crime statistics but does not yet have a public incident-level API. Check the local police department's website for recent reports.`,
      ],
      level: "safe",
      attribution: `${city.name} Police Department (no open data API available).`,
      outsideCoverage: false,
      city: city.name,
    };
  }

  const samplePts = sampleIndices(routePoints.length, 4).map(
    (i) => routePoints[i]!,
  );
  if (!samplePts.length) return noData(false, city.name);

  // 7-day cutoff
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Abort after 6s if no signal provided
  const effectiveSignal =
    signal ??
    (typeof AbortSignal !== "undefined" && AbortSignal.timeout
      ? AbortSignal.timeout(6000)
      : undefined);

  let results: SocrataRow[][] = [];
  try {
    results = await Promise.all(
      samplePts.map((pt) =>
        queryCity(city, pt, 200, cutoffStr, effectiveSignal).catch(() => []),
      ),
    );
  } catch {
    return noData(false, city.name);
  }

  // Aggregate (all rows, no incident_id dedup since we don't select it)
  const allRows = results.flat();
  if (!allRows.length) return noData(false, city.name);

  const catCounts = new Map<string, number>();
  const violentCatCounts = new Map<string, number>();
  let violentCount = 0;
  let propertyCount = 0;

  for (const row of allRows) {
    const cat = row[city.categoryField] ?? "";
    catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
    const cls = classifyCategory(cat);
    if (cls === "violent") {
      violentCount++;
      violentCatCounts.set(cat, (violentCatCounts.get(cat) ?? 0) + 1);
    } else if (cls === "property") {
      propertyCount++;
    }
  }

  const topCategories = [...catCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => titleCase(cat));

  const violentCategories = [...violentCatCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([cat]) => titleCase(cat));

  const total = allRows.length;

  // Violent incidents weigh 2×
  const weighted = violentCount * 2 + propertyCount;
  let scorePenalty = 0;
  let level: CrimeIntel["level"] = "safe";

  if (weighted >= 20) {
    scorePenalty = 20;
    level = "danger";
  } else if (weighted >= 10) {
    scorePenalty = 14;
    level = "danger";
  } else if (weighted >= 5) {
    scorePenalty = 9;
    level = "caution";
  } else if (weighted >= 2) {
    scorePenalty = 5;
    level = "caution";
  }

  const period = "last 7 days";
  const lines: string[] = [];

  if (violentCount > 0) {
    lines.push(
      `${violentCount} violent incident${violentCount === 1 ? "" : "s"} (assault, robbery, etc.) reported near this corridor in the ${period}.`,
    );
  }
  if (propertyCount > 0) {
    lines.push(
      `${propertyCount} property crime${propertyCount === 1 ? "" : "s"} (theft, vandalism, etc.) nearby over the same period.`,
    );
  }
  if (topCategories.length > 0) {
    lines.push(`Most common: ${topCategories.join(", ")}.`);
  }
  if (violentCount === 0 && propertyCount === 0 && total > 0) {
    lines.push(
      `${total} incident${total === 1 ? "" : "s"} logged near the route — none in violent or property categories.`,
    );
  }

  return {
    totalIncidents: total,
    violentCount,
    topCategories,
    violentCategories,
    scorePenalty,
    lines,
    level,
    attribution: `${city.name} open crime data via Socrata (public domain). Last 7 days, ~200 m corridor sample.`,
    outsideCoverage: false,
    city: city.name,
  };
}
