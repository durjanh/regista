import { useCallback, useEffect, useRef, useState } from "react";
import { broadcastService, matchService } from "../api";
import type {
  BroadcastCue, BroadcastMessage, BroadcastNarrative, BroadcastTick, LiveInsight, LiveMoment, LiveSnapshot, MatchEvent,
  Narrative, StudioItem,
} from "../api/types";
import { teamStats } from "../lib/teamStats";
import { connectRealtime, type RealtimeStatus } from "../lib/webpubsub";
import type { LiveState } from "./useLiveMatch";

const EMPTY: LiveState = {
  status: "idle", meta: null, t: 0, minute: 0, score: { home: 0, away: 0 }, events: [], snapshots: [], latest: null,
  moments: [], studio: [], insights: [],
};

type Options = {
  language: string;
  /** false = don't connect (the viewer chose their own replay). */
  active?: boolean;
  homeId?: string;
  awayId?: string;
  /** Overlay cues (on_air / kill) as they arrive, for the broadcast overlay. */
  onCue?: (cue: BroadcastCue) => void;
  /** The producer's Studio: watches the broadcast but isn't counted as a viewer. */
  monitor?: boolean;
};

/** A broadcast narrative in the shape the moment and insight cards render. */
function toNarrative(n: BroadcastNarrative): Narrative {
  return {
    id: `bn-${n.ref_type}-${n.ref_id}-${n.language}`,
    match_id: n.match_id,
    scope: n.ref_type === "insight" ? "insight" : "moment",
    moment_id: n.ref_type === "moment" ? n.ref_id : undefined,
    persona: n.persona ?? "broadcaster",
    language: n.language,
    text: n.text,
    citations: n.citations ?? [],
    fact_check: n.fact_check,
    engine: n.engine ?? "azure",
    latency_ms: 0,
    agent_trace: [],
    verification: n.verification ?? null,
  };
}

/**
 * Joins the shared live broadcast for a match over Azure Web PubSub and reduces ticks, narratives, cues and the end
 * message into the same LiveState the replay (SSE) hook produces, so every view renders either source.
 * `available` is null while negotiating, false when the deployment has no Web PubSub (fall back to SSE).
 */
