import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Percentile, Rec, Split3 } from "../api/types";
import { cx, PITCH_H, svgY } from "../lib/format";
import { scoutingPath } from "../lib/players";
import { Pitch } from "./Pitch";

/** Player name that links to the Player DNA page when a stable key exists. */
export function PlayerLink({ name, playerKey, placeholder, className }: { name: string; playerKey?: string; placeholder?: boolean; className?: string }) {
  const label = <span className={placeholder ? "placeholder-name" : undefined} translate="no">{name}</span>;
  if (!playerKey) return <span className={className}>{label}</span>;
  return (
    <Link to={scoutingPath(playerKey)} className={cx("team-link", className)} title={`${name}: scouting profile`}>
      {label}
    </Link>
  );
}

const pctLabel = (v: number) => `${Math.round(v * 100)}%`;

function heat(share: number): string {
  const a = Math.min(0.85, 0.12 + share * 1.1);
  return `color-mix(in srgb, var(--accent) ${Math.round(a * 100)}%, var(--surface-3))`;
}

/**
 * Goal mouth split into three zones, seen from the penalty taker (left of the picture = taker's left).
 * Used for penalty placement and for goalkeeper dive tendencies.
 */
export function GoalMouth({ split, title, caption, highlight }: { split: Split3; title: string; caption?: ReactNode; highlight?: keyof Split3 }) {
  const zones: { key: keyof Split3; label: string }[] = [
    { key: "left", label: "Taker's left" },
    { key: "center", label: "Centre" },
    { key: "right", label: "Taker's right" },
  ];
  const best = highlight ?? (Object.entries(split).sort((a, b) => b[1] - a[1])[0]?.[0] as keyof Split3);
  return (
    <figure className="goalmouth" aria-label={`${title}: ${zones.map((z) => `${z.label} ${pctLabel(split[z.key] ?? 0)}`).join(", ")}`}>
      <svg viewBox="0 0 240 104" role="img">
        <title>{title}</title>
        <rect x="0" y="100" width="240" height="4" fill="var(--pitch)" />
        {/* net */}
        <rect x="12" y="10" width="216" height="90" fill="var(--surface-2)" />
        {zones.map((z, i) => {
          const share = split[z.key] ?? 0;
          return (
            <g key={z.key}>
              <rect x={12 + i * 72} y={10} width={72} height={90} fill={heat(share)} stroke="var(--border)" strokeWidth="0.6" />
              <text x={48 + i * 72} y={58} textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--text)" fontFamily="var(--font-display)">
                {pctLabel(share)}
              </text>
              <text x={48 + i * 72} y={78} textAnchor="middle" fontSize="9" fill="var(--text-dim)">
                {z.label}
              </text>
              {best === z.key ? <rect x={14 + i * 72} y={12} width={68} height={86} fill="none" stroke="var(--accent)" strokeWidth="2" rx="3" /> : null}
            </g>
          );
        })}
        {/* posts and bar */}
        <path d="M 10 102 L 10 8 L 230 8 L 230 102" fill="none" stroke="#fff" strokeWidth="4" strokeLinejoin="round" />
      </svg>
      {caption ? <figcaption className="xs muted">{caption}</figcaption> : null}
    </figure>
  );
}

/** Half pitch (attacking frame, x 52.5–105) with shots sized by xG; goals filled. */
export function HalfPitchShots({ shots, goals, color, label }: { shots: { x: number; y: number; xg: number; outcome?: string }[]; goals?: { x: number; y: number; xg: number }[]; color: string; label: string }) {
  return (
    <Pitch halfOnly label={label}>
      {shots.map((s, i) => (
        <circle key={`s${i}`} cx={s.x} cy={svgY(s.y)} r={0.8 + Math.sqrt(s.xg) * 3.2} fill={s.outcome === "goal" ? color : "none"} stroke={color} strokeWidth={0.45} opacity={0.85}>
          <title>{`xG ${s.xg.toFixed(2)} · ${s.outcome ?? ""}`}</title>
        </circle>
      ))}
      {(goals ?? []).map((g, i) => (
        <circle key={`g${i}`} cx={g.x} cy={svgY(g.y)} r={0.8 + Math.sqrt(g.xg) * 3.2} fill={color} stroke="#fff" strokeWidth={0.4}>
          <title>{`Goal · xG ${g.xg.toFixed(2)}`}</title>
        </circle>
      ))}
    </Pitch>
  );
}

/**
 * Channel shares as arrows on a full pitch, attacking left → right. In the event frame y = 0 is the team's
 * right touchline, drawn at the bottom; so the team's left channel is the top lane.
 */
