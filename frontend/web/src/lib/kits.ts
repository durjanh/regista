import type { TeamRef } from "../api/types";

/** A player's kit: shirt (and stripe), shorts, socks, and the colour of the number on the back. */
export type Kit = { shirt: string; stripe?: string; shorts: string; socks: string; number: string };

/** Shirts with a pattern the team colours alone don't capture. */
const STRIPED = new Set(["argentina"]);
/** Goalkeepers wear a colour neither side's outfield players do. */
const KEEPER: Record<"home" | "away", Kit> = {
  home: { shirt: "#f5c518", shorts: "#111827", socks: "#f5c518", number: "#111827" },
  away: { shirt: "#22c55e", shorts: "#0f172a", socks: "#22c55e", number: "#0f172a" },
};

/** Training bibs the substitutes wear on the bench, in colours no kit or ball uses. */
export const BIBS = { home: "#a3e635", away: "#2dd4bf" };

/** Both teams' outfield kits for one match: when the shirts are too alike (Argentina v Uruguay), the away side
 *  changes into its secondary colour, as the laws of the game require. */
export function matchKits(home: Pick<TeamRef, "team_id" | "colors">, away: Pick<TeamRef, "team_id" | "colors">): { home: Kit; away: Kit } {
  const h = kitFor(home, null), a = kitFor(away, null);
  const near = (x: string, y: string) => {
    const p = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const [r1, g1, b1] = p(x.toLowerCase()), [r2, g2, b2] = p(y.toLowerCase());
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2) < 110;
  };
  if (!near(h.shirt, a.shirt) && !(h.stripe && near(h.stripe, a.shirt))) return { home: h, away: a };
  const change = [away.colors.secondary, away.colors.text, "#ffffff", "#111827"].find((c) => !near(c, h.shirt) && !(h.stripe && near(c, h.stripe))) ?? "#111827";
  const shorts = near(change, a.shorts) ? (change === "#ffffff" ? "#111827" : "#ffffff") : a.shorts;
  return { home: h, away: { shirt: change, shorts, socks: change, number: near(change, "#ffffff") ? "#111827" : "#ffffff" } };
}

/** A country's kit in its team colours: the shirt in the primary colour, shorts in the text colour (England's navy,
 *  Germany's black, France's white), striped where the real shirt is. Shared by the 3D pitch and the line-ups. */
export function kitFor(team: Pick<TeamRef, "team_id" | "colors">, keeper: "home" | "away" | null): Kit {
  if (keeper) return KEEPER[keeper];
  const c = team.colors;
  const striped = STRIPED.has(team.team_id);
  return { shirt: c.primary, stripe: striped ? c.secondary : undefined, shorts: c.text, socks: striped ? c.secondary : c.primary,
           number: c.primary.toLowerCase() === c.text.toLowerCase() ? c.secondary : c.text };
}
