"use client";

import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { DirectionsList } from "./directions-list";
import { sanitizeDirectionsLine } from "./mapbox-route-steps";
import {
  StreetViewTourCard,
  type SeenHazard,
  type StreetViewTourState,
} from "./street-view-tour";
import type { Route, RoutePoint, SafetyLevel } from "./types";
import {
  letterGrade,
  levelFromScore,
  levelStyles,
  scoreFromSegments,
} from "./safety";
import { segmentNarrative } from "./segment-copy";

type RouteReasoningPanelProps = {
  route: Route;
  routes: Route[];
  showDirections: boolean;
  onBackFromDirections: () => void;
  onStartRoute?: () => void;
  destinationPoint?: RoutePoint;
  destinationName?: string;
  isLoading?: boolean;
  /** Street-View tour state. Hoisted in the page so the same hook drives
   *  both the inline preview here and the cyclist marker on the map. */
  tour?: StreetViewTourState;
};

const panelShellClass =
  "absolute top-5 right-5 bottom-5 z-20 hidden min-h-0 w-[min(100%,clamp(296px,30vw,380px))] min-w-[280px] max-w-[calc(100vw-1rem)] flex-col rounded-[24px] bg-[#1c1c1e]/80 p-5 shadow-[0_24px_64px_rgba(0,0,0,0.55)] backdrop-blur-xl lg:flex";

