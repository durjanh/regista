import type { CSSProperties, ReactNode } from "react";
import type { Evidence, Insight, Narrative, Verification } from "../api/types";
import { clock, cx, pct } from "../lib/format";
import { usePrefs } from "../lib/prefs";
import { mechanismIcon, mechanismLabel } from "../lib/truth";
import { AgentTrace } from "./AgentTrace";
import { EngineBadge, FactCheckBadge } from "./FactCheck";
import { CitedText } from "./Markdown";
import { ModelTag } from "./SourceBadge";

const W = 320;
const H = 116;
const PAD = { l: 30, r: 8, t: 12, b: 18 };

/**
 * "Show your working": the feature the detector watched, the detected change point and the before/after levels.
 * In truth mode the planted time is drawn too, so the gap between them is visible.
 */
export function FeatureChart({
  feature, plantedMinute, color = "var(--accent)",
}: { feature: Insight["feature"]; plantedMinute?: number | null; color?: string }) {
  const series = feature.series;
  if (series.length < 2) return <div className="xs faint">Not enough data yet.</div>;
  const minM = series[0].minute;
  const maxM = Math.max(series[series.length - 1].minute, feature.change_minute, plantedMinute ?? 0);
  const vals = [...series.map((p) => p.value), feature.before, feature.after];
  const lo = Math.min(0, ...vals);
  // Per-minute ratios spike when the denominator is tiny (one build-up pass in a minute). Scale to the 90th percentile
  // so the before/after change stays readable, and clip the spikes at the top edge.
  const sorted = series.map((p) => p.value).sort((a, b) => a - b);
  const p90 = sorted[Math.floor(0.9 * (sorted.length - 1))];
  const hi = Math.max(feature.before, feature.after, p90) * 1.15 || 1;
  const x = (m: number) => PAD.l + ((m - minM) / Math.max(1, maxM - minM)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (Math.min(v, hi) - lo) / Math.max(1e-9, hi - lo)) * (H - PAD.t - PAD.b);
  const line = series.map((p, i) => `${i ? "L" : "M"} ${x(p.minute).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const cx0 = x(feature.change_minute);
  const fmt = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2));
  return (
    <svg className="chart-svg feature-chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`${feature.label}: ${fmt(feature.before)} before minute ${feature.change_minute}, ${fmt(feature.after)} after`}>
      <line className="chart-axis" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} />
      <text className="chart-label" x={PAD.l - 4} y={y(hi) + 4} textAnchor="end">{fmt(hi)}</text>
      <text className="chart-label" x={PAD.l - 4} y={y(lo) + 2} textAnchor="end">{fmt(lo)}</text>
      <text className="chart-label" x={PAD.l} y={H - 4}>{minM}'</text>
      <text className="chart-label" x={W - PAD.r} y={H - 4} textAnchor="end">{maxM}'</text>
      <path d={line} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.4} />
      {/* before / after levels */}
      <line x1={x(minM)} x2={cx0} y1={y(feature.before)} y2={y(feature.before)} stroke="var(--text-dim)" strokeWidth={2} />
      <line x1={cx0} x2={x(maxM)} y1={y(feature.after)} y2={y(feature.after)} stroke={color} strokeWidth={2.4} />
      <text className="chart-label" x={x(minM) + 2} y={y(feature.before) - 4}>{fmt(feature.before)}</text>
      <text className="chart-label-strong" x={x(maxM) - 2} y={y(feature.after) - 4} textAnchor="end" fill={color}>{fmt(feature.after)}</text>
      {/* detected change point */}
      <line x1={cx0} x2={cx0} y1={PAD.t - 4} y2={H - PAD.b} stroke="var(--signal)" strokeWidth={1.4} />
      {/* near the right edge the label sits left of the line so it cannot run into the "after" value */}
      <text className="chart-label-strong" x={cx0 > W * 0.6 ? cx0 - 3 : cx0 + 3} y={PAD.t + 2} textAnchor={cx0 > W * 0.6 ? "end" : "start"}
        fill="var(--signal)">detected {feature.change_minute}'</text>
      {plantedMinute !== undefined && plantedMinute !== null ? (
        <g>
          <line x1={x(plantedMinute)} x2={x(plantedMinute)} y1={PAD.t - 4} y2={H - PAD.b} stroke="var(--warn)" strokeWidth={1.4} strokeDasharray="4 3" />
          <text className="chart-label-strong" x={x(plantedMinute) - 3} y={H - PAD.b - 4} textAnchor="end" fill="var(--warn)">planted {plantedMinute}'</text>
        </g>
      ) : null}
    </svg>
  );
}

const NOT_IN_SHEET = /^Number (.+?) is not in the fact sheet$/;

/** Wrap every flagged number in the draft so it can be struck through (and announced) in place. */
function markFlagged(draft: string, flagged: string[]): ReactNode[] {
  const clean = draft.replace(/\s?\[f\d+\]/g, "");
  const tokens = [...new Set(flagged)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!tokens.length) return [clean];
  const esc = tokens.map((tok) => tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(?<![\\d.])(${esc.join("|")})(?![\\d])`, "g");
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of clean.matchAll(re)) {
    const i = m.index ?? 0;
    out.push(clean.slice(last, i));
    out.push(<del key={i} className="vf-flag" aria-label={`flagged: ${m[0]}`}>{m[0]}</del>);
    last = i + m[0].length;
  }
  out.push(clean.slice(last));
  return out;
}

/**
 * What the Verifier caught in the Analyst's draft before the line aired. In a drill the error was planted on purpose,
 * the claim-level twin of a planted tactical change, so the catch (or a miss) is visible on screen.
 */
