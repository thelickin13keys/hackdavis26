"use client";

import {
  useRef,
  useState,
  useMemo,
  useCallback,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ShieldCheck,
  TrendingUp,
  Route as RouteIcon,
  Clock,
  Bike,
  TriangleAlert,
  ChevronDown,
  ArrowUp,
  CornerUpRight,
  CornerUpLeft,
  MapPin,
  X,
} from "lucide-react";
import { MapboxSearch } from "./mapbox-search";
import { DirectionsList } from "./directions-list";
import type { NavigationCue, Route, RoutePoint } from "./types";
import { computeVerdict, narrativesFor } from "./route-reasoning-panel";

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
  return "#14B8A6";
}

// Badge colours for Safe / Caution / Avoid
const ACCORDION_TIERS = [
  {
    key: "safe" as const,
    label: "Safe",
    bg: "bg-[#0f2b1a]",
    text: "text-[#46A758]",
  },
  {
    key: "caution" as const,
    label: "Caution",
    bg: "bg-[#3d2e0d]",
    text: "text-[#ffd60a]",
  },
  {
    key: "danger" as const,
    label: "Avoid",
    bg: "bg-[#3d0d0d]",
    text: "text-[#ff453a]",
  },
] as const;

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
  const [open, setOpen] = useState(false);
  const Icon = getMobileIcon(route.name);
  const color = getMobileIconColor(route.name);

  const toggleOpen = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      setOpen((v) => !v);
    },
    [],
  );

  // Safety data for the accordion
  const { factors } = computeVerdict(route);
  const tierData = ACCORDION_TIERS.map((tier) => ({
    ...tier,
    items: [
      ...narrativesFor(route, tier.key),
      ...factors.filter((f) => f.level === tier.key).map((f) => f.detail),
    ],
  }));

  return (
    <div
      className={[
        "w-full rounded-[16px] bg-[#2c2c2e] overflow-hidden transition-all",
        selected ? "ring-1 ring-[#14B8A6]/50" : "",
      ].join(" ")}
    >
      {/* ── Tappable card header ── */}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}
        aria-pressed={selected}
        className="px-4 pt-4 pb-3 cursor-pointer"
      >
        {/* Row 1: icon + name + chevron */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="size-[18px] shrink-0" style={{ color }} />
            <span className="font-semibold text-white text-[16px] leading-tight">
              {route.name}
            </span>
          </div>
          <button
            type="button"
            onClick={toggleOpen}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleOpen(e); }}
            aria-expanded={open}
            className="shrink-0 ml-2 p-1 rounded-full text-[#8e8e93] active:bg-[#3a3a3c] transition-colors"
          >
            <ChevronDown
              className={[
                "size-5 transition-transform duration-200",
                open ? "rotate-180" : "",
              ].join(" ")}
            />
          </button>
        </div>

        {/* Row 2: subtitle */}
        {route.subtitle ? (
          <p className="text-[#8e8e93] text-[13px] mb-3 leading-snug">
            {route.subtitle}
          </p>
        ) : null}

        {/* Row 3: stats + Start */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[#8e8e93] text-[13px]">
            <Clock className="size-3.5 shrink-0" />
            <span>{route.durationMin} min</span>
            <Bike className="size-3.5 shrink-0 ml-1" />
            <span>{route.distanceMi.toFixed(1)} mi</span>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStart(); }}
            className="shrink-0 rounded-full bg-[#14B8A6] px-5 py-2 text-[14px] font-semibold text-black active:opacity-80 transition-opacity"
          >
            Start
          </button>
        </div>
      </div>

      {/* ── Accordion: Safe / Caution / Avoid ── */}
      {open ? (
        <div className="border-t border-[#38383a] px-4 pt-3 pb-4 space-y-3">
          {tierData.map((tier) => (
            <div key={tier.key}>
              {/* Tier header */}
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className={[
                    "size-6 rounded-[6px] flex items-center justify-center text-[13px] font-bold shrink-0",
                    tier.bg,
                    tier.text,
                  ].join(" ")}
                >
                  {tier.items.length}
                </span>
                <span className="text-white text-[14px] font-medium">
                  {tier.label}
                </span>
              </div>
              {/* Tier items */}
              {tier.items.length === 0 ? (
                <p className="ml-8 text-[12px] text-[#48484a]">None on this route.</p>
              ) : (
                <ul className="ml-8 space-y-1">
                  {tier.items.map((item, i) => (
                    <li
                      key={i}
                      className="flex gap-1.5 text-[12px] text-[#8e8e93] leading-snug"
                    >
                      <span className="shrink-0 mt-px">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Mobile navigation overlay ───────────────────────────────────────────────

function navIcon(instruction: string) {
  const l = instruction.toLowerCase();
  if (l.includes("turn right") || l.includes("right onto") || l.includes("right on")) return CornerUpRight;
  if (l.includes("turn left") || l.includes("left onto") || l.includes("left on")) return CornerUpLeft;
  if (l.includes("slight right")) return CornerUpRight;
  if (l.includes("slight left")) return CornerUpLeft;
  if (l.includes("arrive") || l.includes("destination")) return MapPin;
  return ArrowUp;
}

function navStreet(instruction: string): string {
  const m = instruction.match(/onto (.+)/i) ?? instruction.match(/ on (.+)/i);
  if (m) return m[1]!.trim();
  return instruction.length > 28 ? instruction.slice(0, 28) + "…" : instruction;
}

function MobileNavTurnCard({ cues }: { cues: NavigationCue[] }) {
  const cur = cues[0];
  const nxt = cues[1];
  if (!cur) return null;
  const CurIcon = navIcon(cur.instruction);
  const NxtIcon = nxt ? navIcon(nxt.instruction) : null;
  return (
    <div className="mx-4 mt-safe-top mt-4">
      <div className="rounded-[20px] bg-[#1c1c1e]/80 backdrop-blur-xl shadow-2xl px-5 py-4">
        <div className="flex items-center gap-4">
          <CurIcon className="size-10 text-white shrink-0" strokeWidth={2.5} />
          <span className="text-[26px] font-bold text-white leading-tight truncate">
            {navStreet(cur.instruction)}
          </span>
        </div>
        {NxtIcon && nxt ? (
          <div className="mt-3 pt-3 border-t border-[#2c2c2e] flex items-center gap-3">
            <NxtIcon className="size-5 text-[#8e8e93] shrink-0" />
            <span className="text-[14px] text-[#8e8e93] truncate">
              {navStreet(nxt.instruction)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MobileNavBar({
  route,
  onEnd,
}: {
  route: Route;
  onEnd: () => void;
}) {
  const arrival = useMemo(() => {
    const d = new Date(Date.now() + route.durationMin * 60_000);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?(AM|PM)$/i, "");
  }, [route.durationMin]);

  return (
    <div
      className="bg-[#1c1c1e] px-5 pt-4"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
    >
      <div className="flex items-end gap-3">
        {/* Minutes */}
        <div className="flex-1 text-center">
          <p className="text-[32px] font-bold text-white leading-none tabular-nums">
            {route.durationMin}
          </p>
          <p className="text-[11px] text-[#8e8e93] mt-1 tracking-wide uppercase">
            Minutes
          </p>
        </div>
        {/* Arrival */}
        <div className="flex-1 text-center">
          <div className="inline-block">
            <p className="text-[32px] font-bold text-white leading-none tabular-nums">
              {arrival}
            </p>
          </div>
          <p className="text-[11px] text-[#8e8e93] mt-1 tracking-wide uppercase">
            Arrival
          </p>
        </div>
        {/* Miles */}
        <div className="flex-1 text-center">
          <p className="text-[32px] font-bold text-white leading-none tabular-nums">
            {route.distanceMi.toFixed(1)}
          </p>
          <p className="text-[11px] text-[#8e8e93] mt-1 tracking-wide uppercase">
            Miles
          </p>
        </div>
        {/* End button */}
        <button
          type="button"
          onClick={onEnd}
          aria-label="End navigation"
          className="size-14 rounded-full bg-[#ff3b30] flex items-center justify-center shrink-0 active:opacity-80 transition-opacity shadow-lg"
        >
          <X className="size-6 text-white" strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}

// ─── iOS-style sheet hook (3 snap points) ────────────────────────────────────

type SnapPoint = "peek" | "mid" | "full";

// Sheet is 88dvh. translateY offsets:
//   peek → 70dvh visible ≈ 18dvh  (just "Where to?" + tab bar)
//   mid  → 38dvh offset  ≈ 50dvh visible
//   full → 0             → all 88dvh visible
const SNAP_CSS: Record<SnapPoint, string> = {
  peek: "70dvh",
  mid:  "38dvh",
  full: "0dvh",
};
const SNAP_ORDER: SnapPoint[] = ["peek", "mid", "full"];

function useIOSSheet(defaultSnap: SnapPoint = "peek") {
  const [snap, setSnap] = useState<SnapPoint>(defaultSnap);
  const [dragY, setDragY] = useState(0);
  const isDragging = useRef(false);
  const pointerStart = useRef<number | null>(null);

  const baseCSS = SNAP_CSS[snap];
  const translateCSS =
    dragY !== 0 ? `calc(${baseCSS} + ${dragY}px)` : baseCSS;

  const sheetStyle: CSSProperties = {
    transform: `translateY(${translateCSS})`,
    transition: isDragging.current
      ? "none"
      : "transform 0.42s cubic-bezier(0.32, 0.72, 0, 1)",
  };

  function onPointerDown(e: ReactPointerEvent) {
    pointerStart.current = e.clientY;
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (pointerStart.current == null) return;
    let delta = e.clientY - pointerStart.current;

    // Rubber-band: resist past top (full)
    if (snap === "full" && delta < 0) delta = -Math.sqrt(-delta) * 5;
    // Rubber-band: resist past bottom (peek)
    if (snap === "peek" && delta > 40)
      delta = 40 + Math.sqrt(delta - 40) * 5;

    setDragY(delta);
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (pointerStart.current == null) return;
    const delta = e.clientY - pointerStart.current;
    pointerStart.current = null;
    isDragging.current = false;
    setDragY(0);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    const idx = SNAP_ORDER.indexOf(snap);
    if (delta < -40 && idx < SNAP_ORDER.length - 1)
      setSnap(SNAP_ORDER[idx + 1]!);
    else if (delta > 40 && idx > 0)
      setSnap(SNAP_ORDER[idx - 1]!);
  }

  return { snap, setSnap, sheetStyle, onPointerDown, onPointerMove, onPointerUp };
}

// ─── Segment widths helper (for desktop route bar) ───────────────────────────

function computeSegmentWidths(route: Route): string[] {
  const lengths = route.segments.map((seg) =>
    seg.points.reduce((acc, p, idx, arr) => {
      if (idx === 0) return 0;
      const prev = arr[idx - 1]!;
      const meanLat = ((p.lat + prev.lat) / 2) * (Math.PI / 180);
      const dx = (p.lng - prev.lng) * Math.cos(meanLat) * 111_000;
      const dy = (p.lat - prev.lat) * 111_000;
      return acc + Math.hypot(dx, dy);
    }, 0),
  );
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  return lengths.map((l) => `${((l / total) * 100).toFixed(4)}%`);
}

function segmentBarColor(level: Route["segments"][number]["level"]) {
  if (level === "safe") return "bg-[#06C167]";
  if (level === "caution") return "bg-[#F5A623]";
  return "bg-[#E83B3B]";
}

// ─── Desktop route card ───────────────────────────────────────────────────────

function DesktopRouteCard({
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
  const widths = computeSegmentWidths(route);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
      aria-pressed={selected}
      className={[
        "w-full rounded-[16px] bg-[#2c2c2e] overflow-hidden cursor-pointer",
        "transition-shadow duration-200",
        selected ? "ring-1 ring-[#14B8A6]/60" : "",
      ].join(" ")}
    >
      <div className="px-4 pt-4 pb-3">
        {/* Name row */}
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="size-[18px] shrink-0" style={{ color }} />
          <span className="font-semibold text-white text-[16px] leading-tight">
            {route.name}
          </span>
        </div>

        {/* Subtitle */}
        {route.subtitle ? (
          <p className="text-[#8e8e93] text-[13px] mb-3 leading-snug">
            {route.subtitle}
          </p>
        ) : null}

        {/* Stats + Start */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[#8e8e93] text-[13px]">
            <Clock className="size-3.5 shrink-0" />
            <span>
              {route.durationMin} min&nbsp;•&nbsp;{route.distanceMi.toFixed(1)} mi
            </span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStart();
            }}
            className="shrink-0 rounded-full bg-[#14B8A6] px-5 py-2 text-[14px] font-semibold text-black hover:bg-[#10a090] active:opacity-80 transition-colors"
          >
            Start
          </button>
        </div>
      </div>

      {/* Safety bar */}
      <div className="mx-4 mb-3 flex h-[5px] overflow-hidden rounded-full bg-black/30">
        {route.segments.map((seg, i) => (
          <div
            key={`${seg.id}-${i}`}
            className={["h-full shrink-0 grow-0", segmentBarColor(seg.level)].join(" ")}
            style={{ width: widths[i] }}
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
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

  // Route list sorted by safety (mobile always shows safest-first)
  const mobileSortedRoutes = useMemo(
    () => [...routes].sort((a, b) => b.score - a.score),
    [routes],
  );

  return (
    <>
      {/* ════════════════════════════════════════════
          MOBILE: Navigation overlay (when nav active)
          ════════════════════════════════════════════ */}
      {navigationActive && (
        <div className="lg:hidden">
          {/* Turn card — floats over the map at the top */}
          <div className="fixed top-0 inset-x-0 z-40 pointer-events-none">
            <MobileNavTurnCard cues={navigationCues} />
          </div>
          {/* Nav stats bar + tab bar — pinned to bottom */}
          <div className="fixed bottom-0 inset-x-0 z-40">
            <MobileNavBar route={selected} onEnd={onExitNavigation} />
            <div
              className="flex border-t border-[#38383a] bg-[#1c1c1e]"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
            >
              <button type="button" className="flex-1 flex flex-col items-center gap-1 pt-3 pb-1">
                <Bike className="size-6 text-[#14B8A6]" />
                <span className="text-[10px] font-medium text-[#14B8A6]">Bike</span>
              </button>
              <button type="button" className="flex-1 flex flex-col items-center gap-1 pt-3 pb-1">
                <TriangleAlert className="size-6 text-[#8e8e93]" />
                <span className="text-[10px] font-medium text-[#8e8e93]">Report</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          MOBILE: iOS-style bottom sheet (hidden on lg+)
          Slides off-screen during navigation.
          ════════════════════════════════════════════ */}
      <aside
        className="lg:hidden fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-[28px] bg-[#1c1c1e]"
        style={{
          height: "88dvh",
          ...(navigationActive
            ? { transform: "translateY(100%)", transition: "transform 0.4s cubic-bezier(0.32,0.72,0,1)" }
            : sheetStyle),
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
          <div className="px-4 pt-2 pb-4">
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

          {/* Route cards */}
          <div className="px-4 pb-4 space-y-2.5">
            {isLoading
              ? [...Array(3)].map((_, i) => (
                  <div key={i} className="rounded-[16px] bg-[#2c2c2e] px-4 py-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="size-[18px] rounded-full bg-[#3a3a3c] animate-pulse" />
                      <div className="h-4 w-28 rounded-full bg-[#3a3a3c] animate-pulse" />
                    </div>
                    <div className="h-3 w-40 rounded-full bg-[#3a3a3c] animate-pulse" />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-16 rounded-full bg-[#3a3a3c] animate-pulse" />
                        <div className="h-3 w-12 rounded-full bg-[#3a3a3c] animate-pulse" />
                      </div>
                      <div className="h-8 w-16 rounded-full bg-[#3a3a3c] animate-pulse" />
                    </div>
                  </div>
                ))
              : mobileSortedRoutes.map((r) => (
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

          {/* Destination info */}
          {(destinationName || destination) ? (
            <div className="px-4 pb-6">
              <h3 className="text-[18px] font-semibold text-white mb-3">
                {destinationName ?? destination}
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="aspect-square rounded-[12px] bg-[#2c2c2e]" />
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
            <Bike className="size-6 text-[#14B8A6]" />
            <span className="text-[10px] font-medium text-[#14B8A6]">Bike</span>
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
          DESKTOP: floating glass panel (hidden below lg)
          ════════════════════════════════════════════ */}
      <aside
        className="hidden lg:flex absolute z-30 flex-row rounded-[24px] shadow-2xl backdrop-blur-xl bg-[#1c1c1e]/80"
        style={{ top: "20px", left: "20px", bottom: "20px", width: "380px" }}
      >
        {/* ── Narrow icon strip — rounded left corners to match the aside ── */}
        <div className="w-[60px] shrink-0 flex flex-col items-center pt-6 gap-6 border-r border-white/5 rounded-l-[24px]">
          <button
            type="button"
            className="flex flex-col items-center gap-1"
          >
            <Bike className="size-6 text-[#14B8A6]" />
            <span className="text-[10px] font-medium text-[#14B8A6]">Bike</span>
          </button>
          <button
            type="button"
            className="flex flex-col items-center gap-1"
          >
            <TriangleAlert className="size-6 text-[#8e8e93]" />
            <span className="text-[10px] font-medium text-[#8e8e93]">Report</span>
          </button>
        </div>

        {/* ── Main scrollable content ── */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Title */}
          <div className="shrink-0 px-4 pt-5 pb-1">
            <h1 className="text-white font-bold text-[20px] tracking-tight">StreetBike</h1>
          </div>

          {/* Search inputs — no overflow-hidden so the autocomplete dropdown isn't clipped */}
          <div className="shrink-0 px-4 pt-3 pb-4">
            <div className="rounded-[14px] bg-[#2c2c2e]">
              <MapboxSearch
                dotClass="bg-[#0a84ff]"
                label="From"
                value={origin}
                onTextChange={onOriginChange}
                onSelect={onOriginSelect}
                placeholder="Your location"
              />
              <div className="mx-4 h-px bg-[#38383a]" />
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

          {/* Route cards (scrollable) */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-2.5 scrollbar-hide">
            {isLoading
              ? [...Array(3)].map((_, i) => (
                  <div key={i} className="rounded-[16px] bg-[#2c2c2e] px-4 py-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="size-[18px] rounded-full bg-[#3a3a3c] animate-pulse" />
                      <div className="h-4 w-28 rounded-full bg-[#3a3a3c] animate-pulse" />
                    </div>
                    <div className="h-3 w-40 rounded-full bg-[#3a3a3c] animate-pulse" />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-16 rounded-full bg-[#3a3a3c] animate-pulse" />
                        <div className="h-3 w-12 rounded-full bg-[#3a3a3c] animate-pulse" />
                      </div>
                      <div className="h-8 w-16 rounded-full bg-[#3a3a3c] animate-pulse" />
                    </div>
                    <div className="h-[5px] w-full rounded-full bg-[#3a3a3c] animate-pulse" />
                  </div>
                ))
              : sortedRoutes.map((r) => (
                  <DesktopRouteCard
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

            {/* Destination info */}
            {(destinationName || destination) ? (
              <div className="pt-2 pb-2">
                <h3 className="text-[18px] font-semibold text-white mb-3">
                  {destinationName ?? destination}
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="aspect-square rounded-[12px] bg-[#2c2c2e]" />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}
