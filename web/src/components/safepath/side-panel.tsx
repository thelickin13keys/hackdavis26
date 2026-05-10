"use client";

import {
  useRef,
  useState,
  useMemo,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MapboxSearch } from "./mapbox-search";
import { DirectionsList } from "./directions-list";
import { RouteCard } from "./route-card";
import type { NavigationCue, Route, RoutePoint } from "./types";

type SortKey = "safety" | "time" | "distance";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "safety",   label: "Safety"   },
  { key: "time",     label: "Time"     },
  { key: "distance", label: "Distance" },
];

type SidePanelProps = {
  routes: Route[];
  selectedRouteId: string;
  onSelectRoute: (id: string) => void;
  origin: string;
  destination: string;
  onOriginChange: (v: string) => void;
  onDestinationChange: (v: string) => void;
  onOriginSelect: (place: { label: string; point: RoutePoint }) => void;
  onDestinationSelect: (place: { label: string; point: RoutePoint }) => void;
  cautiousMode: boolean;
  onCautiousModeChange: (next: boolean) => void;
  onStartRoute: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  navigationActive: boolean;
  navigationCues: NavigationCue[];
  onExitNavigation: () => void;
};

/**
 * The only floating UI on the screen.
 *
 * - Mobile/tablet (<lg): bottom sheet, drag-to-expand, holds search + toggle +
 *   route cards + a pinned CTA.
 * - Desktop (lg+): docked 320px-wide left rail. Map fills the rest.
 */
export function SidePanel({
  routes,
  selectedRouteId,
  onSelectRoute,
  origin,
  destination,
  onOriginChange,
  onDestinationChange,
  onOriginSelect,
  onDestinationSelect,
  cautiousMode,
  onCautiousModeChange,
  onStartRoute,
  expanded,
  onToggleExpanded,
  navigationActive,
  navigationCues,
  onExitNavigation,
}: SidePanelProps) {
  const selected =
    routes.find((r) => r.id === selectedRouteId) ?? routes[0];

  const [sortBy, setSortBy] = useState<SortKey>("safety");

  const sortedRoutes = useMemo(() => {
    return [...routes].sort((a, b) => {
      if (sortBy === "safety")   return b.score - a.score;
      if (sortBy === "time")     return a.durationMin - b.durationMin;
      if (sortBy === "distance") return a.distanceMi - b.distanceMi;
      return 0;
    });
  }, [routes, sortBy]);

  function handleSortChange(key: SortKey) {
    setSortBy(key);
    const top = [...routes].sort((a, b) => {
      if (key === "safety")   return b.score - a.score;
      if (key === "time")     return a.durationMin - b.durationMin;
      if (key === "distance") return a.distanceMi - b.distanceMi;
      return 0;
    })[0];
    if (top) onSelectRoute(top.id);
  }

  // Drag-to-expand on mobile.
  const dragStart = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    dragStart.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragStart.current == null) return;
    setDrag(e.clientY - dragStart.current);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragStart.current == null) return;
    const dy = e.clientY - dragStart.current;
    dragStart.current = null;
    setDrag(0);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (dy < -60 && !expanded) onToggleExpanded();
    else if (dy > 60 && expanded) onToggleExpanded();
  };

  return (
    <aside
      className={[
        "absolute z-30 flex flex-col bg-[#1a1a1a]",
        "transition-[max-height,transform] duration-300 ease-out",
        // Mobile: bottom sheet (full width)
        "inset-x-0 bottom-0 rounded-t-[20px] border-t border-[#333]",
        expanded ? "max-h-[88dvh]" : "max-h-[48dvh]",
        // Desktop (lg+): docked 320px-wide left rail, full viewport height.
        // `right-auto` releases the mobile inset-x-0 so width:320px takes over.
        "lg:inset-y-0 lg:left-0 lg:right-auto lg:w-[320px] lg:max-h-none lg:rounded-none lg:border-0 lg:border-r lg:border-[#333]",
      ].join(" ")}
      style={{
        transform: drag !== 0 ? `translateY(${Math.max(drag, -200)}px)` : undefined,
      }}
    >
      {/* Drag handle (mobile) */}
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={() => {
          if (Math.abs(drag) < 4) onToggleExpanded();
        }}
        className="mx-auto mt-2 flex h-6 w-full shrink-0 items-center justify-center touch-none lg:hidden"
        aria-label={expanded ? "Collapse" : "Expand"}
      >
        <span className="block h-1 w-10 rounded-full bg-[#333]" />
      </button>

      {/* Search inputs */}
      <div className="shrink-0 px-4 pt-3 lg:px-6 lg:pt-6">
        <div className="rounded-[10px] border border-[#333] bg-[#0f0f0f]">
          <MapboxSearch
            dotClass="bg-white"
            label="From"
            value={origin}
            onTextChange={onOriginChange}
            onSelect={onOriginSelect}
            placeholder="Current location"
          />
          <div className="mx-3 h-px bg-[#262626]" />
          <MapboxSearch
            dotClass="bg-transparent ring-2 ring-white"
            label="To"
            value={destination}
            onTextChange={onDestinationChange}
            onSelect={onDestinationSelect}
            placeholder="Search destination"
          />
        </div>
      </div>

      {navigationActive ? (
        <div className="shrink-0 border-b border-[#333] lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-[16px] font-semibold tracking-tight text-white">
              Directions
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onExitNavigation}
              className="h-8 rounded-[8px] border-[#424242] bg-[#161616] text-[13px] text-white hover:bg-[#222]"
            >
              Summary
            </Button>
          </div>
          <div className="max-h-[34dvh] overflow-y-auto px-4 pb-3">
            <DirectionsList cues={navigationCues} />
          </div>
        </div>
      ) : null}


      {/* Sort toggle */}
      <div className="mx-4 mt-3 shrink-0 lg:mx-6">
        <div className="flex rounded-[8px] border border-[#333] bg-[#0f0f0f] p-0.5">
          {SORT_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => handleSortChange(key)}
              className={[
                "flex-1 rounded-[6px] py-1.5 text-[12px] font-medium transition-colors",
                sortBy === key
                  ? "bg-[#2a2a2a] text-white"
                  : "text-[#6a6a6a] hover:text-[#aaa]",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Route cards (scrollable) */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 pt-3 pb-3 scrollbar-hide lg:px-6">
        {sortedRoutes.map((r) => (
          <RouteCard
            key={r.id}
            route={r}
            selected={r.id === selectedRouteId}
            onSelect={() => onSelectRoute(r.id)}
          />
        ))}
      </div>

      {/* Pinned CTA */}
      <div
        className="shrink-0 border-t border-[#222] bg-[#1a1a1a] px-4 pt-3 lg:px-6"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
      >
        <Button
          onClick={onStartRoute}
          className="h-12 w-full rounded-[10px] bg-white text-[15px] font-semibold text-black hover:bg-[#f0f0f0]"
        >
          <Navigation className="mr-2 size-4" aria-hidden />
          Start route · {selected.durationMin} min
        </Button>
      </div>
    </aside>
  );
}
