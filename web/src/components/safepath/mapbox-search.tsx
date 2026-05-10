"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { RoutePoint } from "./types";

type MapboxSearchProps = {
  label: string;
  placeholder: string;
  value: string;
  dotClass: string;
  onTextChange: (value: string) => void;
  onSelect: (place: { label: string; point: RoutePoint }) => void;
};

const TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_API_KEY ??
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ??
  "";

type GeocodingFeature = {
  id: string;
  place_name?: string;
  text?: string;
  center?: [number, number];
};

type GeocodingResponse = {
  features?: GeocodingFeature[];
};

export function MapboxSearch({
  label,
  placeholder,
  value,
  dotClass,
  onTextChange,
  onSelect,
}: MapboxSearchProps) {
  const [suggestions, setSuggestions] = useState<GeocodingFeature[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const selectedValueRef = useRef(value);
  const suppressSuggestionsRef = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  useEffect(() => {
    const trimmed = value.trim();
    if (
      !TOKEN ||
      trimmed.length < 3 ||
      (suppressSuggestionsRef.current && trimmed === selectedValueRef.current)
    ) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const url = new URL(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
            trimmed,
          )}.json`,
        );
        url.searchParams.set("access_token", TOKEN);
        url.searchParams.set("autocomplete", "true");
        url.searchParams.set("country", "us");
        url.searchParams.set("limit", "5");
        url.searchParams.set("proximity", "-121.760891,38.53908");
        url.searchParams.set("types", "address,poi,place,locality,neighborhood");

        const response = await fetch(url.toString(), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Geocoding failed: ${response.status}`);
        const data = (await response.json()) as GeocodingResponse;
        const next = (data.features ?? []).filter((feature) =>
          Array.isArray(feature.center),
        );
        setSuggestions(next);
        setOpen(next.length > 0);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
          setSuggestions([]);
          setOpen(false);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [value]);

  const status = useMemo(() => {
    if (!TOKEN) return "Search unavailable";
    if (loading) return "Searching";
    if (open) return "Choose a result";
    return "";
  }, [loading, open]);

  const selectSuggestion = (feature: GeocodingFeature) => {
    if (!feature.center) return;
    const nextLabel = feature.place_name ?? feature.text ?? value;
    selectedValueRef.current = nextLabel;
    suppressSuggestionsRef.current = true;
    setOpen(false);
    setSuggestions([]);
    onTextChange(nextLabel);
    onSelect({
      label: nextLabel,
      point: { lng: feature.center[0], lat: feature.center[1] },
    });
  };

  return (
    <div
      ref={rootRef}
      className="relative flex items-center gap-3 px-3 py-2.5"
    >
      <span className={`size-2.5 shrink-0 rounded-full ${dotClass}`} />
      <div className="min-w-0 flex-1">
        <span className="type-caption mb-1 block">{label}</span>
        <input
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            selectedValueRef.current = "";
            suppressSuggestionsRef.current = false;
            onTextChange(next);
          }}
          onFocus={() => {
            if (suggestions.length) setOpen(true);
          }}
          placeholder={placeholder}
          className="h-7 w-full bg-transparent text-[15px] leading-7 font-medium text-white outline-none placeholder:text-[#525252]"
          aria-label={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        {status ? (
          <span className="sr-only" aria-live="polite">
            {status}
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="absolute top-full right-3 left-3 z-50 mt-2 overflow-hidden rounded-[14px] border border-[#333] bg-[#121212] shadow-[0_24px_48px_rgba(0,0,0,0.55)]">
          {suggestions.map((feature) => (
            <button
              key={feature.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                selectSuggestion(feature);
              }}
              className="block w-full border-b border-[#242424] px-4 py-3 text-left last:border-b-0 hover:bg-[#1d1d1d] focus-visible:bg-[#1d1d1d] focus-visible:outline-none"
            >
              <span className="block truncate text-[14px] font-semibold text-white">
                {feature.text ?? feature.place_name}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-[#ababab]">
                {feature.place_name ?? "Mapbox result"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
