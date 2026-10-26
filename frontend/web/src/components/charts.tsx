import type { PassNetwork, Shot, Tactics, XgBreakdown } from "../api/types";
import { cx, readableOn } from "../lib/format";
import { SHOT_COLORS } from "../lib/palette";
import { Pitch, PlayerDot, project } from "./Pitch";

/** Pass network in the team's own attacking frame (always attacking left→right). */
export function PassNetworkChart({ network, color, minCount = 3 }: { network: PassNetwork; color: string; minCount?: number }) {
  const nodes = new Map(network.nodes.map((n) => [n.player_id, n]));
  const maxTouches = Math.max(1, ...network.nodes.map((n) => n.touches));
  const edges = network.edges.filter((e) => e.count >= minCount && nodes.has(e.source) && nodes.has(e.target));
  const maxCount = Math.max(1, ...edges.map((e) => e.count));
  const ink = readableOn(color);
  return (
    <Pitch label="Pass network">
      <g>
        {edges.map((e, i) => {
          const a = nodes.get(e.source)!;
          const b = nodes.get(e.target)!;
          const [x1, y1] = project(a.x, a.y, true);
          const [x2, y2] = project(b.x, b.y, true);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeOpacity={0.25 + 0.65 * (e.count / maxCount)}
              strokeWidth={0.25 + 1.6 * (e.count / maxCount)}
              strokeLinecap="round"
            >
              <title>{`${a.name} ↔ ${b.name}: ${e.count} passes`}</title>
            </line>
          );
        })}
        {network.nodes.map((n) => {
          const [x, y] = project(n.x, n.y, true);
          return (
            <PlayerDot
              key={n.player_id}
              x={x}
              y={y}
              r={1.3 + 1.6 * Math.sqrt(n.touches / maxTouches)}
              color={color}
              ink={ink}
              label={n.shirt}
              title={`${n.name} · ${n.touches} touches`}
            />
          );
        })}
      </g>
    </Pitch>
  );
}


export function ShotMap({
  shots, homeId, homeColor, awayColor, selected, onSelect,
}: { shots: Shot[]; homeId: string; homeColor: string; awayColor: string; selected?: string | null; onSelect?: (s: Shot) => void }) {
  return (
    <Pitch label="Shot map">
      {shots.map((s) => {
        const [x, y] = project(s.x, s.y, s.team_id === homeId);
        const r = 0.8 + Math.sqrt(s.xg) * 4.2;
        const fill = SHOT_COLORS[s.outcome ?? "off_target"];
        const team = s.team_id === homeId ? homeColor : awayColor;
        const isSel = selected === s.event_id;
        return (
          <g
            key={s.event_id}
            onClick={() => onSelect?.(s)}
            style={{ cursor: onSelect ? "pointer" : "default" }}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelect?.(s);
            }}
            aria-label={`${s.minute}' ${s.player_name} xG ${s.xg.toFixed(2)} ${s.outcome ?? ""}`}
          >
            <title>{`${s.minute}' ${s.player_name} · xG ${s.xg.toFixed(2)} · ${s.outcome ?? ""}`}</title>
            <circle cx={x} cy={y} r={r} fill={fill} fillOpacity={s.outcome === "goal" ? 0.9 : 0.4} stroke={isSel ? "#fff" : team} strokeWidth={isSel ? 0.7 : 0.4} />
          </g>
        );
      })}
    </Pitch>
  );
}

/** xG model explanation: contributions in logit space, as a waterfall from the base rate. */
export function XgWaterfall({ breakdown }: { breakdown: XgBreakdown }) {
  const maxAbs = Math.max(0.5, ...breakdown.factors.map((f) => Math.abs(f.contribution)));
  return (
    <div className="stack gap-8">
      <div className="row small justify-between">
        <span className="muted">Base rate</span>
        <b className="tnum">{breakdown.base.toFixed(2)}</b>
      </div>
      {breakdown.factors.map((f, i) => {
        const w = (Math.abs(f.contribution) / maxAbs) * 50;
        const pos = f.contribution >= 0;
        return (
          <div className="waterfall-row" key={i}>
            <span title={f.detail} className="fw-600">
              {f.name}
            </span>
            <div className="xg-bar bg-surface-3 rounded-full">
              <div className="xg-bar-zero bg-border-strong" />
              <div
                className={cx("xg-bar-fill rounded-full", pos ? "bg-accent" : "bg-danger")}
                style={{ left: pos ? "50%" : `${50 - w}%`, width: `${w}%` }}
              />
            </div>
            <span className={cx("tnum small text-end", pos ? "text-accent" : "text-danger")}>
              {pos ? "+" : ""}
              {f.contribution.toFixed(2)}
            </span>
          </div>
        );
      })}
      <div className="row justify-between border-top pt-8">
        <span className="muted small">Expected goals</span>
        <b className="display tnum fs-28">
          {breakdown.xg.toFixed(2)}
        </b>
      </div>
      <div className="xs faint">Contributions are in log-odds; positive factors raise the chance of scoring. Hover a factor for detail.</div>
    </div>
  );
}

