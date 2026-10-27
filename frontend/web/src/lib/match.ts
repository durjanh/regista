import type { MatchEvent, MatchMeta, Score } from "../api/types";
import { distinctAway } from "./format";

export type Goal = { minute: number; side: "home" | "away"; label: string; event_id: string };

/**
 * Goals derived from score changes, so own goals and penalties are handled uniformly. Only a shot scores (own goals are
 * shots too): a stream joined after a goal starts at 1-0 on a pass, which must not be credited to that passer.
 */
export function goalsFromEvents(events: MatchEvent[]): Goal[] {
  const goals: Goal[] = [];
  let prev: Score = { home: 0, away: 0 };
  for (const e of events) {
    if (!e.score) continue;
    if (e.type !== "shot") {
      prev = e.score;
      continue;
    }
    if (e.score.home > prev.home) goals.push({ minute: e.minute + (e.added_minute ?? 0) / 10, side: "home", label: `${e.minute}' ${e.player_name ?? ""}`, event_id: e.id });
    if (e.score.away > prev.away) goals.push({ minute: e.minute + (e.added_minute ?? 0) / 10, side: "away", label: `${e.minute}' ${e.player_name ?? ""}`, event_id: e.id });
    prev = e.score;
  }
  return goals;
}

export function playerMaps(match: MatchMeta) {
  const shirts = new Map<string, number>();
  const names = new Map<string, string>();
  const placeholders = new Set<string>();
  for (const p of [...match.home.players, ...match.away.players]) {
    shirts.set(p.player_id, p.shirt);
    names.set(p.player_id, p.name_source === "placeholder" ? `${p.name} (no name in dataset)` : p.name);
    if (p.name_source === "placeholder") placeholders.add(p.player_id);
  }
  return { shirts, names, placeholders };
}

export function teamColors(match: Pick<MatchMeta, "home" | "away">) {
  return { home: match.home.colors.primary, away: distinctAway(match.home, match.away) };
}

/** Events of the current possession chain (most recent N). */
export function currentChain(events: MatchEvent[], max = 12): MatchEvent[] {
  if (!events.length) return [];
  const last = events[events.length - 1];
  const chain: MatchEvent[] = [];
  for (let i = events.length - 1; i >= 0 && chain.length < max; i--) {
    const e = events[i];
    if (e.possession_id !== last.possession_id) break;
    chain.unshift(e);
  }
  return chain;
}
