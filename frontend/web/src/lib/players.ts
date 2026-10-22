import type { MatchMeta, Player } from "../api/types";

/** Mirrors the backend slug(): NFKD, drop non-ASCII, lower-case, non-alphanumerics to "-". */
export function slugName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const scoutingPath = (key: string) => `/scouting/player/${encodeURIComponent(key)}`;
export const teamReportPath = (teamId: string) => `/scouting/team/${encodeURIComponent(teamId)}`;

/** Match players indexed by id and by name, for linking names to scouting profiles. */
export function playerIndex(match: Pick<MatchMeta, "home" | "away">) {
  const byId = new Map<string, Player>();
  const byName = new Map<string, Player>();
  for (const p of [...match.home.players, ...match.away.players]) {
    byId.set(p.player_id, p);
    byName.set(p.name, p);
  }
  return { byId, byName };
}

export function keyFor(p: Pick<Player, "player_key"> | undefined): string | undefined {
  return p?.player_key || undefined;
}