export function PpdaChart({ home, away, homeColor, awayColor }: { home: Tactics["ppda"]; away: Tactics["ppda"]; homeColor: string; awayColor: string }) {
  const windows = home.map((w) => w.window);
  const all = [...home, ...away].map((w) => w.value).filter((v) => Number.isFinite(v) && v > 0);
  const max = Math.max(6, ...all) * 1.1;
  const W = 420;
  const H = 150;
  const L = 24;
  const B = 22;
  const bw = (W - L) / Math.max(1, windows.length);
  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Passes allowed per defensive action by 15-minute window; lower means more intense pressing">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line className="chart-grid" x1={L} x2={W} y1={(H - B) * (1 - f)} y2={(H - B) * (1 - f)} />
          <text className="chart-label" x={L - 4} y={(H - B) * (1 - f) + 3} textAnchor="end">
            {Math.round(max * f)}
          </text>
        </g>
      ))}
      {windows.map((w, i) => {
        const hv = home[i]?.value ?? 0;
        const av = away.find((a) => a.window === w)?.value ?? 0;
        const x0 = L + i * bw + bw * 0.15;
        const barW = bw * 0.33;
        const hh = (Math.min(hv, max) / max) * (H - B);
        const ah = (Math.min(av, max) / max) * (H - B);
        return (
          <g key={w}>
            <rect x={x0} y={H - B - hh} width={barW} height={hh} rx={2} fill={homeColor}>
              <title>{`${w}: ${hv.toFixed(1)}`}</title>
            </rect>
            <rect x={x0 + barW + 2} y={H - B - ah} width={barW} height={ah} rx={2} fill={awayColor}>
              <title>{`${w}: ${av.toFixed(1)}`}</title>
            </rect>
            <text className="chart-label" x={x0 + barW} y={H - 6} textAnchor="middle">
              {w}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ChannelBars({ channels, color }: { channels: Tactics["channels"]; color: string }) {
  // Displayed left→right as the team attacks upward: left channel, centre, right channel.
  const items: [string, number][] = [
    ["Left", channels.left],
    ["Centre", channels.center],
    ["Right", channels.right],
  ];
  return (
    <div className="channel-bars row gap-8 items-end" role="img" aria-label={`Attacking channels: left ${Math.round(channels.left * 100)}%, centre ${Math.round(channels.center * 100)}%, right ${Math.round(channels.right * 100)}%`}>
      {items.map(([label, v]) => (
        <div key={label} className="grow d-flex flex-col items-center gap-6 h-full justify-end">
          <b className="tnum">{Math.round(v * 100)}%</b>
          <div className="channel-bar" style={{ height: `${Math.max(4, v * 100)}%`, background: color, opacity: 0.4 + v }} />
          <span className="xs muted">{label}</span>
        </div>
      ))}
    </div>
  );
}

/** Grouped bars comparing synthetic and reference distributions. */
export function DistributionChart({ data, labelKey, height = 170 }: { data: { label: string; simulated: number; reference: number }[]; labelKey: string; height?: number }) {
  const W = 520;
  const H = height;
  const B = 24;
  const L = 30;
  const max = Math.max(0.01, ...data.flatMap((d) => [d.simulated, d.reference])) * 1.15;
  const bw = (W - L) / Math.max(1, data.length);
  return (
    <div>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${labelKey}: synthetic versus reference`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="chart-grid" x1={L} x2={W} y1={(H - B) * (1 - f)} y2={(H - B) * (1 - f)} />
            <text className="chart-label" x={L - 4} y={(H - B) * (1 - f) + 3} textAnchor="end">
              {Math.round(max * f * 100)}%
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = L + i * bw + bw * 0.14;
          const barW = bw * 0.34;
          const sh = (d.simulated / max) * (H - B);
          const rh = (d.reference / max) * (H - B);
          return (
            <g key={d.label}>
              <rect x={x0} y={H - B - rh} width={barW} height={rh} rx={2} fill="var(--text-faint)" fillOpacity={0.55}>
                <title>{`${d.label} reference ${(d.reference * 100).toFixed(1)}%`}</title>
              </rect>
              <rect x={x0 + barW + 2} y={H - B - sh} width={barW} height={sh} rx={2} fill="var(--accent)">
                <title>{`${d.label} synthetic ${(d.simulated * 100).toFixed(1)}%`}</title>
              </rect>
              <text className="chart-label" x={x0 + barW} y={H - 7} textAnchor="middle">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend mt-4">
        <span>
          <i className="bg-text-faint" />
          Real-world reference
        </span>
        <span>
          <i className="bg-accent" />
          Regista synthetic
        </span>
      </div>
    </div>
  );
}

export function RangeBar({ low, high, reference, simulated }: { low: number; high: number; reference: number; simulated: number }) {
  const span = high - low || 1;
  const min = low - span * 0.6;
  const max = high + span * 0.6;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))}%`;
  return (
    <div className="range-bar" aria-hidden="true">
      <div className="band" style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})` }} />
      <div className="ref" style={{ left: pos(reference) }} />
      <div className="sim" style={{ left: pos(simulated) }} />
    </div>
  );
}
