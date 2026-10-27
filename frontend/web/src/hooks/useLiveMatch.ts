import { useCallback, useEffect, useRef, useState } from "react";
import { matchService } from "../api";
import { beginActivity } from "../lib/activity";
import type { LiveInsight, LiveMeta, LiveMoment, LiveSnapshot, MatchEvent, Score, StudioItem } from "../api/types";

export type LiveStatus = "idle" | "connecting" | "live" | "paused" | "ended" | "error";

export type LiveState = {
  status: LiveStatus;
  meta: LiveMeta | null;
  t: number;
  minute: number;
  score: Score;
  events: MatchEvent[];
  snapshots: LiveSnapshot[];
  latest: LiveSnapshot | null;
  moments: LiveMoment[];
  studio: StudioItem[];
  insights: LiveInsight[];
  error?: string;
};

const EMPTY: LiveState = {
  status: "idle",
  meta: null,
  t: 0,
  minute: 0,
  score: { home: 0, away: 0 },
  events: [],
  snapshots: [],
  latest: null,
  moments: [],
  studio: [],
  insights: [],
};

type Options = {
  persona: string;
  language: string;
  initialSpeed?: number;
  autoplay?: boolean;
  /** Verifier drill: the API plants one overstated number in each insight draft so the Verifier's catch is visible. */
  drill?: boolean;
  /** Longest wait between events, in seconds (the API squeezes dead time to 1.5 by default; a real-time feed needs more). */
  maxGap?: number;
};

type Pending = {
  events: MatchEvent[];
  snapshots: LiveSnapshot[];
  moments: LiveMoment[];
  studio: StudioItem[];
  insights: LiveInsight[];
  meta?: LiveMeta;
  ended?: number;
};

const freshPending = (): Pending => ({ events: [], snapshots: [], moments: [], studio: [], insights: [] });

/**
 * Subscribes to /api/matches/{id}/live (SSE). Messages are buffered and flushed once per
 * animation frame so a 120x replay doesn't re-render on every event.
 */
