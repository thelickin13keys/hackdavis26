"use client";

/**
 * Renders the "agent walking" Street View tour over a route.
 *
 * Split into a state hook (`useStreetViewTour`) and a presentational card
 * (`StreetViewTourCard`) so the page can read the cyclist position for the
 * map marker AND render the panel inline in another component (the
 * RouteReasoningPanel) without prop drilling the entire SSE state.
 *
 * The tour subscribes to `/demo/walk` via EventSource. Per-step events:
 *   • update a Street-View image panel (with hazard bbox overlays),
 *   • interpolate a cyclist position along step.geometry over duration_ms,
 *   • accumulate every hazard sighting into `seenHazards` so the parent
 *     can show thumbnails (e.g. in the "Serious warning" accordion).
 *
 * Alert events fire via the `onAlert` callback so the parent can choose
 * how to surface them (toast, banner, etc.).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pause, Play } from "lucide-react";

import {
  safepathDemoWalkUrl,
  safepathImageUrl,
  type EdgeSample,
  type Hazard,
  type WalkAlertEvent,
  type WalkStepEvent,
} from "@/lib/safepath-api";
import type { RoutePoint } from "./types";

// ---------- Hook ------------------------------------------------------------

export type SeenHazard = {
  /** Stable key for de-duping across replays of the same edge. */
  key: string;
  type: string;
  severity: number;
  note?: string;
  /** Backend-cached Street View frame URL. The hazard's `image_index` picked
   *  out which of the sample's headings we kept. */
  imageUrl: string;
  /** For overlay positioning when the user clicks through. */
  bbox?: [number, number, number, number];
  point?: [number, number];
  edgeId: string;
  edgeName: string | null;
  /** Edge-level safety score (1–10) when the hazard was sighted. */
  edgeScore: number | null;
};

export type StreetViewTourState = {
  active: boolean;
  step: WalkStepEvent | null;
  sample: EdgeSample | null;
  imgIndex: number;
  setImgIndex: (i: number) => void;
  start: () => void;
  stop: () => void;
  seenHazards: SeenHazard[];
  /** Playback multiplier currently applied — 1 = real-time at 4 m/s. */
  timeScale: number;
  setTimeScale: (n: number) => void;
};

type HookOpts = {
  origin: RoutePoint;
  destination: RoutePoint;
  weight: "cost_safe" | "cost_fast";
  timeScale?: number;
  /** If true, automatically start the tour on mount and whenever
   *  origin/destination/weight change. */
  autoStart?: boolean;
  onCyclistPositionChange?: (point: RoutePoint | null) => void;
  onAlert?: (alert: WalkAlertEvent) => void;
};

export function useStreetViewTour(opts: HookOpts): StreetViewTourState {
  const {
    origin,
    destination,
    weight,
    timeScale: initialTimeScale = 5,
    autoStart = false,
    onCyclistPositionChange,
    onAlert,
  } = opts;

  const [active, setActive] = useState(false);
  const [step, setStep] = useState<WalkStepEvent | null>(null);
  const [imgIndex, setImgIndex] = useState(0);
  const [seenHazards, setSeenHazards] = useState<SeenHazard[]>([]);
  const [timeScale, setTimeScale] = useState(initialTimeScale);

  const esRef = useRef<EventSource | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Latest callbacks held in refs so the long-lived SSE handlers don't need
  // to be recreated on every parent re-render.
  const onCyclistRef = useRef(onCyclistPositionChange);
  const onAlertRef = useRef(onAlert);
  useEffect(() => {
    onCyclistRef.current = onCyclistPositionChange;
  }, [onCyclistPositionChange]);
  useEffect(() => {
    onAlertRef.current = onAlert;
  }, [onAlert]);

  const stop = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    if (animFrameRef.current != null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setActive(false);
    setStep(null);
    onCyclistRef.current?.(null);
  }, []);

  // Hard reset on unmount.
  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    esRef.current?.close();
    if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
    setSeenHazards([]);
    setStep(null);
    setImgIndex(0);

    const url = safepathDemoWalkUrl(origin, destination, { weight, timeScale });
    const es = new EventSource(url);
    esRef.current = es;
    setActive(true);

    es.addEventListener("start", () => {
      onCyclistRef.current?.({ lat: origin.lat, lng: origin.lng });
    });

    es.addEventListener("step", (raw) => {
      const ev = JSON.parse((raw as MessageEvent).data) as WalkStepEvent;
      setStep(ev);
      setImgIndex(0);
      mergeHazards(ev, setSeenHazards);
      animateAlongLine(
        ev.geometry.coordinates,
        ev.duration_ms,
        (lng, lat) => onCyclistRef.current?.({ lng, lat }),
        (frame) => {
          animFrameRef.current = frame;
        },
      );
    });

    es.addEventListener("alert", (raw) => {
      const ev = JSON.parse((raw as MessageEvent).data) as WalkAlertEvent;
      onAlertRef.current?.(ev);
    });

    es.addEventListener("done", () => {
      stop();
    });

    es.onerror = () => {
      // Hard stop on persistent errors — EventSource auto-retries internally
      // but a real outage would just spin.
      console.error("SSE walk stream errored");
      stop();
    };
  }, [origin, destination, weight, timeScale, stop]);

  // Auto-start whenever route inputs change (only when autoStart is on).
  useEffect(() => {
    if (!autoStart) return;
    start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, origin.lat, origin.lng, destination.lat, destination.lng, weight]);

  // Speed changes while playing — restart so the new time_scale takes effect
  // immediately. When idle, the next start() picks up the new value naturally.
  const prevTimeScaleRef = useRef(timeScale);
  useEffect(() => {
    if (prevTimeScaleRef.current === timeScale) return;
    prevTimeScaleRef.current = timeScale;
    if (active) start();
  }, [timeScale, active, start]);

  const sample = useMemo(() => pickShowableSample(step?.samples ?? []), [step]);

  return {
    active,
    step,
    sample,
    imgIndex,
    setImgIndex,
    start,
    stop,
    seenHazards,
    timeScale,
    setTimeScale,
  };
}

