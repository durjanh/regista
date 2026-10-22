import type { HttpClient } from "../http/HttpClient";
import { qs, seg, wholeSeconds } from "../http/query";
import type { Counterfactual, Insight, Narrative, TruthReport, TruthScore } from "../types";

/** The truth loop: detector insights, the graded truth report, counterfactual re-runs and the CI truth score. */
export class TruthService {
  constructor(private readonly http: HttpClient) {}

  insights(matchId: string, uptoT?: number) {
    return this.http.get<Insight[]>(`/matches/${seg(matchId)}/insights${qs({ upto_t: wholeSeconds(uptoT) })}`);
  }

  report(matchId: string, uptoT?: number) {
    return this.http.get<TruthReport>(`/matches/${seg(matchId)}/truth${qs({ upto_t: wholeSeconds(uptoT) })}`);
  }

  counterfactual(matchId: string, plantId: string, runs?: number) {
    return this.http.post<Counterfactual>(`/matches/${seg(matchId)}/counterfactual`, { plant_id: plantId, ...(runs ? { runs } : {}) });
  }

  narrateInsight(matchId: string, insightId: string, body: { persona: string; language: string; drill?: boolean }) {
    return this.http.post<Narrative>(`/matches/${seg(matchId)}/insights/${seg(insightId)}/narrate`, body);
  }

  score() {
    return this.http.get<TruthScore>("/truth/score");
  }
}
