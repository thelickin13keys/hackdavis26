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
import { RouteReasoningPanel } from "@/components/safepath/route-reasoning-panel";
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
  const [origin, setOrigin] = useState("Golden Gate Park");
  const [destination, setDestination] = useState("Pier 39");
  const [originPoint, setOriginPoint] = useState<RoutePoint>(ORIGIN);
  const [destinationPoint, setDestinationPoint] =
    useState<RoutePoint>(DESTINATION);
  // Tracks the name only after a result is picked — not while typing.
  const [confirmedDestName, setConfirmedDestName] = useState("Pier 39");
  const [map, setMap] = useState<MapboxMap | null>(null);
  const [routes, setRoutes] = useState<Route[]>(ROUTES);
  const [selectedRouteId, setSelectedRouteId] = useState(ROUTES[0].id);
  const [cautiousMode, setCautiousMode] = useState(true);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [navigationActive, setNavigationActive] = useState(false);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(true);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    setIsLoadingRoutes(true);

    fetchMapboxBikeRoutes(originPoint, destinationPoint)
      .then((nextRoutes) => {
        if (cancelled) return;
        const sorted = [...nextRoutes].sort((a, b) => b.score - a.score);

        // Assign names by role, not by position
        const fastestId = [...sorted].sort((a, b) => a.durationMin - b.durationMin)[0]!.id;
        const safestId = sorted[0]!.id;
        const safestIsFastest = safestId === fastestId;
        let altIndex = 1;
        const renamed = sorted.map((r) => {
          if (r.id === safestId) return { ...r, name: safestIsFastest ? "Safest & Fastest" : "Safest" };
          if (r.id === fastestId) return { ...r, name: "Fastest" };
          return { ...r, name: `Alternative ${altIndex++}` };
        });

        setRoutes(renamed);
        setNavigationActive(false);
        setSelectedRouteId(renamed[0]!.id);
        setIsLoadingRoutes(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setIsLoadingRoutes(false);
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

  const visibleRoutes = useMemo(() => routes, [routes]);

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
    setNavigationActive(false);
    setSelectedRouteId(id);
  };

  const handleOriginSelect = useCallback(
    ({ label, point }: { label: string; point: RoutePoint }) => {
      setNavigationActive(false);
      setOrigin(label);
      setOriginPoint(point);
      map?.flyTo({ center: [point.lng, point.lat], zoom: 14.5 });
    },
    [map],
  );

  const handleDestinationSelect = useCallback(
    ({ label, point }: { label: string; point: RoutePoint }) => {
      setNavigationActive(false);
      setDestination(label);
      setConfirmedDestName(label);
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
      {/* Map: full bleed — the sidebar panel floats over it as a glass layer */}
      <div className="absolute inset-0">
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
          if (next) {
            const safest = [...routes].sort((a, b) => b.score - a.score)[0];
            setNavigationActive(false);
            setSelectedRouteId(safest.id);
          }
          setCautiousMode(next);
        }}
        onStartRoute={() => setNavigationActive(true)}
        expanded={sheetExpanded}
        onToggleExpanded={() => setSheetExpanded((v) => !v)}
        navigationActive={navigationActive}
        navigationCues={activeRoute.navigationCues ?? []}
        onExitNavigation={() => setNavigationActive(false)}
        isLoading={isLoadingRoutes}
        destinationName={confirmedDestName}
        destinationPoint={destinationPoint}
      />

      <RouteReasoningPanel
        route={activeRoute}
        routes={visibleRoutes}
        showDirections={navigationActive}
        onBackFromDirections={() => setNavigationActive(false)}
        onStartRoute={() => setNavigationActive(true)}
        destinationPoint={destinationPoint}
        destinationName={confirmedDestName}
        isLoading={isLoadingRoutes}
      />
    </main>
  );
}
