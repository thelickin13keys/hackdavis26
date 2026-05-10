"use client";

import type { CSSProperties } from "react";
import { Clock } from "lucide-react";
import type { Route } from "./types";
import { SafetyScore, levelFromScore, levelStyles } from "./safety";

type RouteCardProps = {
  route: Route;
  selected: boolean;
  onSelect: () => void;
  fastestMin: number;
};

export function RouteCard({
  route,
  selected,
  onSelect,
  fastestMin,
}: RouteCardProps) {
  const level = levelFromScore(route.score);
  const s = levelStyles(level);
  const tradeoff = route.durationMin - fastestMin;
  const segmentWidths = getSegmentWidths(route);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${route.name}: ${route.durationMin} minutes, safety ${route.score} of 100, ${s.label}`}
      className={[
        "group block w-full rounded-[12px] border-2 bg-[#0f0f0f] p-3 text-left transition-colors duration-200",
        "hover:bg-[#141414] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
        selected ? s.border : "border-[#333]",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="type-h3 text-white">{route.name}</h3>
          <p className="type-caption mt-0.5 truncate">{route.subtitle}</p>
        </div>
        <SafetyScore score={route.score} />
      </div>

      <div className="mt-3 flex items-center gap-2 text-[12px]">
        <Clock className="size-3.5 text-[#ababab]" aria-hidden />
        <span className="font-semibold text-white">{route.durationMin} min</span>
        <span className="text-[#ababab]">
          {tradeoff === 0
            ? "fastest"
            : `+${tradeoff} min vs fastest`}
        </span>
        <span className="ml-auto text-[#ababab]">
          {route.distanceMi.toFixed(1)} mi
        </span>
      </div>

      <div className="mt-2.5 flex h-1 w-full overflow-hidden rounded-full bg-[#0a0a0a]">
        {route.segments.map((seg, i) => (
          <div
            key={`${seg.id}-${i}`}
            className={[
              "h-full shrink-0 grow-0 basis-[var(--segment-width)]",
              segmentColorClass(seg.level),
            ].join(" ")}
            style={
              {
                "--segment-width": segmentWidths[i],
              } as CSSProperties & { "--segment-width": string }
            }
            aria-hidden
          />
        ))}
      </div>
    </button>
  );
}

function getSegmentWidths(route: Route) {
  // Approximate segment length in meters using equirectangular projection.
  // Rounding keeps SSR and client hydration strings identical.
  const lengths = route.segments.map((seg) =>
    seg.points.reduce((acc, p, idx, arr) => {
      if (idx === 0) return 0;
      const prev = arr[idx - 1];
      const meanLat = ((p.lat + prev.lat) / 2) * (Math.PI / 180);
      const dx = (p.lng - prev.lng) * Math.cos(meanLat) * 111_000;
      const dy = (p.lat - prev.lat) * 111_000;
      return acc + Math.hypot(dx, dy);
    }, 0),
  );
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  return lengths.map((length) => `${((length / total) * 100).toFixed(4)}%`);
}

function segmentColorClass(level: Route["segments"][number]["level"]) {
  if (level === "safe") return "bg-[#06C167]";
  if (level === "caution") return "bg-[#F5A623]";
  return "bg-[#E83B3B]";
}
