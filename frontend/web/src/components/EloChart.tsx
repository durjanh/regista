import { useMemo, useState } from "react";

const W = 760;
const H = 240;
const L = 42;
const R = 12;
const T = 12;
const B = 24;

function yearOf(date: string): number {
  const [y, m = "1", d = "1"] = date.split("-");
  return Number(y) + (Number(m) - 1) / 12 + (Number(d) - 1) / 365;
}

/** Elo rating over time (can span 150 years). */
export function EloChart({ history, color }: { history: { date: string; elo: number }[]; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(() => {
    const raw = history.map((h) => ({ x: yearOf(h.date), y: h.elo, date: h.date }));
    // keep the path light: at most ~900 points
    const step = Math.max(1, Math.ceil(raw.length / 900));
    return raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
  }, [history]);

  if (pts.length < 2) return <div className="xs muted">Not enough history to chart.</div>;

  const x0 = pts[0].x;
  const x1 = pts[pts.length - 1].x;
  const ys = pts.map((p) => p.y);
  const yMin = Math.floor((Math.min(...ys) - 25) / 50) * 50;
  const yMax = Math.ceil((Math.max(...ys) + 25) / 50) * 50;
  const sx = (x: number) => L + ((x - x0) / Math.max(1e-6, x1 - x0)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - yMin) / Math.max(1, yMax - yMin)) * (H - T - B);
  const line = pts.map((p, i) => `${i ? "L" : "M"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L ${sx(x1)} ${H - B} L ${sx(x0)} ${H - B} Z`;
  const peak = pts.reduce((a, b) => (b.y > a.y ? b : a));
  // Keep the peak label inside the chart when the peak is near either end.
  const peakAt = (sx(peak.x) - L) / (W - L - R);
  const peakAnchor = peakAt > 0.8 ? "end" : peakAt < 0.2 ? "start" : "middle";
  const span = x1 - x0;
  const tickStep = span > 100 ? 25 : span > 40 ? 10 : span > 15 ? 5 : 1;
  const ticks: number[] = [];
  for (let y = Math.ceil(x0 / tickStep) * tickStep; y <= x1; y += tickStep) ticks.push(y);
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const hp = hover !== null ? pts.reduce((a, b) => (Math.abs(b.x - hover) < Math.abs(a.x - hover) ? b : a)) : null;

  return (
    <div>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Elo history from ${pts[0].date.slice(0, 4)} to ${pts[pts.length - 1].date.slice(0, 4)}; peak ${Math.round(peak.y)} in ${peak.date.slice(0, 4)}`}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          setHover(x0 + ((px - L) / (W - L - R)) * (x1 - x0));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="elo-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((y) => (
          <g key={y}>
            <line className="chart-grid" x1={L} x2={W - R} y1={sy(y)} y2={sy(y)} />
            <text className="chart-label" x={L - 6} y={sy(y) + 3} textAnchor="end">
              {Math.round(y)}
            </text>
          </g>
        ))}
        {ticks.map((y) => (
          <text key={y} className="chart-label" x={sx(y)} y={H - 6} textAnchor="middle">
            {y}
          </text>
        ))}
        <path d={area} fill="url(#elo-fill)" />
        <path d={line} fill="none" stroke={color} strokeWidth={1.6} />
        <circle cx={sx(peak.x)} cy={sy(peak.y)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
        <text className="chart-label-strong" x={sx(peak.x)} y={sy(peak.y) - 9} textAnchor={peakAnchor}>
          Peak {Math.round(peak.y)} · {peak.date.slice(0, 4)}
        </text>
        {hp ? (
          <g>
            <line x1={sx(hp.x)} x2={sx(hp.x)} y1={T} y2={H - B} stroke="var(--text)" strokeOpacity={0.5} />
            <circle cx={sx(hp.x)} cy={sy(hp.y)} r={3.5} fill="var(--text)" />
          </g>
        ) : null}
      </svg>
      <div className="xs muted text-end">
        {hp ? (
          <>
            {hp.date}: <b className="tnum">{Math.round(hp.y)}</b>
          </>
        ) : (
          <>Hover to inspect · {pts.length.toLocaleString()} rating updates shown</>
        )}
      </div>
    </div>
  );
}
