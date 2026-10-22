import type { HttpClient } from "../http/HttpClient";
import { qs } from "../http/query";
import type { Calibration, ForgeConfig, MatchSummary, Team } from "../types";

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

  calibration(n?: number) {
    return this.http.get<Calibration>(`/forge/calibration${qs({ n })}`);
  }
}
