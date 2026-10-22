import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { broadcastService, studioService } from "../api";
import type { BroadcastCue, StudioItem } from "../api/types";
import { connectRealtime } from "../lib/webpubsub";

type Live = StudioItem & { leaving?: boolean };

const DEMO: Omit<StudioItem, "id" | "created_at">[] = [
  { match_id: "demo", kind: "lower_third", priority: 92, title: "Goal — 67'", body: "Third goal in six minutes · xG 0.41 from the cut-back", data: { tag: "GOAL", color: "#22d68a" }, status: "on_air", t: 4020, minute: 67, duration_s: 6 },
  { match_id: "demo", kind: "stat_card", priority: 80, title: "Momentum swing", body: "Field tilt since the 60th minute", data: { rows: [{ label: "Field tilt", value: "71%" }, { label: "xT added", value: "0.94" }, { label: "PPDA", value: "6.2" }] }, status: "on_air", t: 4100, minute: 68, duration_s: 7 },
  { match_id: "demo", kind: "talking_point", priority: 70, title: "Shape change", body: "Back three after the 58' substitution — wing-backs now 9m higher", data: { tag: "TACTICS" }, status: "on_air", t: 4200, minute: 70, duration_s: 6 },
  { match_id: "demo", kind: "score_bug_alert", priority: 60, title: "Win probability 63%", body: "", data: {}, status: "on_air", t: 4300, minute: 71, duration_s: 5 },
];

const TAG: Record<StudioItem["kind"], string> = {
  lower_third: "LIVE",
  stat_card: "STATS",
  talking_point: "INSIGHT",
  replay_cue: "REPLAY",
  score_bug_alert: "ALERT",
};

function useStageScale() {
  const [scale, setScale] = useState(() => Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
  useEffect(() => {
    const on = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return scale;
}

export function Overlay() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const demo = params.get("demo") === "1";
  const scale = useStageScale();
  const [active, setActive] = useState<Live[]>([]);
  const timers = useRef(new Map<string, number[]>());

  // Transparent page for OBS/vMix browser sources.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("overlay-mode");
    return () => root.classList.remove("overlay-mode");
  }, []);

  const clearTimers = (itemId: string) => {
    timers.current.get(itemId)?.forEach((t) => window.clearTimeout(t));
    timers.current.delete(itemId);
  };

  const remove = (itemId: string) => {
    setActive((prev) => prev.map((x) => (x.id === itemId ? { ...x, leaving: true } : x)));
    const t = window.setTimeout(() => setActive((prev) => prev.filter((x) => x.id !== itemId)), 480);
    timers.current.set(itemId, [...(timers.current.get(itemId) ?? []), t]);
  };

  const show = (item: StudioItem) => {
    clearTimers(item.id);
    // one item per slot: lower thirds share the bottom, stat cards the right
    const slot = (k: StudioItem["kind"]) => (k === "stat_card" ? "card" : k === "score_bug_alert" || k === "replay_cue" ? "badge" : "lower");
    setActive((prev) => [...prev.filter((x) => slot(x.kind) !== slot(item.kind) && x.id !== item.id), { ...item }]);
    const t = window.setTimeout(() => remove(item.id), Math.max(2, item.duration_s || 6) * 1000);
    timers.current.set(item.id, [t]);
  };

  useEffect(() => {
    if (demo) {
      let i = 0;
      const next = () => {
        const base = DEMO[i % DEMO.length];
        show({ ...base, id: `demo-${i}`, created_at: new Date().toISOString() });
        i++;
      };
      next();
      const iv = window.setInterval(next, 4000);
      return () => window.clearInterval(iv);
    }
    // Prefer the Web PubSub group overlay.{id} (scales to every broadcaster's overlay); fall back to SSE when this
    // deployment has no Web PubSub or the negotiation fails.
    let es: EventSource | null = null;
    let fellBack = false;
    const rt = connectRealtime({
      negotiate: () => broadcastService.negotiate(id, "en"),
      groups: (g) => g === `overlay.${id}`,
      onStatus: (st) => {
        if ((st === "disabled" || st === "error") && !fellBack) {
          fellBack = true;
          rt?.close();
          es = sse();
        }
      },
      onMessage: (_group, data) => {
        const cue = data as BroadcastCue;
        if (!cue || cue.type !== "cue" || cue.match_id !== id) return;
        if (cue.action === "on_air" && "kind" in cue.item) show(cue.item as StudioItem);
        else if (cue.action === "kill") {
          clearTimers(cue.item.id);
          setActive((prev) => prev.filter((x) => x.id !== cue.item.id));
        }
      },
    });
    return () => {
      rt.close();
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, demo]);

  function sse(): EventSource {
    const es = new EventSource(studioService.overlayUrl(id));
    es.addEventListener("on_air", (e) => {
      try {
        show(JSON.parse((e as MessageEvent).data) as StudioItem);
      } catch {
        /* ignore malformed */
      }
    });
    // The producer pulled it: take it off air immediately, no exit animation wait.
    es.addEventListener("kill", (e) => {
      try {
        const { id: itemId } = JSON.parse((e as MessageEvent).data) as { id: string };
        clearTimers(itemId);
        setActive((prev) => prev.filter((x) => x.id !== itemId));
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("clear", (e) => {
      try {
        const { id: itemId } = JSON.parse((e as MessageEvent).data) as { id: string };
        clearTimers(itemId);
        remove(itemId);
      } catch {
        /* ignore */
      }
    });
    return es;
  }

  useEffect(
    () => () => {
      timers.current.forEach((ts) => ts.forEach((t) => window.clearTimeout(t)));
    },
    [],
  );

  return (
    <div className="overlay-root" aria-live="polite">
      <div className="overlay-stage" style={{ transform: `scale(${scale})` }}>
        <div className="safe">
          {active.map((item) => {
            const tag = typeof item.data?.tag === "string" ? (item.data.tag as string) : TAG[item.kind];
            const color = typeof item.data?.color === "string" ? (item.data.color as string) : undefined;
            if (item.kind === "stat_card") {
              const rows = Array.isArray(item.data?.rows) ? (item.data.rows as { label: string; value: string | number }[]) : [];
              return (
                <div key={item.id} className={`stat-card${item.leaving ? " out" : ""}`}>
                  <div className="sc-head">{item.title}</div>
                  <div className="sc-body">
                    {item.body}
                    {rows.length ? (
                      <div className="sc-rows">
                        {rows.slice(0, 5).map((r, i) => (
                          <div className="sc-row" key={i}>
                            <span>{r.label}</span>
                            <b>{r.value}</b>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            }
            if (item.kind === "score_bug_alert" || item.kind === "replay_cue") {
              return (
                <div key={item.id} className={`overlay-badge${item.leaving ? " out" : ""}`} style={{ animation: "scIn 0.4s both" }}>
                  <span className="dot" />
                  {item.kind === "replay_cue" ? `Replay · ${item.title}` : item.title}
                </div>
              );
            }
            return (
              <div key={item.id} className={`lower-third${item.leaving ? " out" : ""}`} style={{ "--lt-team": color } as CSSProperties}>
                <div className="lt-tag">{tag}</div>
                <div className="lt-body">
                  <div className="lt-title">{item.title}</div>
                  {item.body ? <div className="lt-sub">{item.body}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