export function RouteReasoningPanel({
  route,
  routes,
  showDirections,
  onBackFromDirections,
  onStartRoute,
  destinationPoint,
  destinationName,
  isLoading = false,
  tour,
}: RouteReasoningPanelProps) {
  if (showDirections) {
    return (
      <aside className={panelShellClass}>
        <div className="shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="type-overline">Turn-by-turn</p>
              <h2 className="mt-2 break-words text-[22px] leading-tight font-semibold text-white">
                {route.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={onBackFromDirections}
              className="shrink-0 rounded-[10px] border border-[#3a3a3c] bg-[#2c2c2e] px-3 py-2 text-[13px] font-medium text-white hover:bg-[#38383a]"
            >
              Summary
            </button>
          </div>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2 pr-0.5 [scrollbar-gutter:stable]">
          <DirectionsList cues={route.navigationCues ?? []} />
        </div>

        <div className="mt-4 shrink-0 space-y-1 border-t border-[#3a3a3c] pt-4 text-[13px] text-[#d7d7d7]">
          <p className="text-white">
            {route.distanceMi.toFixed(1)} mi - {route.durationMin} min estimated
          </p>
        </div>
      </aside>
    );
  }

  if (isLoading) {
    return (
      <aside className={panelShellClass}>
        <div className="shrink-0 space-y-3">
          <div className="h-3 w-24 animate-pulse rounded-full bg-[#2a2a2a]" />
          <div className="h-5 w-40 animate-pulse rounded-full bg-[#2a2a2a]" />
          <div className="flex items-center gap-3">
            <div className="h-5 w-8 animate-pulse rounded-full bg-[#2a2a2a]" />
            <div className="h-4 w-16 animate-pulse rounded-full bg-[#2a2a2a]" />
            <div className="h-4 w-16 animate-pulse rounded-full bg-[#2a2a2a]" />
          </div>
          <div className="h-[160px] w-full animate-pulse rounded-[12px] bg-[#2a2a2a]" />
        </div>
        <div className="mt-4 flex-1 space-y-px overflow-hidden rounded-[14px] border border-[#3a3a3c] bg-[#2c2c2e]">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-[#38383a] px-4 py-4 last:border-b-0">
              <div className="h-6 w-6 animate-pulse rounded-full bg-[#2a2a2a]" />
              <div className="h-4 w-28 animate-pulse rounded-full bg-[#2a2a2a]" />
            </div>
          ))}
        </div>
      </aside>
    );
  }

  const { factors } = computeVerdict(route);
  // Derive everything from the segment composition so color, letter, and
  // chip styling all agree. (route.score is the upstream blended score and
  // can disagree with the segment ratio after intersection penalties.)
  const ratioScore = scoreFromSegments(route.segments);
  const scoreLevel = levelFromScore(ratioScore);
  const scoreStyle = levelStyles(scoreLevel);

  const safeList = narrativesFor(route, "safe");
  const cautionList = narrativesFor(route, "caution");
  const dangerList = narrativesFor(route, "danger");

  const safeFactors = factors.filter((f) => f.level === "safe");
  const cautionFactors = factors.filter((f) => f.level === "caution");
  const dangerFactors = factors.filter((f) => f.level === "danger");

  return (
    <aside className={panelShellClass}>
      {/* ── Fixed header card ── */}
      <div className="shrink-0 space-y-3">
        {/* Route name */}
        <div className="min-w-0">
          <p className="type-overline">Why this route</p>
          <h2 className="mt-1.5 min-w-0 break-words text-[20px] leading-tight font-semibold text-white">
            {route.name}
          </h2>
        </div>

        {/* Letter grade derived from the route's length-weighted safe /
            caution / danger composition (not the upstream blended score), so
            an all-safe route reliably scores A+ regardless of how the
            score got blended on the way in. */}
        <div className="flex items-center gap-3 text-[13px]">
          <span
            className={`font-bold text-[20px] leading-none tracking-tight ${scoreStyle.text}`}
          >
            {letterGrade(ratioScore)}
          </span>
          <span className="text-[#404040]"></span>
          <span className="text-[#9a9a9a]">{route.durationMin} min</span>
          <span className="text-[#404040]"></span>
          <span className="text-[#9a9a9a]">{route.distanceMi.toFixed(1)} mi</span>
        </div>

        {/* Ride preview — replaces the previous static destination image.
            Shows the agent's Street-View as it walks the route; idle state
            holds a "Preview ride" play button. */}
        {tour ? <StreetViewTourCard tour={tour} /> : null}
      </div>

      {/* ── Scrollable accordion: Safe / Caution / Avoid only ── */}
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2 pr-0.5 [scrollbar-gutter:stable]">
        <Accordion
          multiple
          defaultValue={[]}
          className="w-full min-w-0 rounded-[14px] border border-[#3a3a3c] bg-[#2c2c2e]"
        >
          <ReasonAccordionRow
            value="safe"
            label="Safe"
            count={safeList.length + safeFactors.length}
            toneClass="text-[#06C167]"
            items={safeList}
            factors={safeFactors}
          />
          <ReasonAccordionRow
            value="caution"
            label="Caution"
            count={cautionList.length + cautionFactors.length}
            toneClass="text-[#F5A623]"
            items={cautionList}
            factors={cautionFactors}
          />
          <ReasonAccordionRow
            value="danger"
            label="Serious warning"
            count={dangerList.length + dangerFactors.length}
            toneClass="text-[#E83B3B]"
            items={dangerList}
            factors={dangerFactors}
            hazards={tour?.seenHazards ?? []}
          />
        </Accordion>
      </div>

      {/* ── Pinned Start Route button ── */}
      {onStartRoute && (
        <div className="shrink-0 border-t border-[#3a3a3c] pt-3 pb-1">
          <button
            type="button"
            onClick={onStartRoute}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#14B8A6] text-[15px] font-semibold text-black hover:bg-[#10a090] transition-colors"
          >
            Start route · {route.durationMin} min
          </button>
        </div>
      )}
    </aside>
  );
}

export type FactorLevel = "safe" | "caution" | "danger";

export type DecisionFactor = {
  detail: string;
  level: FactorLevel;
};

