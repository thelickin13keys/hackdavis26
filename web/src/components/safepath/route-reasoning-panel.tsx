"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { Route, SafetyLevel } from "./types";
import { segmentNarrative } from "./segment-copy";

type RouteReasoningPanelProps = {
  route: Route;
  routes: Route[];
};

export function RouteReasoningPanel({
  route,
  routes,
}: RouteReasoningPanelProps) {
  const fastestMin = Math.min(...routes.map((r) => r.durationMin));
  const tradeoff = route.durationMin - fastestMin;

  const safeList = narrativesFor(route, "safe");
  const cautionList = narrativesFor(route, "caution");
  const dangerList = narrativesFor(route, "danger");

  return (
    <aside className="absolute top-5 right-5 z-20 hidden w-[300px] rounded-[20px] border border-[#333] bg-[#111]/95 p-5 shadow-[0_24px_64px_rgba(0,0,0,0.55)] backdrop-blur lg:block">
      <p className="type-overline">Why this route</p>
      <h2 className="mt-2 text-[22px] leading-tight font-semibold text-white">
        {route.name}
      </h2>
      <p className="mt-2 text-[13px] leading-5 text-[#ababab]">
        {route.score >= 71
          ? "Prioritizes lower-stress corridors and keeps most of the ride on safer segments."
          : "Trades some comfort for another corridor, useful when you want to compare options."}
      </p>

      <Accordion
        multiple
        defaultValue={[]}
        className="mt-5 w-full rounded-[14px] border border-[#2a2a2a] bg-[#161616]"
      >
        <ReasonAccordionRow
          value="safe"
          label="Safe"
          count={safeList.length}
          toneClass="text-[#06C167]"
          items={safeList}
        />
        <ReasonAccordionRow
          value="caution"
          label="Caution"
          count={cautionList.length}
          toneClass="text-[#F5A623]"
          items={cautionList}
        />
        <ReasonAccordionRow
          value="danger"
          label="Avoid"
          count={dangerList.length}
          toneClass="text-[#E83B3B]"
          items={dangerList}
        />
      </Accordion>

      <div className="mt-5 space-y-3 border-t border-[#2a2a2a] pt-4 text-[13px] text-[#d7d7d7]">
        <p>
          <span className="text-white">{route.durationMin} min</span>
          {tradeoff > 0 ? `, +${tradeoff} min vs fastest` : ", fastest option"}
        </p>
        <p>
          <span className="text-white">{route.distanceMi.toFixed(1)} mi</span>{" "}
          with a safety score of{" "}
          <span className="text-white">{route.score}/100</span>.
        </p>
      </div>
    </aside>
  );
}

function narrativesFor(route: Route, level: SafetyLevel): string[] {
  let n = 0;
  const out: string[] = [];
  for (const seg of route.segments) {
    if (seg.level !== level) continue;
    out.push(seg.reason ?? segmentNarrative(level, n));
    n += 1;
  }
  return out;
}

function ReasonAccordionRow({
  value,
  label,
  count,
  toneClass,
  items,
}: {
  value: string;
  label: string;
  count: number;
  toneClass: string;
  items: string[];
}) {
  return (
    <AccordionItem
      value={value}
      className="border-b border-[#262626] px-3 py-0.5 last:border-b-0"
    >
      <AccordionTrigger className="rounded-none py-3 text-[#e8e8e8] hover:no-underline">
        <div className="flex w-full items-center gap-3 pr-2">
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
      <AccordionContent className="px-0 pb-3 text-[13px] text-[#c4c4c4] [&>div]:h-auto [&>div]:pb-0">
        {items.length === 0 ? (
          <p className="pl-1 text-[12px] text-[#757575]">None on this route.</p>
        ) : (
          <ul className="list-none space-y-2 pl-1">
            {items.map((text, i) => (
              <li
                key={`${value}-${i}`}
                className="rounded-lg bg-[#1f1f1f]/80 px-3 py-2 leading-snug"
              >
                {text}
              </li>
            ))}
          </ul>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
