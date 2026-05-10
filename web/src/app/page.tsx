"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { toast } from "sonner";

import { MapCanvas } from "@/components/safepath/map-canvas";
import { SidePanel } from "@/components/safepath/side-panel";
import { DESTINATION, ORIGIN, ROUTES } from "@/components/safepath/mock-data";
import { fetchMapboxBikeRoutes } from "@/components/safepath/mapbox-routes";
import type { Route, RoutePoint } from "@/components/safepath/types";

const subscribeToClientHydration = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export default function Home() {
  const mounted = useSyncExternalStore(
    subscribeToClientHydration,
    getClientSnapshot,
    getServerSnapshot,
  );
  const [origin, setOrigin] = useState("UC Davis");
  const [destination, setDestination] = useState("Woodstock's Pizza Davis");
  const [originPoint, setOriginPoint] = useState<RoutePoint>(ORIGIN);
  const [destinationPoint, setDestinationPoint] =
    useState<RoutePoint>(DESTINATION);
  const [map, setMap] = useState<MapboxMap | null>(null);
  const [routes, setRoutes] = useState<Route[]>(ROUTES);
  const [selectedRouteId, setSelectedRouteId] = useState(ROUTES[0].id);
  const [cautiousMode, setCautiousMode] = useState(true);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;

    fetchMapboxBikeRoutes(originPoint, destinationPoint)
      .then((nextRoutes) => {
        if (cancelled) return;
        setRoutes(nextRoutes);
        setSelectedRouteId((current) =>
          nextRoutes.some((route) => route.id === current)
            ? current
            : nextRoutes[0].id,
        );
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        toast("Mapbox routing unavailable", {
          description:
            error instanceof Error
              ? error.message
              : "Keeping the current route on screen.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [mounted, originPoint, destinationPoint]);

  const visibleRoutes = useMemo(() => {
    if (!cautiousMode) return routes;
    return routes.filter((r) => r.score >= 41);
  }, [cautiousMode, routes]);

  const activeRoute = useMemo(
    () =>
      visibleRoutes.find((r) => r.id === selectedRouteId) ?? visibleRoutes[0],
    [visibleRoutes, selectedRouteId],
  );
  const inactiveRoutes = useMemo(
    () => visibleRoutes.filter((r) => r.id !== activeRoute.id),
    [visibleRoutes, activeRoute.id],
  );

  const select = (id: string) => {
    setSelectedRouteId(id);
    const r = routes.find((x) => x.id === id);
    if (r) {
      toast(`${r.name} selected`, {
        description: `${r.distanceMi.toFixed(1)} mi · ${r.durationMin} min`,
      });
    }
  };

  const handleOriginSelect = useCallback(
    ({ label, point }: { label: string; point: RoutePoint }) => {
      setOrigin(label);
      setOriginPoint(point);
      map?.flyTo({ center: [point.lng, point.lat], zoom: 14.5 });
    },
    [map],
  );

  const handleDestinationSelect = useCallback(
    ({ label, point }: { label: string; point: RoutePoint }) => {
      setDestination(label);
      setDestinationPoint(point);
      map?.flyTo({ center: [point.lng, point.lat], zoom: 14.5 });
    },
    [map],
  );

  if (!mounted) {
    return <main className="relative h-dvh w-svw overflow-hidden bg-black" />;
  }

  return (
    <main className="relative h-dvh w-svw overflow-hidden bg-black">
      {/* Map: full bleed on mobile; on desktop, shifted right by the 320px panel. */}
      <div className="absolute inset-0 lg:left-[320px]">
        <MapCanvas
          activeRoute={activeRoute}
          origin={originPoint}
          destination={destinationPoint}
          inactiveRoutes={inactiveRoutes}
          onSelectRoute={select}
          onMapReady={setMap}
        />
      </div>

      <SidePanel
        routes={visibleRoutes}
        map={map}
        selectedRouteId={activeRoute.id}
        onSelectRoute={select}
        origin={origin}
        destination={destination}
        onOriginChange={setOrigin}
        onDestinationChange={setDestination}
        onOriginSelect={handleOriginSelect}
        onDestinationSelect={handleDestinationSelect}
        cautiousMode={cautiousMode}
        onCautiousModeChange={(next) => {
          setCautiousMode(next);
          if (next) {
            const safest = [...routes].sort((a, b) => b.score - a.score)[0];
            setSelectedRouteId(safest.id);
          }
        }}
        onStartRoute={() => {
          toast("Starting route", {
            description: `Heading to ${destination} via ${activeRoute.name.toLowerCase()}.`,
          });
        }}
        expanded={sheetExpanded}
        onToggleExpanded={() => setSheetExpanded((v) => !v)}
      />

      <RouteReasoningPanel route={activeRoute} routes={visibleRoutes} />
    </main>
  );
}

function RouteReasoningPanel({
  route,
  routes,
}: {
  route: Route;
  routes: Route[];
}) {
  const fastestMin = Math.min(...routes.map((r) => r.durationMin));
  const safeSegments = route.segments.filter((s) => s.level === "safe").length;
  const cautionSegments = route.segments.filter(
    (s) => s.level === "caution",
  ).length;
  const dangerSegments = route.segments.filter((s) => s.level === "danger").length;
  const tradeoff = route.durationMin - fastestMin;

  return (
    <aside className="pointer-events-none absolute top-5 right-5 z-20 hidden w-[300px] rounded-[20px] border border-[#333] bg-[#111]/95 p-5 shadow-[0_24px_64px_rgba(0,0,0,0.55)] backdrop-blur lg:block">
      <p className="type-overline">Why this route</p>
      <h2 className="mt-2 text-[22px] leading-tight font-semibold text-white">
        {route.name}
      </h2>
      <p className="mt-2 text-[13px] leading-5 text-[#ababab]">
        {route.score >= 71
          ? "Prioritizes lower-stress corridors and keeps most of the ride on safer segments."
          : "Trades some comfort for another corridor, useful when you want to compare options."}
      </p>

      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        <Metric label="Safe" value={safeSegments} tone="text-[#06C167]" />
        <Metric label="Caution" value={cautionSegments} tone="text-[#F5A623]" />
        <Metric label="Avoid" value={dangerSegments} tone="text-[#E83B3B]" />
      </div>

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

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-[14px] bg-[#1a1a1a] px-2 py-3">
      <div className={`text-[20px] leading-none font-semibold ${tone}`}>
        {value}
      </div>
      <div className="mt-1 text-[10px] font-medium text-[#8a8a8a]">
        {label}
      </div>
    </div>
  );
}
