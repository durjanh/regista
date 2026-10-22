import type { HttpClient } from "../http/HttpClient";
import type { AskResponse, ChatTurn, Narrative, Recap } from "../types";

export type NarrateRequest = {
  match_id: string;
  scope: Narrative["scope"];
  moment_id?: string;
  persona: string;
  language: string;
  upto_t?: number;
};
export type RecapRequest = { match_id: string; persona: string; language: string };
export type AskRequest = { match_id: string; question: string; persona: string; language: string; upto_t?: number; history?: ChatTurn[] };

/** The agents' words: moment and half-time narration, the full-time recap, and answers to fans' questions. */
export class NarrationService {
  constructor(private readonly http: HttpClient) {}

  narrate(body: NarrateRequest) {
    return this.http.post<Narrative>("/narrate", body);
  }

  recap(body: RecapRequest) {
    return this.http.post<Recap>("/recap", body);
  }

  ask(body: AskRequest) {
    return this.http.post<AskResponse>("/ask", body);
  }
}
