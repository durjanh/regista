import type { HttpClient } from "../http/HttpClient";
import { qs, seg } from "../http/query";
import type { AuditEntry, BroadcasterProfile, StudioItem, StudioSettings } from "../types";

export type StudioAction = "approve" | "reject" | "on_air" | "edit" | "kill";

export type StudioNewItem = {
  kind: StudioItem["kind"];
  title: string;
  body?: string;
  priority?: number;
  duration_s?: number;
  /** Match seconds the graphic belongs to (half-time pack: the end of the first half). */
  t?: number;
  template?: string;
  data?: Record<string, unknown>;
  /** ^[a-z0-9-]{1,40}$, unique per match. */
  key?: string;
};

/** The producer's control room: the graphics queue, editorial actions, broadcaster profiles and the audit log. */
export class StudioService {
  constructor(private readonly http: HttpClient) {}

  queue(matchId: string, uptoT?: number) {
    return this.http.get<StudioItem[]>(`/studio/${seg(matchId)}/queue${qs({ upto_t: uptoT })}`);
  }

  /** Producer-authored graphic (e.g. the half-time pack). Idempotent on `key`: the item id is `si-pr-{key}`. */
  addItem(matchId: string, item: StudioNewItem) {
    return this.http.post<StudioItem>(`/studio/${seg(matchId)}/items`, item);
  }

  act(matchId: string, itemId: string, body: { action: StudioAction; title?: string; body?: string }) {
    return this.http.post<StudioItem>(`/studio/${seg(matchId)}/items/${seg(itemId)}`, body);
  }

  profiles() {
    return this.http.get<BroadcasterProfile[]>("/studio/profiles");
  }

  settings(matchId: string) {
    return this.http.get<StudioSettings>(`/studio/${seg(matchId)}/settings`);
  }

  saveSettings(matchId: string, body: Partial<StudioSettings>) {
    return this.http.post<StudioSettings>(`/studio/${seg(matchId)}/settings`, body);
  }

  audit(matchId: string) {
    return this.http.get<AuditEntry[]>(`/studio/${seg(matchId)}/audit`);
  }

  /** Server-sent events URL of the on-air graphics for the OBS / vMix overlay. */
  overlayUrl(matchId: string) {
    return this.http.url(`/studio/${seg(matchId)}/overlay`);
  }
}
