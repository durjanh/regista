// Small, realistic fixtures shaped exactly like the API contract (docs/API_CONTRACT.md).
import type {
  Analysis, Insight, LiveMoment, LiveSnapshot, MatchEvent, MatchMeta, Narrative, Player, Plant, StudioItem, Team, TeamStats,
  TruthReport, Verification,
} from "../api/types";
import type { LiveState } from "../hooks/useLiveMatch";

const player = (team_id: string, shirt: number, name: string, position: Player["position"], starter = true): Player => ({
  player_id: `${team_id}-${String(shirt).padStart(2, "0")}`, team_id, name, shirt, position, starter,
  name_source: "dataset", player_key: `${team_id}:${name.toLowerCase().replace(/\s+/g, "-")}`,
});

const team = (team_id: string, name: string, short: string, primary: string, players: Player[]): Team => ({
  team_id, name, short, colors: { primary, secondary: "#ffffff", text: "#000000" }, city: name, manager: "Manager",
  formation: "4-3-3", style: { label: "balanced", possession: 0.5, directness: 0.5, press: 0.5, width: 0.5 }, players,
});

export const HERO = "2026-07-15-england-argentina";

export const match: MatchMeta = {
  match_id: HERO, competition: "World tournament", season: "2026", matchweek: 1, venue: "Atlanta", kickoff: "2026-07-15T19:00:00Z",
  referee: "Ref", final_score: { home: 1, away: 2 }, duration_s: 5700, period_starts: [0, 2880], scenario_tags: [], seed: 1,
  home: team("england", "England", "ENG", "#ffffff", [
    player("england", 9, "Harry Kane", "ST"),
    player("england", 3, "Myles Lewis-Skelly", "LB"),
    player("england", 7, "Bukayo Saka", "RW"),
    player("england", 20, "Bench Player", "CM", false),
  ]),
  away: team("argentina", "Argentina", "ARG", "#75aadb", [
    player("argentina", 10, "Lionel Messi", "RW"),
    player("argentina", 3, "Nicolás Tagliafico", "LB"),
    player("argentina", 4, "Gonzalo Montiel", "RB"),
  ]),
  source: { kind: "real_result", disclosure: "Real result · Synthetic match events", dataset: { name: "intl", source: "github.com/martj42/international_results", licence: "CC0-1.0" } },
  elo: { home: 2172, away: 2256 },
  h2h: { played: 0, home_wins: 0, draws: 0, away_wins: 0, home_goals: 0, away_goals: 0, last: [] },
};

export const stats = (over: Partial<TeamStats> = {}): TeamStats => ({
  team_id: "england", goals: 1, xg: 0.85, shots: 6, shots_on_target: 3, big_chances: 1, passes: 250, pass_completion: 0.84,
  possession: 0.48, progressive_passes: 20, final_third_entries: 18, xt: 0.6, corners: 3, fouls: 5, yellow: 1, red: 0, offsides: 1,
  tackles: 9, interceptions: 7, ppda: 10.4, field_tilt: 0.46, ...over,
});

export const snapshot = (minute: number, over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  t: minute * 60, minute, score: { home: 1, away: 0 }, momentum: 0.2, win_prob: { home: 0.55, draw: 0.25, away: 0.2 },
  stats: { home: stats(), away: stats({ team_id: "argentina", xg: 0.4, shots: 4, possession: 0.52 }) }, control_chaos: 0.3, ...over,
});

let seq = 0;
export const event = (over: Partial<MatchEvent> = {}): MatchEvent => {
  seq += 1;
  return {
    id: `ev-${seq}`, seq, period: 1, t: seq, minute: 1, second: 0, type: "pass", team_id: "england", player_id: "england-09",
    player_name: "Harry Kane", x: 50, y: 30, possession_id: 1, outcome: "success", score: { home: 0, away: 0 }, ...over,
  };
};

export const moment = (over: Partial<LiveMoment> = {}): LiveMoment => ({
  id: "m-goal-55", match_id: HERO, t: 3300, minute: 55, type: "goal", team_id: "england", title: "GOAL: Gordon 55'",
  summary: "Gordon finishes a quick break.", importance: 90, confidence: 0.9, event_ids: [], evidence: [],
  explanation: { why_it_matters: "Opens the scoring", factors: [] }, ...over,
});

