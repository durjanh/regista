import type { HttpClient } from "../http/HttpClient";
import { qs, seg } from "../http/query";
import type { BroadcastStatus, RealtimeNegotiate } from "../types";

export type BroadcastStart = { speed?: number; start_t?: number; languages?: string[] };

/** The shared live broadcast on Azure Web PubSub: client access, and the producer's start / stop / status. */
export class BroadcastService {
  constructor(private readonly http: HttpClient) {}

  /** A Web PubSub client URL for one match, or `enabled: false` (the app falls back to its own replay).
   *  `monitor`: the producer's Studio, which watches the broadcast without counting as a viewer. */
  negotiate(matchId: string, language: string, monitor = false) {
    return this.http.get<RealtimeNegotiate>(`/realtime/negotiate${qs({ match_id: matchId, language, monitor: monitor ? "true" : undefined })}`);
  }

  start(matchId: string, body: BroadcastStart = {}) {
    return this.http.post<BroadcastStatus>(`/broadcast/${seg(matchId)}/start`, body);
  }

  stop(matchId: string) {
    return this.http.post<BroadcastStatus>(`/broadcast/${seg(matchId)}/stop`, {});
  }

  status() {
    return this.http.get<BroadcastStatus[]>("/broadcast/status");
  }
}