// ---------- Presentational card --------------------------------------------

// Demo's speed presets: time_scale values mapping to a friendly label.
// 1x = 4 m/s ≈ a leisurely cyclist; higher values just speed up playback.
const SPEED_OPTIONS: { label: string; value: number }[] = [
  { label: "0.5x", value: 2.5 },
  { label: "1x", value: 5 },
  { label: "4x", value: 20 },
  { label: "8x", value: 40 },
];

export function StreetViewTourCard({
  tour,
}: {
  tour: StreetViewTourState;
}) {
  const {
    active,
    step,
    sample,
    imgIndex,
    setImgIndex,
    start,
    stop,
    timeScale,
    setTimeScale,
  } = tour;
  const imageUrl = sample?.images[imgIndex]?.image_path
    ? safepathImageUrl(sample.images[imgIndex].image_path)
    : null;

  return (
    <div className="overflow-hidden rounded-[12px] border border-[#2a2a2a] bg-[#0f0f0f]">
      <StreetViewFrame
        sample={sample}
        imageUrl={imageUrl}
        imageIndex={imgIndex}
        onImageIndexChange={setImgIndex}
        active={active}
      />
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={active ? stop : start}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
        >
          {active ? (
            <>
              <Pause className="size-3" /> Stop
            </>
          ) : (
            <>
              <Play className="size-3" /> Preview ride
            </>
          )}
        </button>
        <select
          value={timeScale}
          onChange={(e) => setTimeScale(Number(e.target.value))}
          aria-label="Playback speed"
          className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/15 focus:outline-none focus:ring-1 focus:ring-white/30"
        >
          {SPEED_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#0f0f0f]">
              {opt.label}
            </option>
          ))}
        </select>
        <SampleMeta step={step} sample={sample} />
      </div>
    </div>
  );
}

// ---------- subcomponents ---------------------------------------------------