export const insight = (over: Partial<Insight> = {}): Insight => ({
  id: "in-press_switch-argentina-team-66", match_id: HERO, team_id: "argentina", mechanism: "press_switch", direction: "higher",
  start_minute: 64, detected_minute: 67, detected_t: 4200, confidence: 0.83, title: "Argentina pressing higher from 64'",
  text: "Argentina are pressing higher: pressing actions went from 0.27 to 0.82 per opponent build-up pass from 64'.",
  feature: {
    name: "press", label: "Pressing actions per opponent build-up pass", unit: "ratio", change_minute: 64, before: 0.27, after: 0.82,
    query: "match_events | where type == 'pressure'",
    series: Array.from({ length: 70 }, (_, i) => ({ minute: i + 1, value: i + 1 >= 64 ? 0.8 : i === 0 ? 3 : 0.25 })),
  },
  evidence: [{ fact_id: "in-1:before", label: "Before 64'", value: 0.27 }, { fact_id: "in-1:after", label: "After 64'", value: 0.82 }],
  ...over,
});

export const narrative = (over: Partial<Narrative> = {}): Narrative => ({
  id: "nar-1", match_id: HERO, scope: "moment", persona: "analyst", language: "en",
  text: "Argentina are pressing higher: pressing actions went from 0.27 to 0.82 per opponent build-up pass from 64' [f1].",
  citations: [{ fact_id: "f1", label: "After 64'", value: 0.82 }],
  fact_check: { passed: true, checked_claims: 3, issues: [], bias_flags: [] }, engine: "offline", latency_ms: 12,
  agent_trace: [{ agent: "Verifier", action: "re-checked 3 claims", ms: 1 }], ...over,
});

export const drillCaught: Verification = {
  drill: true,
  draft: "Argentina are pressing higher: pressing actions went from 0.27 to 1.76 per opponent build-up pass from 64' [f1].",
  issues: [{ sentence: "…", problem: "Number 1.76 is not in the fact sheet" }],
  caught: true,
  planted: { original: "0.82", planted: "1.76" },
};

export const plant = (over: Partial<Plant> = {}): Plant => ({
  id: "eng-arg-press", mechanism: "press_switch", team_id: "argentina", minute: 63, t: 3914.4, direction: "higher",
  difficulty: "obvious", description: "Argentina switch from a mid-block to a high press", ...over,
});

export const truthReport = (over: Partial<TruthReport> = {}): TruthReport => ({
  match_id: HERO, upto_t: 4300, plants: [plant(), plant({ id: "eng-arg-fb", mechanism: "tiring_fullback", team_id: "england", minute: 69, t: 4290, description: "England's left-back tires" })],
  insights: [insight()],
  grades: [
    { plant_id: "eng-arg-press", mechanism: "press_switch", team_id: "argentina", difficulty: "obvious", detected: true, insight_id: insight().id, seconds_to_detect: 286, explanation_correct: true },
    { plant_id: "eng-arg-fb", mechanism: "tiring_fullback", team_id: "england", difficulty: "obvious", detected: false },
  ],
  false_alarms: [],
  score: { recall: 1, false_alarms: 0, median_seconds_to_detect: 286, explanation_accuracy: 1 },
  ...over,
});

export const analysis = (over: Partial<Analysis> = {}): Analysis => {
  const tactics = (team_id: string, channels: { left: number; center: number; right: number }) => ({
    team_id, formation: { detected: "4-3-3", confidence: 0.8 }, shifts: [], ppda: [], channels,
    pass_network: { team_id, nodes: [], edges: [] }, avg_line_height: 40,
  });
  return {
    match_id: HERO, t: 2881, minute: 45, score: { home: 1, away: 0 },
    stats: { home: stats(), away: stats({ team_id: "argentina", xg: 0.4, shots: 4, shots_on_target: 1, possession: 0.52, field_tilt: 0.54, ppda: 12.1 }) },
    momentum: [], win_prob: [], xg_timeline: [], shots: [],
    moments: [moment({ id: "m-1", t: 1500, minute: 25, importance: 80, title: "Big chance for Kane", type: "big_chance" })],
    tactics: { home: tactics("england", { left: 10, center: 5, right: 4 }), away: tactics("argentina", { left: 2, center: 6, right: 3 }) },
    top_players: [], ...over,
  };
};

export const studioItem = (over: Partial<StudioItem> = {}): StudioItem => ({
  id: "si-pr-ht-xg", match_id: HERO, kind: "stat_card", priority: 70, title: "Half time", body: "xG", data: {}, status: "proposed",
  t: 2879, minute: 45, created_at: "2026-10-21T10:00:00Z", duration_s: 12,
  cue: { version: "1.0", timecode: "00:47:59", duration_s: 12, priority: 70, template: "halftime_xg", data: {}, strings: { en: { title: "Half time", body: "xG" } } },
  editorial: { passed: true, issues: [] }, source: "producer", ...over,
});

export const liveState = (over: Partial<LiveState> = {}): LiveState => ({
  status: "paused", meta: null, t: 4300, minute: 72, score: { home: 1, away: 0 }, events: [], snapshots: [], latest: null,
  moments: [], studio: [], insights: [], ...over,
});