export function ChannelArrows({ split, color, label, unit = "of attacks" }: { split: Split3; color: string; label: string; unit?: string }) {
  const lanes: { key: keyof Split3; y: number; name: string }[] = [
    { key: "left", y: (PITCH_H * 5) / 6, name: "Left" },
    { key: "center", y: PITCH_H / 2, name: "Centre" },
    { key: "right", y: PITCH_H / 6, name: "Right" },
  ];
  return (
    <Pitch label={label} stripes={false}>
      <defs>
        <marker id="chan-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      </defs>
      {lanes.map((l) => {
        const share = split[l.key] ?? 0;
        return (
          <g key={l.key}>
            <line x1={30} y1={svgY(l.y)} x2={92} y2={svgY(l.y)} stroke={color} strokeWidth={0.6 + share * 9} strokeLinecap="round" opacity={0.25 + share} markerEnd="url(#chan-head)" />
            <text x={18} y={svgY(l.y) + 1.6} textAnchor="middle" fontSize="4.2" fontWeight="800" fill="#fff" fontFamily="var(--font-display)">
              {pctLabel(share)}
            </text>
            <text x={18} y={svgY(l.y) + 5.6} textAnchor="middle" fontSize="2.6" fill="rgba(255,255,255,0.75)">
              {l.name}
            </text>
          </g>
        );
      })}
      <text x={98} y={PITCH_H - 2} textAnchor="end" fontSize="2.6" fill="rgba(255,255,255,0.7)">
        {unit} · attacking →
      </text>
    </Pitch>
  );
}

/** Horizontal share bar for a three-way split (e.g. right foot / left foot / head). */
export function SplitBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="stack gap-6">
      <div className="split-bar" aria-hidden="true">
        {parts.map((p) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="row xs gap-12 wrap">
        {parts.map((p) => (
          <span key={p.label} className="row gap-5">
            <i className="swatch" style={{ background: p.color }} />
            {p.label} <b className="tnum">{pctLabel(p.value / total)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Percentile vs position peers; colour follows whether a high value is good. */
export function PercentileBar({ p }: { p: Percentile }) {
  const goodness = p.higher_is_better ? p.percentile : 100 - p.percentile;
  const tone = goodness >= 66 ? "var(--accent)" : goodness <= 33 ? "var(--danger)" : "var(--warn)";
  return (
    <div className="pct-row" title={`${p.label}: ${p.value} · ${Math.round(p.percentile)}th percentile of ${p.peers} peers${p.higher_is_better ? "" : " (lower is better)"}`}>
      <span className="pct-label">{p.label}</span>
      <span className="pct-track" aria-hidden="true">
        <span style={{ width: `${Math.max(2, Math.min(100, p.percentile))}%`, background: tone }} />
      </span>
      <span className="pct-val tnum">{formatValue(p.value)}</span>
      <span className="pct-rank tnum" style={{ color: tone }}>
        {Math.round(p.percentile)}
      </span>
    </div>
  );
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "–";
  return Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
}

/** Compact W-D-L record table rows. */
export function RecordTable({ rows }: { rows: { label: string; rec: Rec }[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th />
            <th className="tnum">P</th>
            <th className="tnum">W</th>
            <th className="tnum">D</th>
            <th className="tnum">L</th>
            <th className="tnum">GF</th>
            <th className="tnum">GA</th>
            <th className="tnum">Win %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, rec }) => (
            <tr key={label}>
              <td className="fw-700">{label}</td>
              <td className="tnum">{rec.played}</td>
              <td className="tnum">{rec.won}</td>
              <td className="tnum">{rec.drawn}</td>
              <td className="tnum">{rec.lost}</td>
              <td className="tnum">{rec.gf}</td>
              <td className="tnum">{rec.ga}</td>
              <td className="tnum">
                <b>{Math.round((rec.win_pct > 1 ? rec.win_pct / 100 : rec.win_pct) * 100)}%</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdviceCards({ items, icon = "🛡" }: { items: { title: string; detail: string; evidence: string }[]; icon?: string }) {
  if (!items.length) return null;
  return (
    <div className="advice-list">
      {items.map((a, i) => (
        <article key={i} className="advice">
          <div className="advice-icon" aria-hidden="true">
            {icon}
          </div>
          <div>
            <div className="advice-title">{a.title}</div>
            <div className="small">{a.detail}</div>
            {a.evidence ? <div className="xs muted advice-ev">Evidence: {a.evidence}</div> : null}
          </div>
        </article>
      ))}
    </div>
  );
}
