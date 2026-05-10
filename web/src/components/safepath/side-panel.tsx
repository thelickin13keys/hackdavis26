"use client";

import {
  useRef,
  useState,
  useMemo,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Navigation,
  ShieldCheck,
  TrendingUp,
  Route as RouteIcon,
  Clock,
  Bike,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MapboxSearch } from "./mapbox-search";
import { DirectionsList } from "./directions-list";
import { RouteCard } from "./route-card";
import type { NavigationCue, Route, RoutePoint } from "./types";

type SortKey = "safety" | "time" | "distance";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "safety", label: "Safest" },
  { key: "time", label: "Fastest" },
  { key: "distance", label: "Shortest" },
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
  isLoading?: boolean;
  destinationName?: string;
  destinationPoint?: RoutePoint;
};

// ─── Mobile route card helpers ────────────────────────────────────────────────

function getMobileIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("safe")) return ShieldCheck;
  if (n.includes("fast")) return TrendingUp;
  return RouteIcon;
}

function getMobileIconColor(name: string) {
  return name.toLowerCase().includes("safe") ? "#34c759" : "#30b0c7";
}

function MobileRouteCard({
  route,
  selected,
  onSelect,
  onStart,
}: {
  route: Route;
  selected: boolean;
  onSelect: () => void;
  onStart: () => void;
}) {
  const Icon = getMobileIcon(route.name);
  const color = getMobileIconColor(route.name);

  return (
    /* Outer div is the selectable card area; Start is the only true button */
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
      aria-pressed={selected}
      aria-label={`${route.name}: ${route.durationMin} min, ${route.distanceMi.toFixed(1)} mi`}
      className={[
        "w-full text-left rounded-[16px] bg-[#2c2c2e] px-4 py-4 transition-all cursor-pointer",
        selected ? "ring-1 ring-[#34c759]/40" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        {/* Left: icon + info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Icon className="size-[18px] shrink-0" style={{ color }} />
            <span className="font-semibold text-white text-[16px] leading-tight">
              {route.name}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[#8e8e93] text-[13px] mb-1">
            <Clock className="size-3.5 shrink-0" />
            <span>{route.durationMin} min</span>
            <Bike className="size-3.5 shrink-0 ml-1" />
            <span>{route.distanceMi.toFixed(1)} mi</span>
          </div>
          {route.subtitle ? (
            <p className="text-[#8e8e93] text-[12px] leading-snug">
              {route.subtitle}
            </p>
          ) : null}
        </div>

        {/* Right: Start button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStart();
          }}
          className="shrink-0 rounded-full bg-[#34c759] px-5 py-2.5 text-[14px] font-semibold text-black active:opacity-80 transition-opacity"
        >
          Start
        </button>
      </div>
    </div>
  );
}

// ─── iOS-style sheet hook ─────────────────────────────────────────────────────

function useIOSSheet(defaultSnap: "mid" | "full" = "mid") {
  const [snap, setSnap] = useState<"mid" | "full">(defaultSnap);
  const [dragY, setDragY] = useState(0);
  const isDragging = useRef(false);
  const pointerStart = useRef<number | null>(null);

  // translateY for mid: sheet is 88dvh tall; we want ~50dvh visible → offset = 38dvh
  // We express the base as a CSS string and add pixel drag delta via calc()
  const baseCSS = snap === "full" ? "0dvh" : "38dvh";
  const translateCSS =
    dragY !== 0 ? `calc(${baseCSS} + ${dragY}px)` : baseCSS;

  const sheetStyle: CSSProperties = {
    transform: `translateY(${translateCSS})`,
    transition: isDragging.current ? "none" : "transform 0.42s cubic-bezier(0.32, 0.72, 0, 1)",
  };

  function onPointerDown(e: ReactPointerEvent) {
    pointerStart.current = e.clientY;
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (pointerStart.current == null) return;
    let delta = e.clientY - pointerStart.current;

    // Rubber-band: resist dragging up past full expansion
    if (snap === "full" && delta < 0) {
      delta = -Math.sqrt(-delta) * 5;
    }
    // Rubber-band: resist dragging down past mid
    const MAX_DOWN = 80;
    if (snap === "mid" && delta > MAX_DOWN) {
      delta = MAX_DOWN + Math.sqrt(delta - MAX_DOWN) * 5;
    }

    setDragY(delta);
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (pointerStart.current == null) return;
    const delta = e.clientY - pointerStart.current;
    pointerStart.current = null;
    isDragging.current = false;
    setDragY(0);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    if (delta < -40 && snap === "mid") setSnap("full");
    else if (delta > 40 && snap === "full") setSnap("mid");
  }

  return { snap, setSnap, sheetStyle, onPointerDown, onPointerMove, onPointerUp };
}

// ─── Main component ───────────────────────────────────────────────────────────

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
  isLoading = false,
  destinationName,
  destinationPoint,
}: SidePanelProps) {
  const selected =
    routes.find((r) => r.id === selectedRouteId) ?? routes[0];

  const [sortBy, setSortBy] = useState<SortKey>("safety");

  const sortedRoutes = useMemo(() => {
    return [...routes].sort((a, b) => {
      if (sortBy === "safety") return b.score - a.score;
      if (sortBy === "time") return a.durationMin - b.durationMin;
      if (sortBy === "distance") return a.distanceMi - b.distanceMi;
      return 0;
    });
  }, [routes, sortBy]);

  function handleSortChange(key: SortKey) {
    setSortBy(key);
    const top = [...routes].sort((a, b) => {
      if (key === "safety") return b.score - a.score;
      if (key === "time") return a.durationMin - b.durationMin;
      if (key === "distance") return a.distanceMi - b.distanceMi;
      return 0;
    })[0];
    if (top) onSelectRoute(top.id);
  }

  const {
    snap,
    setSnap,
    sheetStyle,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = useIOSSheet("mid");


  return (
    <>
      {/* ════════════════════════════════════════════
          MOBILE: iOS-style bottom sheet (hidden on lg+)
          ════════════════════════════════════════════ */}
      <aside
        className="lg:hidden fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-[28px] bg-[#1c1c1e]"
        style={{
          height: "88dvh",
          ...sheetStyle,
        }}
      >
        {/* Drag handle zone */}
        <div
          className="shrink-0 flex flex-col items-center pt-3 pb-2 touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => setSnap(snap === "mid" ? "full" : "mid")}
        >
          <div className="w-10 h-[5px] rounded-full bg-[#48484a]" />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {/* Search inputs */}
          <div className="px-4 pt-1 pb-4">
            <div className="rounded-[14px] bg-[#2c2c2e] overflow-hidden">
              <MapboxSearch
                dotClass="bg-[#0a84ff]"
                label="From"
                value={origin}
                onTextChange={onOriginChange}
                onSelect={onOriginSelect}
                placeholder="Your location"
              />
              <div className="mx-3 h-px bg-[#38383a]" />
              <MapboxSearch
                dotClass="ring-2 ring-[#8e8e93] bg-transparent"
                label="To"
                value={destination}
                onTextChange={onDestinationChange}
                onSelect={onDestinationSelect}
                placeholder="Search destination"
              />
            </div>
          </div>

          {/* Navigation cues (when active) */}
          {navigationActive ? (
            <div className="px-4 pb-4">
              <div className="rounded-[14px] bg-[#2c2c2e] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#38383a]">
                  <p className="text-[16px] font-semibold text-white">Directions</p>
                  <button
                    type="button"
                    onClick={onExitNavigation}
                    className="text-[14px] text-[#0a84ff] font-medium"
                  >
                    Summary
                  </button>
                </div>
                <div className="max-h-[35dvh] overflow-y-auto px-4 py-3">
                  <DirectionsList cues={navigationCues} />
                </div>
              </div>
            </div>
          ) : null}

          {/* Route cards */}
          <div className="px-4 pb-4 space-y-2.5">
            {isLoading
              ? [...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="rounded-[16px] bg-[#2c2c2e] px-4 py-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="size-[18px] rounded-full bg-[#3a3a3c] animate-pulse" />
                          <div className="h-4 w-28 rounded-full bg-[#3a3a3c] animate-pulse" />
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="size-3.5 rounded-full bg-[#3a3a3c] animate-pulse" />
                          <div className="h-3 w-16 rounded-full bg-[#3a3a3c] animate-pulse" />
                          <div className="size-3.5 rounded-full bg-[#3a3a3c] animate-pulse ml-1" />
                          <div className="h-3 w-12 rounded-full bg-[#3a3a3c] animate-pulse" />
                        </div>
                        <div className="h-3 w-40 rounded-full bg-[#3a3a3c] animate-pulse" />
                      </div>
                      <div className="h-9 w-16 rounded-full bg-[#3a3a3c] animate-pulse" />
                    </div>
                  </div>
                ))
              : sortedRoutes.map((r) => (
                  <MobileRouteCard
                    key={r.id}
                    route={r}
                    selected={r.id === selectedRouteId}
                    onSelect={() => onSelectRoute(r.id)}
                    onStart={() => {
                      onSelectRoute(r.id);
                      onStartRoute();
                    }}
                  />
                ))}
          </div>

          {/* Destination info section */}
          {(destinationName || destination) ? (
            <div className="px-4 pb-6">
              <h3 className="text-[18px] font-semibold text-white mb-3">
                {destinationName ?? destination}
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="aspect-square rounded-[12px] bg-[#2c2c2e]"
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Bottom tab bar */}
        <div
          className="shrink-0 flex border-t border-[#38383a] bg-[#1c1c1e]"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
        >
          <button
            type="button"
            className="flex-1 flex flex-col items-center gap-1 pt-3 pb-1"
          >
            <Bike className="size-6 text-[#34c759]" />
            <span className="text-[10px] font-medium text-[#34c759]">Bike</span>
          </button>
          <button
            type="button"
            className="flex-1 flex flex-col items-center gap-1 pt-3 pb-1"
          >
            <TriangleAlert className="size-6 text-[#8e8e93]" />
            <span className="text-[10px] font-medium text-[#8e8e93]">Report</span>
          </button>
        </div>
      </aside>

      {/* ════════════════════════════════════════════
          DESKTOP: docked 320px left rail (hidden below lg)
          ════════════════════════════════════════════ */}
      <aside
        className={[
          "hidden lg:flex absolute z-30 flex-col bg-[#1a1a1a]",
          "inset-y-0 left-0 w-[320px] border-r border-[#333]",
        ].join(" ")}
      >

        {/* Search inputs */}
        <div className="shrink-0 px-6 pt-6">
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
          <div className="shrink-0 border-b border-[#333]">
            <div className="flex items-center justify-between px-6 py-3">
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
            <div className="max-h-[34dvh] overflow-y-auto px-6 pb-3">
              <DirectionsList cues={navigationCues} />
            </div>
          </div>
        ) : null}

        {/* Sort toggle */}
        <div className="mx-6 mt-3 shrink-0">
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
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-6 pt-3 pb-3 scrollbar-hide">
          {isLoading
            ? [...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="rounded-[12px] border-2 border-[#333] bg-[#0f0f0f] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="h-4 w-24 animate-pulse rounded-full bg-[#2a2a2a]" />
                    <div className="h-6 w-20 animate-pulse rounded-full bg-[#2a2a2a]" />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-3 w-3 animate-pulse rounded-full bg-[#2a2a2a]" />
                    <div className="h-3 w-12 animate-pulse rounded-full bg-[#2a2a2a]" />
                    <div className="h-3 w-20 animate-pulse rounded-full bg-[#2a2a2a]" />
                    <div className="ml-auto h-3 w-10 animate-pulse rounded-full bg-[#2a2a2a]" />
                  </div>
                  <div className="mt-2.5 h-1 w-full animate-pulse rounded-full bg-[#2a2a2a]" />
                </div>
              ))
            : sortedRoutes.map((r) => (
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
          className="shrink-0 border-t border-[#222] bg-[#1a1a1a] px-6 pt-3"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
        >
          <Button
            onClick={onStartRoute}
            className="h-12 w-full rounded-[10px] bg-white text-[15px] font-semibold text-black hover:bg-[#f0f0f0]"
          >
            <Navigation className="mr-2 size-4" aria-hidden />
            Start route - {selected.durationMin} min
          </Button>
        </div>
      </aside>
    </>
  );
}
