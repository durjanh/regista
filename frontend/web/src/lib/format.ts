import type { MatchEvent, Moment, MomentType, TeamRef } from "../api/types";

export const PITCH_W = 105;
export const PITCH_H = 68;

export function clock(minute: number, added?: number): string {
  return added ? `${minute}+${added}'` : `${minute}'`;
}

export function clockFromT(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const num = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : "–");

/** A duration in its two largest units: 812 ms, 1s 22ms, 4m 46s, 1h 5m. */
export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "–";
  const total = Math.max(0, Math.round(ms));
  if (total < 1000) return `${total} ms`;
  const units: [string, number][] = [
    ["h", Math.floor(total / 3_600_000)],
    ["m", Math.floor(total / 60_000) % 60],
    ["s", Math.floor(total / 1000) % 60],
    ["ms", total % 1000],
  ];
  const first = units.findIndex(([, v]) => v > 0);
  return units
    .slice(first, first + 2)
    .filter(([, v]) => v > 0)
    .map(([u, v]) => `${v}${u}`)
    .join(" ");
}

/** The same for a duration in seconds (time to detect, match clock spans). */
export const durationS = (s: number | null | undefined) => duration(s === null || s === undefined ? s : s * 1000);

/** Map an event's coordinates (acting team's attacking frame) onto a pitch where home attacks left→right. */
export function toHomeFrame(x: number, y: number, isHome: boolean): [number, number] {
  return isHome ? [x, y] : [PITCH_W - x, PITCH_H - y];
}

/** SVG y grows downwards; flip so the acting team's right touchline (y=0) sits at the bottom. */
export const svgY = (y: number) => PITCH_H - y;

export function teamColor(team: TeamRef | undefined, fallback = "#7c8aa5"): string {
  return team?.colors?.primary ?? fallback;
}

/** Ensure text drawn on team colour stays readable. */
export function readableOn(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#0b1020" : "#ffffff";
}

/** Two team colours can clash (both red). Return the away colour, or its secondary if too close to home. */
export function distinctAway(home: TeamRef | undefined, away: TeamRef | undefined): string {
  const a = away?.colors.primary ?? "#e5484d";
  const h = home?.colors.primary ?? "#3e63dd";
  return colorDistance(a, h) < 90 ? away?.colors.secondary ?? "#f5d90a" : a;
}

function colorDistance(a: string, b: string): number {
  const p = (hex: string) => {
    const h = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  };
  const [r1, g1, b1] = p(a);
  const [r2, g2, b2] = p(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

export const MOMENT_ICON: Record<MomentType, string> = {
  goal: "⚽",
  big_chance: "🎯",
  save: "🧤",
  penalty: "⚪",
  red_card: "🟥",
  yellow_card: "🟨",
  substitution: "🔁",
  momentum_swing: "🌊",
  tactical_shift: "♟️",
  turning_point: "⚡",
  pressing_spell: "🔥",
  wp_swing: "📈",
};

export const MOMENT_LABEL: Record<MomentType, string> = {
  goal: "Goal",
  big_chance: "Big chance",
  save: "Save",
  penalty: "Penalty",
  red_card: "Red card",
  yellow_card: "Yellow card",
  substitution: "Substitution",
  momentum_swing: "Momentum swing",
  tactical_shift: "Tactical shift",
  turning_point: "Turning point",
  pressing_spell: "Pressing spell",
  wp_swing: "Win-probability swing",
};

export function importanceTier(m: Pick<Moment, "importance">): "high" | "mid" | "low" {
  return m.importance >= 75 ? "high" : m.importance >= 45 ? "mid" : "low";
}

export function describeEvent(e: MatchEvent): string {
  const who = e.player_name ?? "";
  switch (e.type) {
    case "shot":
      return `${who} shoots${e.shot_outcome ? ` — ${e.shot_outcome.replace("_", " ")}` : ""}${e.xg !== undefined ? ` (xG ${e.xg.toFixed(2)})` : ""}`;
    case "pass":
      return `${who} ${e.pass_type && e.pass_type !== "short" ? e.pass_type.replace("_", " ") : "pass"}${e.outcome === "fail" ? " (misplaced)" : ""}`;
    case "carry":
      return `${who} carries`;
    case "dribble":
      return `${who} takes on${e.outcome === "fail" ? " (dispossessed)" : ""}`;
    case "card":
      return `${who} — ${e.card === "red" || e.card === "second_yellow" ? "red card" : "yellow card"}`;
    case "substitution":
      return `Substitution`;
    default:
      return `${who} ${e.type.replace("_", " ")}`.trim();
  }
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Dataset sources arrive as "github.com/owner/repo (…)" or a full URL; return a clickable URL. */
export function sourceUrl(source: string): string {
  const full = /https?:\/\/\S+/.exec(source);
  if (full) return full[0].replace(/[),.]+$/, "");
  const gh = /github\.com\/[\w.-]+\/[\w.-]+/.exec(source);
  return gh ? `https://${gh[0]}` : "https://github.com/martj42/international_results";
}
