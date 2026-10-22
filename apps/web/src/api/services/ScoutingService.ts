import type { HttpClient } from "../http/HttpClient";
import { qs, seg } from "../http/query";
import type { PlayerDNA, ScoutingPlayer, TeamReport } from "../types";

export type PlayerSearch = { team_id?: string; q?: string };

/** Scouting: the player search, a player's DNA and a team's scouting report. */
export class ScoutingService {
  constructor(private readonly http: HttpClient) {}

  players(search: PlayerSearch = {}) {
    return this.http.get<ScoutingPlayer[]>(`/scouting/players${qs(search)}`);
  }

  playerDNA(key: string) {
    return this.http.get<PlayerDNA>(`/scouting/players/${seg(key)}`);
  }

  teamReport(teamId: string) {
    return this.http.get<TeamReport>(`/scouting/teams/${seg(teamId)}`);
  }
}
