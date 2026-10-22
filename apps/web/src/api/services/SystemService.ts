import type { HttpClient } from "../http/HttpClient";
import type { Health, Ops } from "../types";

/** The platform itself: health (which Azure services are connected) and the ops dashboard (SLOs, cost). */
export class SystemService {
  constructor(private readonly http: HttpClient) {}

  health() {
    return this.http.get<Health>("/health");
  }

  ops() {
    return this.http.get<Ops>("/ops");
  }
}
