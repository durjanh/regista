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

/** A country's kit in its team colours: the shirt in the primary colour, shorts in the text colour (England's navy,
 *  Germany's black, France's white), striped where the real shirt is. Shared by the 3D pitch and the line-ups. */
export function kitFor(team: Pick<TeamRef, "team_id" | "colors">, keeper: "home" | "away" | null): Kit {
  if (keeper) return KEEPER[keeper];
  const c = team.colors;
  const striped = STRIPED.has(team.team_id);
  return { shirt: c.primary, stripe: striped ? c.secondary : undefined, shorts: c.text, socks: striped ? c.secondary : c.primary,
           number: c.primary.toLowerCase() === c.text.toLowerCase() ? c.secondary : c.text };
}