function StreetViewFrame({
  sample,
  imageUrl,
  imageIndex,
  onImageIndexChange,
  active,
}: {
  sample: EdgeSample | null;
  imageUrl: string | null;
  imageIndex: number;
  onImageIndexChange: (i: number) => void;
  active: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const handleLoad = () => {
    const el = imgRef.current;
    if (el) setSize({ w: el.clientWidth, h: el.clientHeight });
  };
  useEffect(() => {
    setSize({ w: 0, h: 0 });
  }, [imageUrl]);

  if (!sample || !imageUrl) {
    return (
      <div className="flex aspect-[16/9] items-center justify-center bg-[#1a1a1a] text-[11px] text-white/60">
        {!active
          ? "Press Preview ride to start"
          : sample
          ? "No imagery for this segment"
          : "Waiting for sample…"}
      </div>
    );
  }

  return (
    <div className="relative">
      <div ref={wrapRef} className="relative aspect-[16/9] overflow-hidden bg-black">
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Street View"
          className="h-full w-full object-cover"
          onLoad={handleLoad}
        />
        {size.w > 0 && (
          <HazardOverlay
            hazards={sample.hazards}
            imageIndex={imageIndex}
            width={size.w}
            height={size.h}
          />
        )}
      </div>
    </div>
  );
}

function HazardOverlay({
  hazards,
  imageIndex,
  width,
  height,
}: {
  hazards: Hazard[];
  imageIndex: number;
  width: number;
  height: number;
}) {
  const visible = hazards.filter((h) => h.image_index === imageIndex);
  if (!visible.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0">
      {visible.map((h, i) => {
        if (h.bbox) {
          const [ymin, xmin, ymax, xmax] = h.bbox;
          const left = (xmin / 1000) * width;
          const top = (ymin / 1000) * height;
          const w = ((xmax - xmin) / 1000) * width;
          const ht = ((ymax - ymin) / 1000) * height;
          return (
            <div
              key={i}
              className="absolute rounded border-2 border-[#E83B3B]"
              style={{ left, top, width: w, height: ht }}
            >
              <span className="absolute left-0 top-0 -translate-y-full rounded-t bg-[#E83B3B] px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                {h.type}
                {h.severity ? ` ·${h.severity}` : ""}
              </span>
            </div>
          );
        }
        if (h.point) {
          const [y, x] = h.point;
          return (
            <div
              key={i}
              className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#E83B3B] ring-2 ring-white"
              style={{ left: (x / 1000) * width, top: (y / 1000) * height }}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

function SampleMeta({
  step,
  sample,
}: {
  step: WalkStepEvent | null;
  sample: EdgeSample | null;
}) {
  if (!step) return null;
  const score = sample?.score ?? step.score;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-[11px]">
      <span className="truncate font-semibold text-white">
        {step.name ?? "Unnamed segment"}
      </span>
      <span className="ml-auto shrink-0 tabular-nums text-white/60">
        {score != null ? `${score.toFixed(1)}/10` : "—"}
      </span>
    </div>
  );
}

// ---------- helpers --------------------------------------------------------

/** Prefer a sample with hazards (more interesting); fall back to one with
 *  any imagery; finally to the first sample. Mirrors the demo HTML logic. */
function pickShowableSample(samples: EdgeSample[]): EdgeSample | null {
  if (!samples.length) return null;
  return (
    samples.find((s) => s.hazards.length > 0 && s.images.length > 0) ??
    samples.find((s) => s.images.length > 0) ??
    samples[0]
  );
}

/** Append every (image-bearing) hazard from this step's samples to the
 *  running `seenHazards` list, de-duplicated by edge + type + position. */
function mergeHazards(
  step: WalkStepEvent,
  setSeen: React.Dispatch<React.SetStateAction<SeenHazard[]>>,
) {
  const additions: SeenHazard[] = [];
  for (const sample of step.samples) {
    for (const hz of sample.hazards) {
      const img = sample.images[hz.image_index];
      if (!img?.image_path) continue;
      // Position-based key dedups the same hazard if the agent re-walks an
      // edge during a longer/looped tour.
      const posKey = hz.bbox
        ? hz.bbox.join(",")
        : hz.point
        ? hz.point.join(",")
        : `idx${hz.image_index}`;
      additions.push({
        key: `${step.edge_id}|${hz.type}|${posKey}`,
        type: hz.type,
        severity: hz.severity ?? 0,
        note: hz.note,
        imageUrl: safepathImageUrl(img.image_path),
        bbox: hz.bbox,
        point: hz.point,
        edgeId: step.edge_id,
        edgeName: step.name,
        edgeScore: step.score,
      });
    }
  }
  if (!additions.length) return;
  setSeen((prev) => {
    const known = new Set(prev.map((h) => h.key));
    const fresh = additions.filter((h) => !known.has(h.key));
    return fresh.length ? [...prev, ...fresh] : prev;
  });
}

/** Animates a "cyclist" along a polyline over `durationMs`, calling
 *  `onPosition(lng, lat)` per frame. Stores the latest rAF handle in the
 *  caller's slot so they can cancel it. */
function animateAlongLine(
  coords: [number, number][],
  durationMs: number,
  onPosition: (lng: number, lat: number) => void,
  setFrame: (frame: number | null) => void,
) {
  if (coords.length < 2) {
    if (coords[0]) onPosition(coords[0][0], coords[0][1]);
    return;
  }
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    const len = Math.hypot(dx, dy);
    segLengths.push(len);
    total += len;
  }
  const startTs = performance.now();
  const dur = Math.max(50, durationMs);

  const tick = () => {
    const t = Math.min(1, (performance.now() - startTs) / dur);
    let target = t * total;
    let lng = coords[0][0];
    let lat = coords[0][1];
    for (let i = 0; i < segLengths.length; i++) {
      if (target <= segLengths[i] || i === segLengths.length - 1) {
        const frac = segLengths[i] === 0 ? 0 : target / segLengths[i];
        lng = coords[i][0] + (coords[i + 1][0] - coords[i][0]) * frac;
        lat = coords[i][1] + (coords[i + 1][1] - coords[i][1]) * frac;
        break;
      }
      target -= segLengths[i];
    }
    onPosition(lng, lat);
    if (t < 1) {
      setFrame(requestAnimationFrame(tick));
    } else {
      setFrame(null);
    }
  };
  setFrame(requestAnimationFrame(tick));
}
