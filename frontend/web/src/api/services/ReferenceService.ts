import type { HttpClient } from "../http/HttpClient";
import { qs, seg } from "../http/query";
import type { H2H, ReferenceSummary, ReferenceTeam, TeamDNA } from "../types";

/** The real CC0 international results: summary, teams, a team's DNA, head-to-head. */
export class ReferenceService {
  constructor(private readonly http: HttpClient) {}

  summary() {
    return this.http.get<ReferenceSummary>("/reference/summary");
  }

  /** Teams ranked by Elo; `limit` up to 400 covers every national team in the dataset. */
  teams(limit?: number) {
    return this.http.get<ReferenceTeam[]>(`/reference/teams${qs({ limit })}`);
  }

  team(teamId: string) {
    return this.http.get<TeamDNA>(`/reference/teams/${seg(teamId)}`);
  }

  headToHead(a: string, b: string) {
    return this.http.get<H2H>(`/reference/h2h${qs({ a, b })}`);
  }
}
