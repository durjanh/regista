import { useId, useMemo, useState } from "react";
import type { WinProb } from "../api/types";
import { pct } from "../lib/format";

type Props = {
  momentum: { minute: number; value: number }[];
  winProb: ({ minute: number } & WinProb)[];
  goals: { minute: number; side: "home" | "away"; label: string }[];
  homeColor: string;
  awayColor: string;
  homeName: string;
  awayName: string;
  maxMinute?: number;
  currentMinute?: number;
};

const W = 640;
const MOM_H = 132;
const GAP = 22;
const WP_H = 64;
const H = MOM_H + GAP + WP_H + 18;
const L = 30;
const R = 8;

/** Momentum (top, +home / −away) and stacked win probability (bottom), with goal markers. */
export function MatchPulse({ momentum, winProb, goals, homeColor, awayColor, homeName, awayName, maxMinute, currentMinute }: Props) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const lastMinute = Math.max(maxMinute ?? 0, momentum[momentum.length - 1]?.minute ?? 0, winProb[winProb.length - 1]?.minute ?? 0, 90);
  const x = (m: number) => L + (Math.min(m, lastMinute) / lastMinute) * (W - L - R);
  const midY = MOM_H / 2;
  const my = (v: number) => midY - Math.max(-1, Math.min(1, v)) * (MOM_H / 2 - 4);
  const wpTop = MOM_H + GAP;

  const smooth = useMemo(() => {
    // light smoothing so the area reads as flow rather than noise
    return momentum.map((p, i) => {
      const win = momentum.slice(Math.max(0, i - 1), i + 2);
      return { minute: p.minute, value: win.reduce((s, q) => s + q.value, 0) / win.length };
    });
  }, [momentum]);

  const areaPath = (sign: 1 | -1) => {
    if (smooth.length < 2) return "";
    let d = `M ${x(smooth[0].minute)} ${midY}`;
    for (const p of smooth) d += ` L ${x(p.minute)} ${my(sign > 0 ? Math.max(0, p.value) : Math.min(0, p.value))}`;
    d += ` L ${x(smooth[smooth.length - 1].minute)} ${midY} Z`;
    return d;
  };
  const linePath = smooth.length > 1 ? smooth.map((p, i) => `${i ? "L" : "M"} ${x(p.minute)} ${my(p.value)}`).join(" ") : "";

  const wpBand = (lo: (p: WinProb) => number, hi: (p: WinProb) => number) => {
    if (winProb.length < 2) return "";
    const y = (v: number) => wpTop + (1 - v) * WP_H;
    const top = winProb.map((p, i) => `${i ? "L" : "M"} ${x(p.minute)} ${y(hi(p))}`).join(" ");
    const bottom = [...winProb].reverse().map((p) => `L ${x(p.minute)} ${y(lo(p))}`).join(" ");
    return `${top} ${bottom} Z`;
  };

  const ticks = [0, 15, 30, 45, 60, 75, 90].filter((t) => t <= lastMinute);
  const hoverWp = hover !== null ? nearest(winProb, hover) : winProb[winProb.length - 1];
  const hoverMom = hover !== null ? nearest(smooth, hover) : smooth[smooth.length - 1];

  return (
    <div>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Match momentum and win probability. ${homeName} ${hoverWp ? pct(hoverWp.home) : ""}, draw ${hoverWp ? pct(hoverWp.draw) : ""}, ${awayName} ${hoverWp ? pct(hoverWp.away) : ""}`}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const m = ((px - L) / (W - L - R)) * lastMinute;
          setHover(m >= 0 && m <= lastMinute ? m : null);
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`h${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={homeColor} stopOpacity="0.85" />
            <stop offset="100%" stopColor={homeColor} stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id={`a${uid}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={awayColor} stopOpacity="0.85" />
            <stop offset="100%" stopColor={awayColor} stopOpacity="0.15" />
          </linearGradient>
        </defs>

        {/* grid */}
        {ticks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={x(t)} x2={x(t)} y1={0} y2={wpTop + WP_H} />
            <text className="chart-label" x={x(t)} y={H - 2} textAnchor="middle">
              {t}'
            </text>
          </g>
        ))}
        <line x1={x(45)} x2={x(45)} y1={0} y2={wpTop + WP_H} stroke="var(--border-strong)" strokeWidth={1} />
        <line className="chart-axis" x1={L} x2={W - R} y1={midY} y2={midY} />
        <text className="chart-label-strong" x={L - 4} y={12} textAnchor="end" fill={homeColor}>
          ▲
        </text>
        <text className="chart-label-strong" x={L - 4} y={MOM_H - 4} textAnchor="end">
          ▼
        </text>
        <text className="chart-label" x={L + 4} y={11}>
          {homeName}
        </text>
        <text className="chart-label" x={L + 4} y={MOM_H - 4}>
          {awayName}
        </text>

        {/* momentum */}
        <path d={areaPath(1)} fill={`url(#h${uid})`} />
        <path d={areaPath(-1)} fill={`url(#a${uid})`} />
        <path d={linePath} fill="none" stroke="var(--text)" strokeOpacity={0.55} strokeWidth={1} />

        {/* win probability stacked band */}
        <text className="chart-label" x={L - 4} y={wpTop + 10} textAnchor="end">
          WP
        </text>
        <path d={wpBand(() => 0, (p) => p.away)} fill={awayColor} fillOpacity={0.75} />
        <path d={wpBand((p) => p.away, (p) => p.away + p.draw)} fill="var(--surface-3)" />
        <path d={wpBand((p) => p.away + p.draw, () => 1)} fill={homeColor} fillOpacity={0.75} />
        <rect x={L} y={wpTop} width={W - L - R} height={WP_H} fill="none" stroke="var(--border)" />

        {/* goals */}
        {goals.map((g, i) => (
          <g key={i}>
            <line x1={x(g.minute)} x2={x(g.minute)} y1={2} y2={wpTop + WP_H} stroke={g.side === "home" ? homeColor : awayColor} strokeWidth={1.4} strokeDasharray="3 3" />
            <circle cx={x(g.minute)} cy={g.side === "home" ? 9 : MOM_H - 9} r={7} fill="var(--surface)" stroke={g.side === "home" ? homeColor : awayColor} strokeWidth={1.5} />
            <text x={x(g.minute)} y={(g.side === "home" ? 9 : MOM_H - 9) + 3.5} textAnchor="middle" fontSize={9}>
              ⚽
            </text>
            <title>{g.label}</title>
          </g>
        ))}

        {/* now / hover cursor */}
        {currentMinute !== undefined && hover === null ? (
          <line x1={x(currentMinute)} x2={x(currentMinute)} y1={0} y2={wpTop + WP_H} stroke="var(--signal)" strokeWidth={1.2} />
        ) : null}
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={0} y2={wpTop + WP_H} stroke="var(--text)" strokeOpacity={0.6} /> : null}
      </svg>
      <div className="row xs muted" style={{ justifyContent: "space-between", marginTop: 6 }}>
        <span>
          {hover !== null ? `${Math.round(hover)}'` : "Now"} · Momentum{" "}
          <b style={{ color: (hoverMom?.value ?? 0) >= 0 ? homeColor : awayColor }}>
            {hoverMom ? `${hoverMom.value >= 0 ? homeName : awayName} ${Math.round(Math.abs(hoverMom.value) * 100)}` : "–"}
          </b>
        </span>
        {hoverWp ? (
          <span className="tnum">
            <b style={{ color: homeColor }}>{pct(hoverWp.home)}</b> · Draw {pct(hoverWp.draw)} · <b style={{ color: awayColor }}>{pct(hoverWp.away)}</b>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function nearest<T extends { minute: number }>(arr: T[], m: number): T | undefined {
  let best: T | undefined;
  let d = Infinity;
  for (const p of arr) {
    const dd = Math.abs(p.minute - m);
    if (dd < d) {
      d = dd;
      best = p;
    }
  }
  return best;
}
