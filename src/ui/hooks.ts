import { useEffect, useRef, useState } from "react";
import type { FeedRecord, Snapshot } from "../shared/types.js";
import { createSimulation, simulationSnapshot, stepSimulation } from "./simulator.js";

/** Current time, refreshed every `ms` (relative times, durations). */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [reduced, setReduced] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

export const SIM_TICK_MS = 1000;

/**
 * Runs the simulator on top of the real people of `base` while `enabled`.
 * Each tick produces a fake snapshot and fake records (handed to `onRecords` for animations).
 */
export function useSimulation(enabled: boolean, base: Snapshot | null, onRecords: (records: FeedRecord[]) => void): Snapshot | null {
  const cb = useRef(onRecords);
  cb.current = onRecords;
  const baseRef = useRef(base);
  baseRef.current = base;
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const ready = !!base;
  useEffect(() => {
    const b = baseRef.current;
    if (!enabled || !b) {
      setSnap(null);
      return;
    }
    const s = createSimulation(b, { seed: (Date.now() % 1_000_003) | 0, nowMs: Date.now() });
    setSnap(simulationSnapshot(s));
    const id = setInterval(() => {
      const recs = stepSimulation(s);
      setSnap(simulationSnapshot(s));
      if (recs.length) cb.current(recs);
    }, SIM_TICK_MS);
    return () => clearInterval(id);
  }, [enabled, ready, base?.companyId]);
  return enabled ? snap : null;
}
