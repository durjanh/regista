import type { HttpClient } from "../http/HttpClient";
import { qs } from "../http/query";
import type { Calibration, ForgeConfig, MatchSummary, RealResult, Team } from "../types";

/** Data Forge: synthetic matches directed in plain English, calibrated against real results. */
export class ForgeService {
  constructor(private readonly http: HttpClient) {}

  teams() {
    return this.http.get<Team[]>("/forge/teams");
  }

  scenario(prompt: string) {
    return this.http.post<{ config: ForgeConfig; explanation: string; engine: string }>("/forge/scenario", { prompt });
  }

  generate(config: ForgeConfig) {
    return this.http.post<{ match: MatchSummary; calibration: Calibration }>("/forge/generate", config);
  }

  /** A team's real results, newest first, each marked replayable or with the reason it isn't. */
  realResults(team: string, opponent?: string, year?: number) {
    return this.http.get<RealResult[]>(`/forge/real${qs({ team, opponent, year })}`);
  }

  /** Rebuild a real result for replay (real score, scorers and minutes; synthetic play between them). */
  replay(matchId: string) {
    return this.http.post<MatchSummary>("/forge/real", { match_id: matchId });
  }

  calibration(n?: number) {
    return this.http.get<Calibration>(`/forge/calibration${qs({ n })}`);
  }
}
