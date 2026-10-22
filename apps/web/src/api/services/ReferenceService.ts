import type { HttpClient } from "../http/HttpClient";
import { qs, seg } from "../http/query";
import type { H2H, ReferenceSummary, ReferenceTeam, TeamDNA } from "../types";

/** The real CC0 international results: summary, teams, a team's DNA, head-to-head. */
export class ReferenceService {
  constructor(private readonly http: HttpClient) {}

  summary() {
    return this.http.get<ReferenceSummary>("/reference/summary");
  }

  teams() {
    return this.http.get<ReferenceTeam[]>("/reference/teams");
  }

  team(teamId: string) {
    return this.http.get<TeamDNA>(`/reference/teams/${seg(teamId)}`);
  }

  headToHead(a: string, b: string) {
    return this.http.get<H2H>(`/reference/h2h${qs({ a, b })}`);
  }
}
