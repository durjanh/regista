import type {
  Analysis, AskResponse, AuditEntry, BroadcasterProfile, Calibration, ChatTurn, Counterfactual, ForgeConfig, Health,
  Insight, MatchEvent, MatchMeta, MatchSummary, Dugout, H2H, MomentDetail, Narrative, Ops, Physical, PlayerDNA, PlayerStat,
  Recap, ReferenceSummary, ReferenceTeam, ScoutingPlayer, StudioItem, StudioSettings, Team, TeamDNA, TeamReport, TruthReport,
  TruthScore,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? body);
    } catch {
      /* body was not JSON */
    }
    throw new ApiError(res.status, detail || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

export const api = {
  health: () => request<Health>("/health"),
  matches: () => request<MatchSummary[]>("/matches"),
  match: (id: string) => request<MatchMeta>(`/matches/${encodeURIComponent(id)}`),
  events: (id: string, p: { from_t?: number; to_t?: number; types?: string[] } = {}) =>
    request<MatchEvent[]>(`/matches/${encodeURIComponent(id)}/events${qs({ from_t: p.from_t, to_t: p.to_t, types: p.types?.join(",") })}`),
  analysis: (id: string, upto_t?: number) =>
    request<Analysis>(`/matches/${encodeURIComponent(id)}/analysis${qs({ upto_t })}`),
  moment: (id: string, momentId: string) =>
    request<MomentDetail>(`/matches/${encodeURIComponent(id)}/moments/${encodeURIComponent(momentId)}`),
  players: (id: string, upto_t?: number) =>
    request<PlayerStat[]>(`/matches/${encodeURIComponent(id)}/players${qs({ upto_t })}`),
  narrate: (body: { match_id: string; scope: Narrative["scope"]; moment_id?: string; persona: string; language: string; upto_t?: number }) =>
    post<Narrative>("/narrate", body),
  recap: (body: { match_id: string; persona: string; language: string }) => post<Recap>("/recap", body),
  ask: (body: { match_id: string; question: string; persona: string; language: string; upto_t?: number; history?: ChatTurn[] }) =>
    post<AskResponse>("/ask", body),
  translate: (texts: string[], to: string) => post<{ texts: string[]; engine: string }>("/translate", { texts, to }),
  studioQueue: (id: string, upto_t?: number) =>
    request<StudioItem[]>(`/studio/${encodeURIComponent(id)}/queue${qs({ upto_t })}`),
  /** Producer-authored graphic (e.g. the half-time pack). Idempotent on `key`: the item id is `si-pr-{key}`. */
  studioAdd: (id: string, body: StudioNewItem) => post<StudioItem>(`/studio/${encodeURIComponent(id)}/items`, body),
  studioAction: (id: string, itemId: string, body: { action: StudioAction; title?: string; body?: string }) =>
    post<StudioItem>(`/studio/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, body),
  studioProfiles: () => request<BroadcasterProfile[]>("/studio/profiles"),
  studioSettings: (id: string) => request<StudioSettings>(`/studio/${encodeURIComponent(id)}/settings`),
  saveStudioSettings: (id: string, body: Partial<StudioSettings>) => post<StudioSettings>(`/studio/${encodeURIComponent(id)}/settings`, body),
  studioAudit: (id: string) => request<AuditEntry[]>(`/studio/${encodeURIComponent(id)}/audit`),
  forgeTeams: () => request<Team[]>("/forge/teams"),
  forgeScenario: (prompt: string) =>
    post<{ config: ForgeConfig; explanation: string; engine: string }>("/forge/scenario", { prompt }),
  forgeGenerate: (config: ForgeConfig) =>
    post<{ match: MatchSummary; calibration: Calibration }>("/forge/generate", config),
  calibration: (n?: number) => request<Calibration>(`/forge/calibration${qs({ n })}`),
  referenceSummary: () => request<ReferenceSummary>("/reference/summary"),
  referenceTeams: () => request<ReferenceTeam[]>("/reference/teams"),
  referenceTeam: (teamId: string) => request<TeamDNA>(`/reference/teams/${encodeURIComponent(teamId)}`),
  h2h: (a: string, b: string) => request<H2H>(`/reference/h2h${qs({ a, b })}`),
  // Manager and scouting
  scoutingPlayers: (p: { team_id?: string; q?: string } = {}) => request<ScoutingPlayer[]>(`/scouting/players${qs(p)}`),
  playerDNA: (key: string) => request<PlayerDNA>(`/scouting/players/${encodeURIComponent(key)}`),
  teamReport: (teamId: string) => request<TeamReport>(`/scouting/teams/${encodeURIComponent(teamId)}`),
  dugout: (id: string, side: "home" | "away", upto_t?: number) =>
    request<Dugout>(`/matches/${encodeURIComponent(id)}/dugout${qs({ side, upto_t: upto_t !== undefined ? Math.floor(upto_t) : undefined })}`),
  dugoutBrief: (body: { match_id: string; side: "home" | "away"; upto_t?: number; language: string }) => post<Narrative>("/dugout/brief", body),
  physical: (id: string, upto_t?: number) => request<Physical>(`/matches/${encodeURIComponent(id)}/physical${qs({ upto_t })}`),
  // Truth loop
  insights: (id: string, upto_t?: number) =>
    request<Insight[]>(`/matches/${encodeURIComponent(id)}/insights${qs({ upto_t: upto_t !== undefined ? Math.floor(upto_t) : undefined })}`),
  truth: (id: string, upto_t?: number) =>
    request<TruthReport>(`/matches/${encodeURIComponent(id)}/truth${qs({ upto_t: upto_t !== undefined ? Math.floor(upto_t) : undefined })}`),
  counterfactual: (id: string, plant_id: string, runs?: number) =>
    post<Counterfactual>(`/matches/${encodeURIComponent(id)}/counterfactual`, { plant_id, ...(runs ? { runs } : {}) }),
  narrateInsight: (id: string, insightId: string, body: { persona: string; language: string; drill?: boolean }) =>
    post<Narrative>(`/matches/${encodeURIComponent(id)}/insights/${encodeURIComponent(insightId)}/narrate`, body),
  truthScore: () => request<TruthScore>("/truth/score"),
  ops: () => request<Ops>("/ops"),
};

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

export const liveUrl = (id: string, p: { speed: number; start_t: number; persona: string; language: string; drill?: boolean }) =>
  `${BASE}/matches/${encodeURIComponent(id)}/live${qs({ ...p, drill: p.drill ? "true" : undefined })}`;

export const overlayUrl = (id: string) => `${BASE}/studio/${encodeURIComponent(id)}/overlay`;

/** Returns an audio Blob, or null when Speech isn't configured (HTTP 501). */
export async function synthesize(text: string, language: string, persona?: string): Promise<Blob | null> {
  const res = await fetch(`${BASE}/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language, persona }),
  });
  if (res.status === 501) return null;
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return await res.blob();
}
