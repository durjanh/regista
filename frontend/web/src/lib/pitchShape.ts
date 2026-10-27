import type { MatchEvent, Player, Position, Team } from "../api/types";
import { PITCH_H, PITCH_W, toHomeFrame } from "./format";

/**
 * Where the 22 players stand for the 3D pitch. Events record the ball and the player on it, not the other 20, so the
 * rest are placed from each team's formation and shifted with the ball (MODEL): the block slides towards the ball,
 * pushes up in possession and drops off without it. Coordinates are metres in a team's own frame (attacking +x,
 * y = 0 on its right touchline), as in the events.
 */

/** A role's home spot in its own team's frame. */
const BASE: Record<Position, [number, number]> = {
  GK: [5, 34], RB: [27, 10], CB: [20, 34], LB: [27, 58], RWB: [36, 7], LWB: [36, 61],
  DM: [36, 34], CM: [46, 34], AM: [60, 34], RW: [66, 11], LW: [66, 57], ST: [77, 34],
};
/** How far apart players sharing a role stand across the pitch. */
const SPREAD: Partial<Record<Position, number>> = { CB: 15, DM: 17, CM: 24, AM: 26, ST: 14 };

/** Event types that show which team has the ball. */
const ON_BALL = new Set(["kick_off", "pass", "carry", "dribble", "shot", "corner", "free_kick", "throw_in", "goal_kick", "recovery", "interception"]);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Each starter's formation spot, players sharing a role spread evenly across it. */
export function formationSpots(players: Player[]): Map<string, [number, number]> {
  const byRole = new Map<Position, Player[]>();
  for (const p of players) byRole.set(p.position, [...(byRole.get(p.position) ?? []), p]);
  const spots = new Map<string, [number, number]>();
  for (const [role, group] of byRole) {
    const [bx, by] = BASE[role] ?? BASE.CM;
    const width = (SPREAD[role] ?? 16) * (group.length - 1);
    group.forEach((p, i) => spots.set(p.player_id, [bx, group.length > 1 ? by - width / 2 + (width * i) / (group.length - 1) : by]));
  }
  return spots;
}

/** A player's spot when the ball is at `ball` (this team's frame), with or without possession. */
export function shiftedSpot(spot: [number, number], ball: [number, number], inPossession: boolean, keeper: boolean): [number, number] {
  const [sx, sy] = spot;
  const [bx, by] = ball;
  if (keeper) return [clamp(sx + (bx - PITCH_W / 2) * 0.08, 2, 16), clamp(sy + (by - PITCH_H / 2) * 0.12, 28, 40)];
  const dx = (bx - PITCH_W / 2) * 0.5 + (inPossession ? 7 : -5);
  const squeeze = inPossession ? 1 : 0.78;                                          // narrower without the ball
  const x = sx + dx;
  const y = PITCH_H / 2 + (sy - PITCH_H / 2) * squeeze + (by - PITCH_H / 2) * 0.3;
  return [clamp(x, 3, PITCH_W - 3), clamp(y, 2, PITCH_H - 2)];
}

/** The team in possession after these events: the last team to act on the ball. */
export function possessionTeam(events: MatchEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (ON_BALL.has(events[i].type)) return events[i].team_id;
  return events[events.length - 1]?.team_id;
}

/** Where the ball starts and ends for an event, in the home frame (home attacks +x). */
export function ballPath(e: MatchEvent, homeId: string): { from: [number, number]; to: [number, number] } {
  const home = e.team_id === homeId;
  const from = toHomeFrame(e.x, e.y, home);
  const to = e.end_x !== undefined && e.end_y !== undefined ? toHomeFrame(e.end_x, e.end_y, home) : from;
  return { from, to };
}

/** One of the eleven places in a team's shape and who fills it now; `on` is the minute a substitute came on. */
export type Slot = { player: Player; spot: [number, number]; on?: number; replaced?: Player };

/** The XI after these events: starters in their formation spots, each substitute taking the spot of the player he
 *  replaced, so a team keeps its shape through its changes. */
export function currentXI(team: Team, events: MatchEvent[]): Slot[] {
  const starters = team.players.filter((p) => p.starter);
  const spots = formationSpots(starters);
  const slots: Slot[] = starters.map((p) => ({ player: p, spot: spots.get(p.player_id) ?? BASE.CM }));
  for (const e of events) {
    if (e.type !== "substitution" || e.team_id !== team.team_id || !e.sub_in || !e.sub_out) continue;
    const i = slots.findIndex((s) => s.player.player_id === e.sub_out);
    const incoming = team.players.find((p) => p.player_id === e.sub_in);
    if (i >= 0 && incoming) slots[i] = { player: incoming, spot: slots[i].spot, on: e.minute, replaced: slots[i].player };
  }
  return slots;
}

/** Make sure a player seen in an event is on the pitch: swap him in for a team-mate in the same role (or the last
 *  outfield player), keeping that team-mate's spot. */
export function withPlayer(slots: Slot[], squad: Player[], playerId: string | undefined): Slot[] {
  if (!playerId || slots.some((s) => s.player.player_id === playerId)) return slots;
  const incoming = squad.find((p) => p.player_id === playerId);
  if (!incoming) return slots;
  const same = slots.findIndex((s) => s.player.position === incoming.position && s.player.position !== "GK");
  const i = same >= 0 ? same : slots.findLastIndex((s) => s.player.position !== "GK");
  return slots.map((s, j) => (j === i ? { ...s, player: incoming } : s));
}