export function VerifierStrip({ v }: { v: Verification }) {
  const { t } = usePrefs();
  const flagged = v.issues.map((i) => NOT_IN_SHEET.exec(i.problem)?.[1] ?? "").concat(v.planted && v.caught ? [v.planted.planted] : []);
  const caught = v.drill ? v.caught === true : v.issues.length > 0;
  const problem = (p: string) => {
    const m = NOT_IN_SHEET.exec(p);
    return m ? t("verifier.notInEvidence").replace("{n}", m[1]) : p;
  };
  return (
    <div className={cx("verifier", caught ? "caught" : "missed")} role="group" aria-label={v.drill ? t("verifier.drill") : t("verifier.title")}>
      <div className="row" style={{ justifyContent: "space-between", gap: 6 }}>
        <span className="verifier-label">🛡 {v.drill ? t("verifier.drill") : t("verifier.title")}</span>
        <span className={cx("pill", caught ? "accent" : "danger")}>{caught ? `✓ ${t("verifier.caught")}` : `✕ ${t("verifier.missed")}`}</span>
      </div>
      <div className="xs">
        <span className="muted">{t("verifier.draft")}: </span>
        <span className="vf-draft">{markFlagged(v.draft, flagged)}</span>
      </div>
      {v.issues.length ? (
        <ul className="vf-issues xs">
          {v.issues.map((i, k) => (
            <li key={k}>
              ⚑ {problem(i.problem)}
              {v.planted && NOT_IN_SHEET.exec(i.problem)?.[1] === v.planted.planted ? (
                <span className="muted"> · {t("verifier.evidenceSays")} <b className="tnum">{v.planted.original}</b></span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {v.drill && !caught && v.planted ? (
        <div className="xs">
          ⚑ {t("verifier.planted")}: <b className="tnum">{v.planted.original}</b> → <b className="tnum">{v.planted.planted}</b>
        </div>
      ) : null}
      <div className="xs muted">{caught ? `↻ ${t("verifier.rewritten")}` : t("verifier.missedNote")}</div>
    </div>
  );
}

type Props = {
  insight: Insight & { narrative?: Narrative };
  teamName?: string;
  teamColor?: string;
  /** Truth mode: the planted minute of the change this insight was graded against. */
  plantedMinute?: number | null;
  verdict?: "hit" | "false_alarm" | null;
  activeFact?: string | null;
  onEvidence?: (ev: Evidence, insightId: string) => void;
  compact?: boolean;
};

export function InsightCard({ insight, teamName, teamColor, plantedMinute, verdict, activeFact, onEvidence, compact }: Props) {
  const { t } = usePrefs();
  const n = insight.narrative;
  const f = insight.feature;
  const conf = insight.confidence;
  return (
    <article className={cx("insight", verdict === "hit" && "hit", verdict === "false_alarm" && "false-alarm")}
      style={{ "--team": teamColor ?? "var(--accent)" } as CSSProperties}>
      <div className="insight-head">
        <span className="insight-icon" aria-hidden="true">{mechanismIcon(insight.mechanism)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="insight-title">{insight.title}</div>
          <div className="xs muted">
            {mechanismLabel(insight.mechanism)}
            {teamName ? ` · ${teamName}` : ""}
            {insight.player_name ? ` · ${insight.player_name}` : ""} · since {clock(insight.start_minute)} · flagged at {clock(insight.detected_minute)}
          </div>
        </div>
        <span className={cx("pill", conf >= 0.75 ? "accent" : conf >= 0.5 ? "warn" : "")} title="Detector confidence">
          {pct(conf)}
        </span>
        {verdict === "hit" ? <span className="pill accent" title="Matches a planted change">✔ truth</span> : null}
        {verdict === "false_alarm" ? <span className="pill danger" title="Nothing was planted here">false alarm</span> : null}
      </div>

      <p className="insight-text">
        {n ? <CitedText text={n.text} citations={n.citations} /> : insight.text}
      </p>
      {n?.verification ? <VerifierStrip v={n.verification} /> : null}

      <FeatureChart feature={f} plantedMinute={plantedMinute} color={teamColor} />
      <div className="row xs muted" style={{ justifyContent: "space-between" }}>
        <span>{f.label}{f.unit ? ` (${f.unit})` : ""}</span>
        <span className="tnum">
          {f.before.toFixed(2)} → <b style={{ color: teamColor ?? "var(--accent)" }}>{f.after.toFixed(2)}</b>
        </span>
      </div>

      {insight.evidence.length && !compact ? (
        <div className="chips" aria-label="Evidence">
          {insight.evidence.map((ev) => (
            <button key={ev.fact_id} type="button" className={cx("chip", activeFact === `${insight.id}:${ev.fact_id}` && "on")}
              onClick={() => onEvidence?.(ev, insight.id)} disabled={!onEvidence}>
              <span className="fid">{ev.fact_id.split(":").pop()}</span> {ev.label}: <b>{ev.value}{ev.unit ? ` ${ev.unit}` : ""}</b>
            </button>
          ))}
        </div>
      ) : null}

      <details className="disclosure receipt">
        <summary>🧾 {t("insight.receipt")}</summary>
        <pre className="kql" aria-label="KQL query">{f.query}</pre>
      </details>

      {n ? (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <FactCheckBadge fc={n.fact_check} />
          <EngineBadge engine={n.engine} ms={n.latency_ms} />
          <ModelTag />
        </div>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          <ModelTag title="Detected from Regista's synthetic match events" />
        </div>
      )}
      {n?.agent_trace?.length && !compact ? (
        <details className="disclosure">
          <summary>{t("feed.trace")}</summary>
          <AgentTrace steps={n.agent_trace} />
        </details>
      ) : null}
    </article>
  );
}
