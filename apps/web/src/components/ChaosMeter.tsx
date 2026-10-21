import { useId } from "react";
import type { MatchEvent } from "../api/types";
import { usePrefs } from "../lib/prefs";

/** 0 = one side in control, 1 = chaos (possession flipping back and forth, low completion). */
export function ChaosMeter({ value }: { value: number | undefined }) {
  const { t } = usePrefs();
  const gid = `chaos${useId().replace(/:/g, "")}`;
  const v = Math.max(0, Math.min(1, value ?? 0));
  const known = value !== undefined;
  const label = !known ? "–" : v < 0.33 ? t("chaos.control") : v < 0.66 ? t("chaos.contested") : t("chaos.chaos");
  // half-circle gauge
  const R = 44;
  const cx = 56;
  const cy = 52;
  const ang = Math.PI * (1 - v);
  const nx = cx + R * Math.cos(ang);
  const ny = cy - R * Math.sin(ang);
  return (
    <div className="chaos-meter" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={known ? Number(v.toFixed(2)) : undefined}
      aria-label={`${t("chaos.title")}: ${label}`}>
      <svg viewBox="0 0 112 62" width="112" height="62" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="55%" stopColor="var(--warn)" />
            <stop offset="100%" stopColor="var(--signal)" />
          </linearGradient>
        </defs>
        <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke="var(--surface-3)" strokeWidth={9} strokeLinecap="round" />
        <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke={`url(#${gid})`} strokeWidth={9} strokeLinecap="round" opacity={0.85} />
        {known ? (
          <>
            <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--text)" strokeWidth={2.4} strokeLinecap="round" className="chaos-needle" />
            <circle cx={cx} cy={cy} r={4} fill="var(--text)" />
          </>
        ) : null}
      </svg>
      <div>
        <div className="xs muted">{t("chaos.title")}</div>
        <div className="chaos-label">{label}</div>
        <div className="xs faint tnum">{known ? v.toFixed(2) : ""}</div>
      </div>
    </div>
  );
}

/** Thin per-minute band (green control → red chaos), drawn under a momentum chart. */
export function ChaosBand({ series, maxMinute = 90 }: { series: { minute: number; value: number }[]; maxMinute?: number }) {
  const { t } = usePrefs();
  if (!series.length) return null;
  const last = Math.max(maxMinute, series[series.length - 1].minute);
  const color = (v: number) => (v < 0.33 ? "var(--accent)" : v < 0.66 ? "var(--warn)" : "var(--signal)");
  return (
    <div className="chaos-band-wrap">
      <span className="xs muted">{t("chaos.title")}</span>
      <svg className="chaos-band" viewBox={`0 0 ${last} 6`} preserveAspectRatio="none" role="img"
        aria-label={`${t("chaos.title")} by minute`}>
        {series.map((p, i) => {
          const next = series[i + 1]?.minute ?? p.minute + 1;
          return <rect key={p.minute} x={p.minute} y={0} width={Math.max(0.5, next - p.minute)} height={6} fill={color(p.value)} opacity={0.25 + 0.75 * p.value} />;
        })}
      </svg>
    </div>
  );
}

/** Brief features on a single event: pass length, difficulty, ball/shot/carry speed, sprint tag. */
export function EventDetail({ e }: { e: MatchEvent | undefined }) {
  if (!e) return null;
  const items: { k: string; v: string }[] = [];
  if (e.pass_length !== undefined) items.push({ k: "Length", v: `${e.pass_length.toFixed(0)} m` });
  if (e.ball_speed_kmh !== undefined) items.push({ k: "Ball", v: `${e.ball_speed_kmh.toFixed(0)} km/h` });
  if (e.shot_speed_kmh !== undefined) items.push({ k: "Shot", v: `${e.shot_speed_kmh.toFixed(0)} km/h` });
  if (e.speed_kmh !== undefined) items.push({ k: "Speed", v: `${e.speed_kmh.toFixed(0)} km/h` });
  const sprint = e.tags?.includes("sprint");
  if (!items.length && e.difficulty === undefined && !sprint) return null;
  return (
    <span className="event-detail">
      {e.difficulty !== undefined ? (
        <span className="ed-diff" title={`Difficulty ${(e.difficulty * 100).toFixed(0)} / 100 (MODEL)`}>
          <span className="xs muted">Difficulty</span>
          <span className="ed-track">
            <span style={{ width: `${Math.round(e.difficulty * 100)}%`, background: e.difficulty >= 0.6 ? "var(--signal)" : e.difficulty >= 0.35 ? "var(--warn)" : "var(--accent)" }} />
          </span>
        </span>
      ) : null}
      {items.map((it) => (
        <span key={it.k} className="xs">
          <span className="muted">{it.k}</span> <b className="tnum">{it.v}</b>
        </span>
      ))}
      {sprint ? <span className="pill warn" title="Speed ≥ 25 km/h">⚡ sprint</span> : null}
    </span>
  );
}

export function eventDetailText(e: MatchEvent): string {
  const parts: string[] = [];
  if (e.pass_length !== undefined) parts.push(`${e.pass_length.toFixed(0)} m`);
  if (e.difficulty !== undefined) parts.push(`difficulty ${(e.difficulty * 100).toFixed(0)}/100`);
  if (e.ball_speed_kmh !== undefined) parts.push(`ball ${e.ball_speed_kmh.toFixed(0)} km/h`);
  if (e.shot_speed_kmh !== undefined) parts.push(`shot ${e.shot_speed_kmh.toFixed(0)} km/h`);
  if (e.speed_kmh !== undefined) parts.push(`${e.speed_kmh.toFixed(0)} km/h`);
  if (e.tags?.includes("sprint")) parts.push("⚡ sprint");
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}
