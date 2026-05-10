"use client";

import type { NavigationCue } from "./types";

function formatLegDistance(meters: number): string {
  if (meters < 80) return `${Math.round(meters)} mi`;
  const mi = meters / 1609.344;
  return mi >= 10 ? `${mi.toFixed(1)} mi` : `${mi.toFixed(2)} mi`;
}

function formatDuration(sec: number): string {
  if (sec < 45) return `${sec}s`;
  const m = Math.max(1, Math.round(sec / 60));
  return `${m} min`;
}

export function DirectionsList({ cues }: { cues: NavigationCue[] }) {
  if (!cues.length) {
    return (
      <p className="text-[13px] leading-snug text-[#8a8a8a]">
        Directions will appear once Mapbox cycling routes finish loading for
        this trip.
      </p>
    );
  }

  return (
    <ol className="space-y-2.5 [list-style:none]">
      {cues.map((cue, idx) => (
        <li
          key={cue.id}
          className="rounded-[12px] border border-[#2a2a2a] bg-[#161616]/90 px-3 py-2.5"
        >
          <div className="flex gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#262626] text-[13px] font-semibold tabular-nums text-white">
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-snug text-white">
                {cue.instruction}
              </p>
              <p className="mt-1 text-[11px] font-medium tracking-wide text-[#737373]">
                {formatLegDistance(cue.distanceM)}
                {" - ~"}
                {formatDuration(cue.durationSec)}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
