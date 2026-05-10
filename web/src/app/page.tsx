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
  const [origin, setOrigin] = useState("Downtown Sacramento, CA");
  const [destination, setDestination] = useState("UC Davis Memorial Union");
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
    </main>
  );
}
