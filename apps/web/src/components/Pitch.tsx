import type { ReactNode } from "react";
import { PITCH_H, PITCH_W, svgY, toHomeFrame } from "../lib/format";

/** Project event coordinates (acting team frame) to SVG coordinates on a home-attacks-right pitch. */
export function project(x: number, y: number, actingIsHome: boolean): [number, number] {
  const [hx, hy] = toHomeFrame(x, y, actingIsHome);
  return [hx, svgY(hy)];
}

const PAD = 2.5;

/** Regulation 105×68 pitch with markings. Children draw in pitch metres. */
export function Pitch({ children, label, stripes = true, halfOnly = false }: { children?: ReactNode; label?: string; stripes?: boolean; halfOnly?: boolean }) {
  const vbX = halfOnly ? PITCH_W / 2 - PAD : -PAD;
  const vbW = halfOnly ? PITCH_W / 2 + PAD * 2 : PITCH_W + PAD * 2;
  const line = { fill: "none", stroke: "var(--pitch-line)", strokeWidth: 0.35 } as const;
  const bands = 12;
  return (
    <div className="pitch-wrap">
      <svg className="pitch-svg" viewBox={`${vbX} ${-PAD} ${vbW} ${PITCH_H + PAD * 2}`} role="img" aria-label={label ?? "Football pitch"}>
        <defs>
          <radialGradient id="pitch-vignette" cx="50%" cy="50%" r="75%">
            <stop offset="60%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.28" />
          </radialGradient>
        </defs>
        <rect x={-PAD} y={-PAD} width={PITCH_W + PAD * 2} height={PITCH_H + PAD * 2} fill="var(--pitch)" />
        {stripes
          ? Array.from({ length: bands }).map((_, i) =>
              i % 2 ? <rect key={i} x={(PITCH_W / bands) * i} y={0} width={PITCH_W / bands} height={PITCH_H} fill="var(--pitch-2)" /> : null,
            )
          : null}
        <rect x={-PAD} y={-PAD} width={PITCH_W + PAD * 2} height={PITCH_H + PAD * 2} fill="url(#pitch-vignette)" />
        <g {...line}>
          <rect x={0} y={0} width={PITCH_W} height={PITCH_H} />
          <line x1={PITCH_W / 2} y1={0} x2={PITCH_W / 2} y2={PITCH_H} />
          <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={9.15} />
          <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={0.4} fill="var(--pitch-line)" />
          {/* penalty areas */}
          <rect x={0} y={13.84} width={16.5} height={40.32} />
          <rect x={PITCH_W - 16.5} y={13.84} width={16.5} height={40.32} />
          {/* goal areas */}
          <rect x={0} y={24.84} width={5.5} height={18.32} />
          <rect x={PITCH_W - 5.5} y={24.84} width={5.5} height={18.32} />
          {/* penalty spots */}
          <circle cx={11} cy={PITCH_H / 2} r={0.35} fill="var(--pitch-line)" />
          <circle cx={PITCH_W - 11} cy={PITCH_H / 2} r={0.35} fill="var(--pitch-line)" />
          {/* arcs */}
          <path d={`M 16.5 ${PITCH_H / 2 - 7.3} A 9.15 9.15 0 0 1 16.5 ${PITCH_H / 2 + 7.3}`} />
          <path d={`M ${PITCH_W - 16.5} ${PITCH_H / 2 - 7.3} A 9.15 9.15 0 0 0 ${PITCH_W - 16.5} ${PITCH_H / 2 + 7.3}`} />
          {/* goals */}
          <rect x={-1.6} y={30.34} width={1.6} height={7.32} />
          <rect x={PITCH_W} y={30.34} width={1.6} height={7.32} />
          {/* corner arcs */}
          <path d="M 0 1 A 1 1 0 0 0 1 0" />
          <path d={`M ${PITCH_W - 1} 0 A 1 1 0 0 0 ${PITCH_W} 1`} />
          <path d={`M 0 ${PITCH_H - 1} A 1 1 0 0 1 1 ${PITCH_H}`} />
          <path d={`M ${PITCH_W - 1} ${PITCH_H} A 1 1 0 0 1 ${PITCH_W} ${PITCH_H - 1}`} />
        </g>
        {children}
      </svg>
    </div>
  );
}

/** A player dot with shirt number. */
export function PlayerDot({
  x, y, color, ink, label, r = 1.6, ring, title, opacity = 1,
}: { x: number; y: number; color: string; ink: string; label?: string | number; r?: number; ring?: string; title?: string; opacity?: number }) {
  return (
    <g opacity={opacity}>
      {title ? <title>{title}</title> : null}
      {ring ? <circle cx={x} cy={y} r={r + 0.9} fill="none" stroke={ring} strokeWidth={0.45} /> : null}
      <circle cx={x} cy={y} r={r} fill={color} stroke="rgba(0,0,0,0.45)" strokeWidth={0.25} />
      {label !== undefined ? (
        <text x={x} y={y + r * 0.38} textAnchor="middle" fontSize={r * 1.05} fontWeight={800} fill={ink} fontFamily="var(--font)">
          {label}
        </text>
      ) : null}
    </g>
  );
}