export function useLiveMatch(matchId: string | undefined, { persona, language, initialSpeed = 30, autoplay = true, drill = false, maxGap }: Options) {
  const [state, setState] = useState<LiveState>(EMPTY);
  const [speed, setSpeedState] = useState(initialSpeed);
  const esRef = useRef<EventSource | null>(null);
  const pending = useRef<Pending>(freshPending());
  const raf = useRef<number | null>(null);
  const tRef = useRef(0);
  const endedRef = useRef(false);

  const flush = useCallback(() => {
    raf.current = null;
    const p = pending.current;
    pending.current = freshPending();
    setState((s) => {
      let { events, snapshots, moments, studio, insights } = s;
      if (p.events.length) {
        const seen = new Set(events.length > 400 ? events.slice(-400).map((e) => e.id) : events.map((e) => e.id));
        // also dedupe within the batch: two reconnects inside one frame can deliver the same event twice
        const fresh = p.events.filter((e) => !seen.has(e.id) && Boolean(seen.add(e.id)));
        events = fresh.length ? [...events, ...fresh] : events;
      }
      if (p.snapshots.length) snapshots = [...snapshots.filter((x) => x.t < p.snapshots[0].t), ...p.snapshots];
      if (p.moments.length) {
        const map = new Map(moments.map((m) => [m.id, m]));
        p.moments.forEach((m) => map.set(m.id, { ...map.get(m.id), ...m }));
        moments = [...map.values()].sort((a, b) => a.t - b.t);
      }
      if (p.studio.length) {
        const map = new Map(studio.map((m) => [m.id, m]));
        p.studio.forEach((m) => map.set(m.id, m));
        studio = [...map.values()].sort((a, b) => a.t - b.t);
      }
      if (p.insights.length) {
        // same upsert rule as moments: an insight can arrive first bare, then again with its narrative
        const map = new Map(insights.map((m) => [m.id, m]));
        p.insights.forEach((m) => map.set(m.id, { ...map.get(m.id), ...m }));
        insights = [...map.values()].sort((a, b) => a.detected_t - b.detected_t);
      }
      const lastEvent = events[events.length - 1];
      const latest = snapshots[snapshots.length - 1] ?? s.latest;
      const t = Math.max(lastEvent?.t ?? 0, latest?.t ?? 0, s.t);
      tRef.current = t;
      return {
        ...s,
        meta: p.meta ?? s.meta,
        events,
        snapshots,
        moments,
        studio,
        insights,
        latest,
        t,
        minute: lastEvent?.minute ?? latest?.minute ?? s.minute,
        score: lastEvent?.score ?? latest?.score ?? s.score,
        status: p.ended !== undefined ? "ended" : s.status === "connecting" ? "live" : s.status,
      };
    });
  }, []);

  const schedule = useCallback(() => {
    if (raf.current === null) raf.current = requestAnimationFrame(flush);
  }, [flush]);

  // A stream counts as a backend call for the loading indicator until the API answers (or the stream closes).
  const connecting = useRef<(() => void) | null>(null);
  const connected = useCallback(() => {
    connecting.current?.();
    connecting.current = null;
  }, []);

  const close = useCallback(() => {
    connected();
    esRef.current?.close();
    esRef.current = null;
  }, [connected]);

  const connect = useCallback(
    (startT: number, spd: number) => {
      if (!matchId) return;
      close();
      endedRef.current = false;
      setState((s) => ({ ...s, status: "connecting", error: undefined }));
      const es = new EventSource(matchService.liveUrl(matchId, { speed: spd, start_t: Math.floor(startT), persona, language, drill, max_gap: maxGap }));
      esRef.current = es;
      connecting.current = beginActivity();
      const parse = <T,>(e: MessageEvent): T | null => {
        try {
          return JSON.parse(e.data) as T;
        } catch {
          return null;
        }
      };
      es.addEventListener("meta", (e) => {
        const m = parse<LiveMeta>(e as MessageEvent);
        if (m) pending.current.meta = m;
        schedule();
      });
      es.addEventListener("event", (e) => {
        const ev = parse<MatchEvent>(e as MessageEvent);
        if (ev) pending.current.events.push(ev);
        schedule();
      });
      es.addEventListener("snapshot", (e) => {
        const sn = parse<LiveSnapshot>(e as MessageEvent);
        if (sn) pending.current.snapshots.push(sn);
        schedule();
      });
      es.addEventListener("moment", (e) => {
        const m = parse<LiveMoment>(e as MessageEvent);
        if (m) pending.current.moments.push(m);
        schedule();
      });
      es.addEventListener("insight", (e) => {
        const it = parse<LiveInsight>(e as MessageEvent);
        if (it) pending.current.insights.push(it);
        schedule();
      });
      es.addEventListener("studio", (e) => {
        const it = parse<StudioItem>(e as MessageEvent);
        if (it) pending.current.studio.push(it);
        schedule();
      });
      es.addEventListener("end", (e) => {
        const d = parse<{ t: number }>(e as MessageEvent);
        endedRef.current = true;
        pending.current.ended = d?.t ?? tRef.current;
        close();
        schedule();
      });
      es.onopen = () => {
        connected();
        setState((s) => (s.status === "connecting" ? { ...s, status: "live" } : s));
      };
      es.onerror = () => {
        if (endedRef.current) return;
        // EventSource would silently reconnect from the original start_t; stop and let the user resume.
        close();
        setState((s) => ({ ...s, status: "error", error: "Live stream interrupted" }));
      };
    },
    [matchId, persona, language, drill, maxGap, close, connected, schedule],
  );

  // Restart from kick-off on match change; resume at the current clock when persona/language/drill change.
  const startedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!matchId) return;
    if (startedFor.current !== matchId) {
      startedFor.current = matchId;
      close();
      pending.current = freshPending();
      tRef.current = 0;
      setState(EMPTY);
      if (autoplay) connect(0, speed);
      return;
    }
    if (esRef.current) connect(tRef.current, speed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, persona, language, drill]);

  useEffect(
    () => () => {
      close();
      startedFor.current = undefined;
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    },
    [close],
  );

  const pause = useCallback(() => {
    close();
    setState((s) => (s.status === "ended" ? s : { ...s, status: "paused" }));
  }, [close]);

  const play = useCallback(() => {
    if (state.status === "ended") return;
    connect(tRef.current, speed);
  }, [connect, speed, state.status]);

  const restart = useCallback(() => {
    close();
    pending.current = freshPending();
    tRef.current = 0;
    setState(EMPTY);
    connect(0, speed);
  }, [close, connect, speed]);

  const setSpeed = useCallback(
    (n: number) => {
      setSpeedState(n);
      if (esRef.current) connect(tRef.current, n);
    },
    [connect],
  );

  const jumpToEnd = useCallback(() => {
    // fastest replay to full time, keeping accumulated state
    setSpeedState(600);
    connect(tRef.current, 600);
  }, [connect]);

  // Match minute -> stream clock. The second half restarts at minute 46 after first-half stoppage time,
  // so the mapping comes from the real second-half kick-off event.
  const secondHalf = useRef<{ match?: string; t: number; minute: number } | null>(null);
  const seekMinute = useCallback(
    async (minute: number) => {
      if (!matchId) return;
      if (secondHalf.current?.match !== matchId) {
        try {
          const kos = await matchService.events(matchId, { types: ["kick_off"] });
          const k2 = kos.find((e) => e.period === 2);
          secondHalf.current = { match: matchId, t: k2?.t ?? 45 * 60, minute: k2?.minute ?? 46 };
        } catch {
          secondHalf.current = { match: matchId, t: 45 * 60, minute: 46 };
        }
      }
      const h = secondHalf.current;
      const t = minute < h.minute ? Math.max(0, (minute - 1) * 60) : h.t + (minute - h.minute) * 60;
      close();
      pending.current = freshPending();
      tRef.current = t;
      setState({ ...EMPTY, t, minute });
      connect(t, speed);
    },
    [matchId, close, connect, speed],
  );

  return { state, speed, play, pause, restart, setSpeed, jumpToEnd, seekMinute };
}