export function useBroadcast(matchId: string | undefined, { language, active = true, homeId, awayId, onCue, monitor = false }: Options) {
  const [state, setState] = useState<LiveState>(EMPTY);
  const [connection, setConnection] = useState<RealtimeStatus>("idle");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const narratives = useRef(new Map<string, Narrative>());   // arrive before or after their moment/insight
  const caughtUp = useRef(false);
  const cueRef = useRef(onCue);
  cueRef.current = onCue;
  const teams = useRef({ homeId, awayId });
  teams.current = { homeId, awayId };
  const [nonce, setNonce] = useState(0);

  const applyTick = useCallback((tick: BroadcastTick) => {
    setLatencyMs(Math.max(0, Date.now() - tick.sent_at));
    setState((s) => {
      const seen = new Set(s.events.map((e) => e.id));
      const fresh = tick.events.filter((e) => !seen.has(e.id) && Boolean(seen.add(e.id)));
      const events = fresh.length ? [...s.events, ...fresh] : s.events;
      const { homeId: h, awayId: a } = teams.current;
      const stats = h && a ? { home: teamStats(events, h, a), away: teamStats(events, a, h) } : s.latest?.stats;
      const snap: LiveSnapshot = {
        t: tick.t, minute: tick.minute, score: tick.score, momentum: tick.snapshot.momentum, win_prob: tick.snapshot.win_prob,
        control_chaos: tick.snapshot.control_chaos, stats: stats as LiveSnapshot["stats"],
      };
      const snapshots = [...s.snapshots.filter((x) => x.t < tick.t), snap];
      let moments = s.moments;
      if (tick.moments.length) {
        const map = new Map(moments.map((m) => [m.id, m]));
        tick.moments.forEach((m) => map.set(m.id, { ...map.get(m.id), ...m, narrative: map.get(m.id)?.narrative ?? narratives.current.get(`moment:${m.id}`) }));
        moments = [...map.values()].sort((x, y) => x.t - y.t);
      }
      let insights = s.insights;
      if (tick.insights.length) {
        const map = new Map(insights.map((m) => [m.id, m]));
        tick.insights.forEach((m) => map.set(m.id, { ...map.get(m.id), ...m, narrative: map.get(m.id)?.narrative ?? narratives.current.get(`insight:${m.id}`) }));
        insights = [...map.values()].sort((x, y) => x.detected_t - y.detected_t);
      }
      return { ...s, status: s.status === "ended" ? "ended" : "live", t: Math.max(s.t, tick.t), minute: tick.minute, score: tick.score,
        events, snapshots, latest: snap, moments, insights };
    });
  }, []);

  const applyNarrative = useCallback((n: BroadcastNarrative) => {
    const narrative = toNarrative(n);
    narratives.current.set(`${n.ref_type}:${n.ref_id}`, narrative);
    setState((s) => {
      if (n.ref_type === "moment") {
        if (!s.moments.some((m) => m.id === n.ref_id)) return s;
        return { ...s, moments: s.moments.map((m): LiveMoment => (m.id === n.ref_id ? { ...m, narrative } : m)) };
      }
      if (!s.insights.some((m) => m.id === n.ref_id)) return s;
      return { ...s, insights: s.insights.map((m): LiveInsight => (m.id === n.ref_id ? { ...m, narrative } : m)) };
    });
  }, []);

  const applyCue = useCallback((cue: BroadcastCue) => {
    cueRef.current?.(cue);
    setState((s) => {
      const map = new Map(s.studio.map((x) => [x.id, x]));
      if (cue.action === "on_air" && "kind" in cue.item) map.set(cue.item.id, { ...(cue.item as StudioItem), status: "on_air" });
      else {
        const prev = map.get(cue.item.id);
        if (prev) map.set(prev.id, { ...prev, status: "killed" });
      }
      return { ...s, studio: [...map.values()].sort((x, y) => x.t - y.t) };
    });
  }, []);

  // A viewer joining mid-match catches up on the events so far once (a cacheable read), then lives off the ticks.
  const catchUp = useCallback(async (id: string, upTo: number) => {
    if (caughtUp.current || upTo < 60) return;
    caughtUp.current = true;
    try {
      const past = await matchService.events(id, { to_t: Math.floor(upTo) });
      setState((s) => {
        const seen = new Set(s.events.map((e) => e.id));
        const older = past.filter((e) => !seen.has(e.id)).map(({ freeze_frame: _ff, ...e }) => e as MatchEvent);
        return older.length ? { ...s, events: [...older, ...s.events].sort((x, y) => x.t - y.t) } : s;
      });
    } catch {
      /* the live ticks still work without the history */
    }
  }, []);

  useEffect(() => {
    if (!matchId || !active) {
      setConnection("idle");
      return;
    }
    narratives.current = new Map();
    caughtUp.current = false;
    setState(EMPTY);
    setLatencyMs(null);
    setAvailable(null);
    const conn = connectRealtime({
      negotiate: () => broadcastService.negotiate(matchId, language, monitor),
      onStatus: (st) => {
        setConnection(st);
        if (st === "disabled") setAvailable(false);
        if (st === "live") setAvailable(true);
        setState((s) => (st === "connecting" && s.status === "idle" ? { ...s, status: "connecting" } : s));
      },
      onMessage: (_group, data) => {
        const msg = data as BroadcastMessage;
        if (!msg || typeof msg !== "object" || msg.match_id !== matchId) return;
        if (msg.type === "tick") {
          applyTick(msg);
          void catchUp(matchId, msg.t);
        } else if (msg.type === "narrative") {
          if (msg.language === language) applyNarrative(msg);
        } else if (msg.type === "cue") applyCue(msg);
        else if (msg.type === "end") setState((s) => ({ ...s, status: "ended", t: Math.max(s.t, msg.t) }));
      },
    });
    return () => conn.close();
  }, [matchId, language, active, monitor, nonce, applyTick, applyNarrative, applyCue, catchUp]);

  const reconnect = useCallback(() => setNonce((n) => n + 1), []);

  return { state, connection, available, latencyMs, reconnect };
}