export function computeVerdict(route: Route): {
  factors: DecisionFactor[];
} {
  const factors: DecisionFactor[] = [];

  // Route score
  const scoreFactor: FactorLevel =
    route.score >= 70 ? "safe" : route.score >= 50 ? "caution" : "danger";
    factors.push({
      detail:
      route.score >= 70
        ? "Comfortable corridor"
        : route.score >= 50
          ? "Moderate stress mix"
          : "High stress segments",
    level: scoreFactor,
  });

  // Peak posted speed
  if (route.intel?.mapbox.peakPostedMph != null) {
    const mph = Math.round(route.intel.mapbox.peakPostedMph);
    const speedFactor: FactorLevel =
      mph <= 25 ? "safe" : mph <= 55 ? "caution" : "danger";
    factors.push({
      detail:
        mph <= 25
          ? `Peak speed ${mph} mph`
          : mph <= 55
            ? `Peak speed ${mph} mph`
            : `Peak speed ${mph} mph`,
      level: speedFactor,
    });
  }

  // Motorway / tunnel exposure
  const motorway = route.intel?.mapbox.motorwayTouches ?? 0;
  const tunnel = route.intel?.mapbox.tunnelTouches ?? 0;
  if (motorway > 0 || tunnel >= 2) {
    const roadFactor: FactorLevel = motorway > 0 ? "danger" : "caution";
    factors.push({
      detail:
        motorway > 0
          ? `${motorway} motorway-class stretch${motorway === 1 ? "" : "es"} detected`
          : `${tunnel} tunnel legs, watch lighting & width`,
      level: roadFactor,
    });
  } else {
    factors.push({
      detail: "Local streets only",
      level: "safe",
    });
  }

  // Congestion
  const cong = route.intel?.mapbox.congestion;
  if (cong?.available) {
    const highPct = (cong.heavyPct ?? 0) + (cong.severePct ?? 0);
    const congFactor: FactorLevel =
      highPct >= 30 ? "danger" : highPct >= 10 ? "caution" : "safe";
    factors.push({
      detail:
        highPct >= 30
          ? `Heavy or severe congestion`
          : highPct >= 10
            ? `Heavy congestion`
            : "Mostly free-flow traffic",
      level: congFactor,
    });
  }

  // Weather
  const weatherItems = route.intel?.conditions?.items ?? [];
  if (weatherItems.length > 0) {
    const worst = weatherItems.reduce<FactorLevel>((acc, item) => {
      if (item.safety === "danger" || acc === "danger") return "danger";
      if (item.safety === "caution" || acc === "caution") return "caution";
      return "safe";
    }, "safe");
    factors.push({
      detail:
        worst === "danger"
          ? "Precipitation or strong wind"
          : worst === "caution"
            ? "Wind or light rain"
            : "Clear conditions",
      level: worst,
    });
  }

  // Crime — only surface when there are actual incidents to report
  const crime = route.intel?.crime;
  if (crime && !crime.outsideCoverage && crime.violentCount > 0) {
    const label = crime.violentCategories.length > 0
      ? crime.violentCategories.join(", ")
      : "violent offenses";
    factors.push({
      detail: `${crime.violentCount} violent incident${crime.violentCount === 1 ? "" : "s"} nearby`,
      level: crime.level,
    });
  }

  return { factors };
}



export function narrativesFor(route: Route, level: SafetyLevel): string[] {
  const out: string[] = [];
  let ordinal = 0;
  for (const seg of route.segments) {
    if (seg.level !== level) continue;
    const segIndexForNarrative = ordinal;
    ordinal += 1;
    if (seg.stressNotes?.length) {
      for (const raw of seg.stressNotes) {
        const line = sanitizeDirectionsLine(raw);
        if (!line) continue;
        out.push(line);
      }
      continue;
    }
    const fallback = segmentNarrative(level, segIndexForNarrative);
    const raw = seg.reason?.trim() ?? fallback;
    const line = sanitizeDirectionsLine(raw);
    if (!line) continue;
    out.push(line);
  }
  return dedupePreferPlacePrefix(out);
}

/** Compare cues by prose after optional `Street: ` prefix, keeps one bullet, favors labeled variant. */
function stressNoteComparableCore(line: string): string {
  const t = line.trim();
  const idx = t.indexOf(": ");
  if (idx < 2 || idx > 96) return t.replace(/\s+/g, " ").toLowerCase();
  /** Skip times like 12:30 */
  const before = t.slice(0, idx).trim();
  if (/^\d{1,2}:\d{2}/.test(before)) return t.replace(/\s+/g, " ").toLowerCase();
  return t.slice(idx + 2).trim().replace(/\s+/g, " ").toLowerCase();
}

