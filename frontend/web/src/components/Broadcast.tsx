import { useCallback, useEffect, useState } from "react";
import { broadcastService, studioService } from "../api";
import type { BroadcastStatus } from "../api/types";
import { useBroadcast } from "../hooks/useBroadcast";
import { usePrefs } from "../lib/prefs";
import type { RealtimeStatus } from "../lib/webpubsub";

export type LiveSource = "broadcast" | "replay";

/** "● Live · 120 ms": connection state in words and a symbol, never colour alone. */
export function LiveBadge({ connection, latencyMs }: { connection: RealtimeStatus; latencyMs: number | null }) {
  const { t } = usePrefs();
  const text =
    connection === "live" ? `● ${t("bc.badge")}${latencyMs !== null ? ` · ${latencyMs} ms` : ""}`
      : connection === "reconnecting" ? `↻ ${t("bc.reconnecting")}`
        : connection === "connecting" ? `… ${t("bc.connecting")}`
          : connection === "disabled" ? `○ ${t("bc.unavailable")}`
            : connection === "error" ? `⚠ ${t("bc.reconnecting")}` : "";
  if (!text) return null;
  return (
    <span className={connection === "live" ? "pill accent" : "pill"} role="status" aria-live="polite"
      title={latencyMs !== null ? `${t("bc.latency")}: ${latencyMs} ms` : undefined}>
      {text}
    </span>
  );
}

/** Live broadcast (shared timeline over Web PubSub) or the viewer's own replay (SSE). */
export function SourceSwitch({ source, onChange }: { source: LiveSource; onChange: (s: LiveSource) => void }) {
  const { t } = usePrefs();
  return (
    <div className="seg" role="group" aria-label={t("bc.source")}>
      {(["broadcast", "replay"] as const).map((s) => (
        <button key={s} className={source === s ? "on" : undefined} aria-pressed={source === s} onClick={() => onChange(s)}
          title={s === "broadcast" ? t("bc.liveHint") : t("bc.replayHint")}>
          {s === "broadcast" ? `📡 ${t("bc.live")}` : `⏯ ${t("bc.replay")}`}
        </button>
      ))}
    </div>
  );
}

export const formatBytes = (n: number) =>
  n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;

/** Broadcast status for one match: read once, and again when the tab becomes visible (no per-viewer polling). */
export function useBroadcastStatus(matchId: string, pollMs?: number) {
  const [status, setStatus] = useState<BroadcastStatus | null>(null);
  const refresh = useCallback(async () => {
    try {
      const all = await broadcastService.status();
      setStatus(all.find((s) => s.match_id === matchId) ?? null);
    } catch {
      setStatus(null);
    }
  }, [matchId]);
  useEffect(() => {
    void refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    const iv = pollMs ? window.setInterval(() => void refresh(), pollMs) : undefined;
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (iv) window.clearInterval(iv);
    };
  }, [refresh, pollMs]);
  return { status, setStatus, refresh };
}

const SPEEDS = [1, 10, 30, 60];

/** Producer control: put one shared timeline on air for every viewer (Azure Web PubSub fan-out). */
export function GoLivePanel({ matchId, currentT, homeId, awayId }: { matchId: string; currentT: number; homeId?: string; awayId?: string }) {
  const { t, language } = usePrefs();
  const { status, setStatus } = useBroadcastStatus(matchId, 5000);
  const [speed, setSpeed] = useState(1);
  const [from, setFrom] = useState<"kickoff" | "clock">("kickoff");
  const [languages, setLanguages] = useState<string[]>([language]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const live = Boolean(status?.live);
  // The producer joins too, to see what viewers see and how quickly, as a monitor: not counted as a viewer.
  const bc = useBroadcast(matchId, { language, active: live, homeId, awayId, monitor: true });

  useEffect(() => {
    let cancelled = false;
    Promise.all([studioService.settings(matchId), studioService.profiles()])
      .then(([s, profiles]) => {
        const p = profiles.find((x) => x.id === s.profile_id);
        if (!cancelled && p?.languages.length) setLanguages(p.languages);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const act = async (start: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const next = start
        ? await broadcastService.start(matchId, { speed, start_t: from === "clock" ? Math.floor(currentT) : 0, languages })
        : await broadcastService.stop(matchId);
      setStatus(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="golive-title">
      <div className="card-head">
        <h2 className="card-title" id="golive-title">📡 {t("bc.goLive")}</h2>
        <span className="spacer" />
        <span className={live ? "pill accent" : "pill"}>{live ? `● ${t("bc.onAir")}` : `○ ${t("bc.offAir")}`}</span>
        {live && status ? (
          <span className="pill" role="status" aria-live="polite" title={t("bc.viewersHint")}>
            👁 {status.viewers.toLocaleString(language)}{status.viewers_more ? "+" : ""} {t("bc.viewers")}
          </span>
        ) : null}
        {live ? <LiveBadge connection={bc.connection} latencyMs={bc.latencyMs} /> : null}
      </div>
      <p className="xs muted" style={{ margin: "0 0 10px" }}>{t("bc.explain")}</p>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <label className="xs">
          {t("bc.speed")}{" "}
          <select className="select" value={speed} disabled={live} onChange={(e) => setSpeed(Number(e.target.value))} aria-label={t("bc.speed")}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <label className="xs">
          {t("bc.from")}{" "}
          <select className="select" value={from} disabled={live} onChange={(e) => setFrom(e.target.value as "kickoff" | "clock")} aria-label={t("bc.from")}>
            <option value="kickoff">{t("live.kickoff")}</option>
            <option value="clock">{Math.floor(currentT / 60)}:00</option>
          </select>
        </label>
        <span className="xs muted">{t("bc.languages")}: {languages.join(" · ")}</span>
        <span className="spacer" />
        {live ? (
          <button className="btn" disabled={busy} aria-busy={busy} onClick={() => void act(false)}>■ {t("bc.stop")}</button>
        ) : (
          <button className="btn primary" disabled={busy} aria-busy={busy} onClick={() => void act(true)}>▶ {t("bc.start")}</button>
        )}
      </div>
      {status ? (
        <dl className="kv xs" style={{ marginTop: 10 }}>
          <dt>{t("bc.source")}</dt><dd>{status.source}</dd>
          <dt>{t("bc.speed")}</dt><dd>{status.speed}×</dd>
          <dt aria-label="minute">⏱</dt><dd>{status.minute}'</dd>
          <dt>{t("bc.ticks")}</dt><dd>{status.ticks_published}</dd>
          <dt>{t("bc.bytes")}</dt><dd>{formatBytes(status.bytes_published)}</dd>
        </dl>
      ) : null}
      {err ? <p className="xs" role="alert" style={{ color: "var(--danger)" }}>⚠ {err}</p> : null}
    </section>
  );
}
