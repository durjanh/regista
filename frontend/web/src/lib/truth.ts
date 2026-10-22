import { quietly } from "./activity";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Grade, Mechanism, Plant } from "../api/types";

export const MECHANISM_LABEL: Record<Mechanism, string> = {
  press_switch: "Press switch",
  shape_change: "Shape change",
  tiring_fullback: "Tiring full-back",
  hot_streak: "Hot streak",
  set_piece_routine: "Set-piece routine",
  chaos_spell: "Chaos spell",
};

export const MECHANISM_ICON: Record<Mechanism, string> = {
  press_switch: "⤒",
  shape_change: "♟",
  tiring_fullback: "🔋",
  hot_streak: "🔥",
  set_piece_routine: "⚑",
  chaos_spell: "🌀",
};

export const mechanismLabel = (m: string) => MECHANISM_LABEL[m as Mechanism] ?? m.replace(/_/g, " ");
export const mechanismIcon = (m: string) => MECHANISM_ICON[m as Mechanism] ?? "◆";

/** How long after a planted change we keep "waiting" before calling it missed (live view only). */
export const DETECTION_WINDOW_S = 12 * 60;

export type PlantStatus = "pending" | "waiting" | "detected" | "missed";

export function plantStatus(plant: Plant, grade: Grade | undefined, t: number, ended: boolean): PlantStatus {
  if (grade?.detected) return "detected";
  if (plant.t > t && !ended) return "pending";
  if (ended || t - plant.t > DETECTION_WINDOW_S) return "missed";
  return "waiting";
}

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(`regista.${key}`) === "1";
  } catch {
    return false;
  }
}

function saveFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(`regista.${key}`, on ? "1" : "0");
  } catch {
    /* storage unavailable: the toggle lasts for this page only */
  }
}

/** Truth mode reveals the hidden planted changes and the Grader's verdicts. Off by default. */
export function useTruthMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => loadFlag("truthMode"));
  const set = useCallback((v: boolean) => {
    setOn(v);
    saveFlag("truthMode", v);
  }, []);
  return [on, set];
}

/** Verifier drill: the API plants one overstated number in each insight draft, so the catch is visible. Off by default. */
export function useVerifierDrill(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => loadFlag("verifierDrill"));
  const set = useCallback((v: boolean) => {
    setOn(v);
    saveFlag("verifierDrill", v);
  }, []);
  return [on, set];
}

/**
 * Poll `fn` every `ms` while `active`, always with the latest arguments (the live clock moves on).
 * Returns the last result and error. A failure keeps the previous data on screen.
 */
export function usePoll<T>(fn: () => Promise<T>, ms: number, active: boolean, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let loaded = false;
    // The first fetch shows the loading indicator; refreshes of data already on screen stay in the background.
    const run = () =>
      (loaded ? quietly(fnRef.current) : fnRef.current())
        .then((d) => {
          if (!alive) return;
          loaded = true;
          setData(d);
          setError(null);
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    run();
    const iv = window.setInterval(run, ms);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ms, ...deps]);
  return { data, error, setData };
}