function hasOptionalPlacePrefix(line: string): boolean {
  const t = line.trim();
  const idx = t.indexOf(": ");
  if (idx < 2 || idx > 96) return false;
  const before = t.slice(0, idx).trim();
  if (/^\d{1,2}:\d{2}/.test(before)) return false;
  return before.length <= 72;
}

/** Collapses identical wording with and without `{place}:` prefix (ordering preserved). */
function dedupePreferPlacePrefix(lines: string[]): string[] {
  const orderedKeys: string[] = [];
  const bestByKey = new Map<string, { line: string; place: boolean }>();

  for (const line of lines) {
    const core = stressNoteComparableCore(line);
    if (!core) continue;
    const place = hasOptionalPlacePrefix(line);
    const prev = bestByKey.get(core);
    if (!prev) {
      bestByKey.set(core, { line, place });
      orderedKeys.push(core);
      continue;
    }
    if (place && !prev.place)
      bestByKey.set(core, { line, place });
  }

  return orderedKeys.map((k) => bestByKey.get(k)!.line);
}

function ReasonAccordionRow({
  value,
  label,
  count,
  toneClass,
  items,
  factors = [],
  hazards = [],
}: {
  value: string;
  label: string;
  count: number;
  toneClass: string;
  items: string[];
  factors?: DecisionFactor[];
  /** Hazard sightings from the agent walk — used purely as a pool of route
   *  preview images to attach to existing factor/item entries. Hazards
   *  without a paired entry are dropped; we never inflate the count or
   *  surface a hazard as its own bullet. */
  hazards?: SeenHazard[];
}) {
  const isEmpty = items.length === 0 && factors.length === 0;

  // Round-robin: zip seen hazards onto factor entries first, then onto text
  // items. Once we run out of hazards, remaining entries render text-only.
  const factorImages = hazards.slice(0, factors.length);
  const itemImages = hazards.slice(factors.length, factors.length + items.length);

  return (
    <AccordionItem
      value={value}
      className="border-b border-[#38383a] px-3 py-0.5 last:border-b-0"
    >
      <AccordionTrigger className="rounded-none py-3 text-[#e8e8e8] hover:no-underline">
        <div className="flex min-w-0 w-full items-center gap-3 pr-2">
          <span
            className={`tabular-nums text-[22px] font-semibold leading-none ${toneClass}`}
          >
            {count}
          </span>
          <span className="flex-1 text-left text-[14px] font-medium text-white">
            {label}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-0 pb-2 text-[13px] text-[#c4c4c4] [&>div]:h-auto [&>div]:overflow-visible [&>div]:pb-0">
        {isEmpty ? (
          <p className="pl-1 text-[12px] text-[#757575]">None on this route.</p>
        ) : (
          <div className="pl-1 pr-0.5">
            <ul className="list-none space-y-2">
              {factors.map((f, i) => (
                <ReasonEntry
                  key={`factor-${value}-${i}`}
                  text={f.detail}
                  hazard={factorImages[i]}
                  toneClass={toneClass}
                />
              ))}
              {items.map((text, i) => (
                <ReasonEntry
                  key={`${value}-${i}`}
                  text={text}
                  hazard={itemImages[i]}
                  toneClass={toneClass}
                />
              ))}
            </ul>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function ReasonEntry({
  text,
  hazard,
  toneClass,
}: {
  text: string;
  hazard: SeenHazard | undefined;
  toneClass: string;
}) {
  return (
    <li className="overflow-hidden rounded-lg bg-[#38383a]/60">
      {hazard ? (
        <div className="relative aspect-[16/9] bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hazard.imageUrl}
            alt={hazard.type}
            className="h-full w-full object-cover"
            loading="lazy"
          />
          <span
            className={`absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${toneClass}`}
          >
            {hazard.type.replace(/_/g, " ")}
            {hazard.severity ? ` · ${hazard.severity}` : ""}
          </span>
        </div>
      ) : null}
      <div className="px-3 py-2 text-[12px] leading-snug text-[#d0d0d0] break-words">
        {text}
      </div>
    </li>
  );
}
