import type { HttpClient } from "../http/HttpClient";
import { qs, seg } from "../http/query";
import type { Analysis, MatchEvent, MatchMeta, MatchSummary, MomentDetail, Physical, PlayerStat } from "../types";

export type EventFilter = { from_t?: number; to_t?: number; types?: string[] };
export type LiveParams = { speed: number; start_t: number; persona: string; language: string; drill?: boolean; max_gap?: number };

/** Matches and what happened in them: events, analysis, moments, player and physical stats, the live replay. */
export class MatchService {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<MatchSummary[]>("/matches");
  }

  get(id: string) {
    return this.http.get<MatchMeta>(`/matches/${seg(id)}`);
  }

  events(id: string, filter: EventFilter = {}) {
    const query = qs({ from_t: filter.from_t, to_t: filter.to_t, types: filter.types?.join(",") });
    return this.http.get<MatchEvent[]>(`/matches/${seg(id)}/events${query}`);
  }

  analysis(id: string, uptoT?: number) {
    return this.http.get<Analysis>(`/matches/${seg(id)}/analysis${qs({ upto_t: uptoT })}`);
  }

  moment(id: string, momentId: string) {
    return this.http.get<MomentDetail>(`/matches/${seg(id)}/moments/${seg(momentId)}`);
  }

  players(id: string, uptoT?: number) {
    return this.http.get<PlayerStat[]>(`/matches/${seg(id)}/players${qs({ upto_t: uptoT })}`);
  }

  physical(id: string, uptoT?: number) {
    return this.http.get<Physical>(`/matches/${seg(id)}/physical${qs({ upto_t: uptoT })}`);
  }

  /** Server-sent events URL of a personal replay (EventSource; it can't go over axios). */
  liveUrl(id: string, p: LiveParams) {
    return this.http.url(`/matches/${seg(id)}/live${qs({ ...p, drill: p.drill ? "true" : undefined })}`);
  }
}
