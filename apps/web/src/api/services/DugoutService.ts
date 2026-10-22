import type { HttpClient } from "../http/HttpClient";
import { qs, seg, wholeSeconds } from "../http/query";
import type { Dugout, Narrative } from "../types";

export type Side = "home" | "away";
export type DugoutBriefRequest = { match_id: string; side: Side; upto_t?: number; language: string };

/** The manager's view: one side's live dashboard and the assistant-coach agent's brief. */
export class DugoutService {
  constructor(private readonly http: HttpClient) {}

  dashboard(matchId: string, side: Side, uptoT?: number) {
    return this.http.get<Dugout>(`/matches/${seg(matchId)}/dugout${qs({ side, upto_t: wholeSeconds(uptoT) })}`);
  }

  brief(body: DugoutBriefRequest) {
    return this.http.post<Narrative>("/dugout/brief", body);
  }
}
