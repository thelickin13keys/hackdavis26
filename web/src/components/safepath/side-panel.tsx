"use client";

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { Navigation, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MapboxSearch } from "./mapbox-search";
import { RouteCard } from "./route-card";
import type { Route, RoutePoint } from "./types";

type SidePanelProps = {
  routes: Route[];
  map: MapboxMap | null;
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
  map,
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
}: SidePanelProps) {
  const selected =
    routes.find((r) => r.id === selectedRouteId) ?? routes[0];
  const fastestMin = Math.min(...routes.map((r) => r.durationMin));

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
            map={map}
            dotClass="bg-white"
            label="From"
            value={origin}
            onTextChange={onOriginChange}
            onSelect={onOriginSelect}
            placeholder="Current location"
          />
          <div className="mx-3 h-px bg-[#262626]" />
          <MapboxSearch
            map={map}
            dotClass="bg-transparent ring-2 ring-white"
            label="To"
            value={destination}
            onTextChange={onDestinationChange}
            onSelect={onDestinationSelect}
            placeholder="Search destination"
          />
        </div>
      </div>

      {/* Cautious mode */}
      <div className="mx-4 mt-3 flex shrink-0 items-center justify-between gap-3 rounded-[10px] border border-[#333] bg-[#0f0f0f] px-3 py-2.5 lg:mx-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <Shield className="size-4 shrink-0 text-[#06C167]" aria-hidden />
          <div className="min-w-0">
            <p className="type-h3 text-white">Cautious mode</p>
            <p className="type-caption mt-0.5 truncate">
              Avoids unsafe roads
            </p>
          </div>
        </div>
        <Switch
          checked={cautiousMode}
          onCheckedChange={onCautiousModeChange}
          className="shrink-0 data-[state=checked]:bg-[#06C167]"
          aria-label="Cautious mode"
        />
      </div>

      {/* Route cards (scrollable) */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 pt-3 pb-3 scrollbar-hide lg:px-6">
        {routes.map((r) => (
          <RouteCard
            key={r.id}
            route={r}
            selected={r.id === selectedRouteId}
            onSelect={() => onSelectRoute(r.id)}
            fastestMin={fastestMin}
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
