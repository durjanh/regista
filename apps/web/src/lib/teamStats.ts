/**
 * Team statistics from events, mirroring the API's analytics/stats.py `team_stats`. The broadcast tick carries the
 * events but not the per-team stats, and asking the API per viewer would defeat the fan-out, so every viewer derives
 * them locally from the shared timeline.
 */
import type { MatchEvent, TeamStats } from "../api/types";

const DEFENSIVE = new Set(["tackle", "interception", "foul"]);
const GOAL_X = 105;
const GOAL_Y = 34;

const toGoal = (x: number, y: number) => Math.hypot(GOAL_X - x, GOAL_Y - y);
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

function progressive(e: MatchEvent): boolean {
  if (e.type !== "pass" || e.outcome !== "success" || e.x < 35 || e.end_x === undefined || e.end_y === undefined) return false;
  const d0 = toGoal(e.x, e.y);
  const d1 = toGoal(e.end_x, e.end_y);
  return d0 - d1 >= 10 && d1 <= 0.75 * d0;
}

export function teamStats(events: MatchEvent[], teamId: string, oppId: string): TeamStats {
  const mine = events.filter((e) => e.team_id === teamId);
  const theirs = events.filter((e) => e.team_id === oppId);
  const passes = mine.filter((e) => e.type === "pass");
  const oppPasses = theirs.filter((e) => e.type === "pass");
  const shots = mine.filter((e) => e.type === "shot");
  const oppBuild = oppPasses.filter((e) => e.x < 63).length;
  const ourDef = mine.filter((e) => DEFENSIVE.has(e.type) && e.x > 42).length;
  const ftMine = passes.filter((e) => e.x >= 70).length;
  const ftTheirs = oppPasses.filter((e) => e.x >= 70).length;
  const totalPasses = passes.length + oppPasses.length;
  const count = (p: (e: MatchEvent) => boolean) => mine.filter(p).length;
  return {
    team_id: teamId,
    goals: shots.filter((e) => e.shot_outcome === "goal").length,
    xg: round(shots.reduce((s, e) => s + (e.xg ?? 0), 0), 2),
    shots: shots.length,
    shots_on_target: shots.filter((e) => e.shot_outcome === "goal" || e.shot_outcome === "saved").length,
    big_chances: shots.filter((e) => e.tags?.includes("big_chance") || (e.xg ?? 0) >= 0.3).length,
    passes: passes.length,
    pass_completion: passes.length ? round(passes.filter((e) => e.outcome === "success").length / passes.length, 3) : 0,
    possession: totalPasses ? round(passes.length / totalPasses, 3) : 0.5,
    progressive_passes: passes.filter(progressive).length,
    final_third_entries: count((e) => (e.type === "pass" || e.type === "carry") && e.outcome === "success" && e.x < 70 && 70 <= (e.end_x ?? 0)),
    xt: round(mine.reduce((s, e) => s + Math.max(0, e.xt_added ?? 0), 0), 2),
    corners: count((e) => e.type === "corner"),
    fouls: count((e) => e.type === "foul"),
    yellow: count((e) => e.card === "yellow"),
    red: count((e) => e.card === "red" || e.card === "second_yellow"),
    offsides: count((e) => e.type === "offside"),
    tackles: count((e) => e.type === "tackle"),
    interceptions: count((e) => e.type === "interception"),
    ppda: ourDef ? round(oppBuild / ourDef, 2) : 0,
    field_tilt: ftMine + ftTheirs ? round(ftMine / (ftMine + ftTheirs), 3) : 0.5,
  };
}
