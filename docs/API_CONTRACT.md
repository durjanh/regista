# Regista API contract

Source of truth for the frontend (`frontend/web`), the backend (`backend/api`), the Azure Function (`backend/functions`) and the infrastructure (`infra/`). If code and this document disagree, fix the code.

**Data model in one sentence:** matches are REAL international results (teams, date, tournament, venue, score, scorers, goal minutes, penalties, own goals, assists from the CC0 dataset `martj42/international_results`, 49,945 results 1872–2026) rebuilt as SYNTHETIC ball-by-ball event data constrained to reproduce the real goals exactly, plus synthetic "what-if" matches between real national teams. Team ids are slugs (`england`, `saudi-arabia`).

Base URL: relative `/api` (Vite proxies to `http://localhost:8000` in dev; nginx proxies to the API container in Azure). MCP server: `/mcp` (streamable HTTP).

## Conventions

- JSON, `snake_case` keys.
- Pitch is **105 × 68 metres**. Every event's coordinates are in the **acting team's attacking frame**: `x = 0` own goal line, `x = 105` opponent goal line, `y = 0` the acting team's right touchline. To draw both teams on one pitch with the home team attacking left→right, mirror away-team coordinates: `x' = 105 - x`, `y' = 68 - y`. Freeze-frame positions use the same frame as the event they belong to.
- `t` is match-clock seconds from kick-off of the first half, continuous across halves (second half starts at `t = 2700` plus first-half added time). `minute` is the broadcast minute (e.g. `45` during first-half stoppage, displayed as `45+2` using `added_minute`).
- `persona`: `casual` | `analyst` | `kids` | `fantasy` | `broadcaster` | `social` | `accessible`.
- `language`: BCP-47 code. Supported: `en, es, fr, de, pt, ar, hi, ja, zh-Hans, sw, it, nl`.
- Every AI-generated text object carries `engine` (`azure` or `offline`) and a `fact_check` block. Nothing generated is shown without one.

## Core types

```ts
type TeamRef = { team_id: string; name: string; short: string; colors: { primary: string; secondary: string; text: string } };

type Player = {
  player_id: string; team_id: string; name: string; shirt: number;
  position: "GK"|"RB"|"CB"|"LB"|"RWB"|"LWB"|"DM"|"CM"|"AM"|"RW"|"LW"|"ST";
  starter: boolean;
  name_source: "dataset" | "placeholder";   // dataset = recorded scorer/assister for that country; placeholder = "England No. 5" (never invented)
};

type Team = TeamRef & {
  city: string; manager: string; formation: string;          // starting shape, e.g. "4-3-3"
  style: { label: string; possession: number; directness: number; press: number; width: number }; // 0..1
  players: Player[];
};

type MatchMeta = {
  match_id: string;                 // "2026-07-15-england-argentina" or "whatif-england-brazil-7961"
  competition: string;              // real tournament, e.g. "FIFA World Cup"
  season: string; matchweek: number;
  venue: string;                    // "Atlanta, United States"
  kickoff: string;                  // date, YYYY-MM-DD
  referee: string;                  // "Not recorded" (not in the dataset)
  home: Team & { elo: number }; away: Team & { elo: number };
  final_score: { home: number; away: number };
  duration_s: number; scenario_tags: string[]; seed: number;
  headline_hint?: string;           // "Giant-killing", "The comeback", "Late drama", ...
  featured?: boolean;
  period_starts: [number, number];
  source: { kind: "real_result" | "what_if"; disclosure: string;
    real?: { date: string; tournament: string; city: string; country: string; neutral: boolean; home_score: number; away_score: number;
      goals: { minute: number; team_id: string; scorer: string; penalty: boolean; own_goal: boolean; assist?: string }[] };
    dataset: { name: string; source: string; licence: string } };
  elo: { home: number; away: number };          // pre-match Elo computed from every prior result since 1872
  h2h: { played: number; home_wins: number; draws: number; away_wins: number; home_goals: number; away_goals: number;
    last: { date: string; home_team: string; away_team: string; home_score: number; away_score: number; tournament: string }[] };
};

type MatchSummary = Omit<MatchMeta, "home"|"away"> & { home: TeamRef; away: TeamRef };

type FreezeFramePlayer = { player_id: string; team_id: string; x: number; y: number; actor?: boolean; gk?: boolean };

type Event = {
  id: string; seq: number; period: 1|2; t: number; minute: number; added_minute?: number; second: number;
  type: "kick_off"|"pass"|"carry"|"dribble"|"shot"|"tackle"|"interception"|"clearance"|"recovery"|"pressure"
      | "foul"|"card"|"substitution"|"offside"|"corner"|"free_kick"|"throw_in"|"goal_kick"|"save"|"half_end"|"full_time";
  team_id: string; player_id?: string; player_name?: string;
  x: number; y: number; end_x?: number; end_y?: number;
  outcome?: "success"|"fail";
  recipient_id?: string;
  possession_id: number;
  pass_type?: "short"|"long"|"cross"|"through_ball"|"cutback"|"switch";
  body_part?: "right_foot"|"left_foot"|"head";
  situation?: "open_play"|"counter"|"set_piece"|"penalty";
  shot_outcome?: "goal"|"saved"|"off_target"|"blocked"|"post";
  xg?: number;                         // shots only
  xt_added?: number;                   // successful passes/carries
  card?: "yellow"|"second_yellow"|"red";
  sub_in?: string; sub_out?: string;   // player_ids
  score: { home: number; away: number };   // after this event
  freeze_frame?: FreezeFramePlayer[];      // shots, goals and other key events
  tags?: string[];                          // e.g. ["big_chance","own_goal","penalty","penalty_conceded"]
  assist_event_id?: string;                 // goals: the pass that set it up
  own_goal_by?: string;                     // own goals: the real player recorded in the dataset
};

type Evidence = { fact_id: string; label: string; value: string | number; unit?: string; event_ids?: string[] };

type Moment = {
  id: string; match_id: string; t: number; minute: number; added_minute?: number;
  type: "goal"|"big_chance"|"save"|"penalty"|"red_card"|"yellow_card"|"substitution"
      | "momentum_swing"|"tactical_shift"|"turning_point"|"pressing_spell"|"wp_swing";
  team_id?: string; player_id?: string;
  title: string;                // e.g. "GOAL: Okafor 67'"
  summary: string;              // deterministic one-liner, always grounded
  importance: number;           // 0..100
  confidence: number;           // 0..1
  event_ids: string[];
  evidence: Evidence[];
  explanation: { why_it_matters: string; factors: { name: string; impact: "positive"|"negative"|"neutral"; detail: string }[] };
  wp_before?: WinProb; wp_after?: WinProb; xg?: number;
};

type WinProb = { home: number; draw: number; away: number };   // sums to 1

type TeamStats = {
  team_id: string; goals: number; xg: number; shots: number; shots_on_target: number; big_chances: number;
  passes: number; pass_completion: number; possession: number;  // 0..1
  progressive_passes: number; final_third_entries: number; xt: number;
  corners: number; fouls: number; yellow: number; red: number; offsides: number;
  tackles: number; interceptions: number; ppda: number; field_tilt: number; // field_tilt 0..1
};

type Shot = { event_id: string; t: number; minute: number; team_id: string; player_id: string; player_name: string;
  x: number; y: number; xg: number; outcome: Event["shot_outcome"]; body_part: Event["body_part"]; situation: Event["situation"] };

type XgBreakdown = { event_id: string; xg: number; base: number;
  factors: { name: string; contribution: number; detail: string }[] };    // contributions are in logit space, shown as a waterfall

type PassNetwork = {
  team_id: string;
  nodes: { player_id: string; name: string; shirt: number; x: number; y: number; touches: number }[];  // team attacking frame
  edges: { source: string; target: string; count: number }[];
};

type Tactics = {
  team_id: string;
  formation: { detected: string; confidence: number };
  shifts: { minute: number; from: string; to: string; trigger_event_id?: string; explanation: string }[];
  ppda: { window: string; value: number }[];                     // 15-minute windows, "0-15", "15-30", ...
  channels: { left: number; center: number; right: number };     // share of final-third entries, sums to 1
  pass_network: PassNetwork;
  avg_line_height: number;                                       // metres from own goal, outfield average
};

type PlayerStat = { player_id: string; name: string; team_id: string; shirt: number; position: string;
  minutes: number; touches: number; passes: number; pass_completion: number; xt: number; xg: number; shots: number;
  goals: number; assists: number; key_passes: number; tackles: number; interceptions: number; rating: number };

type Analysis = {
  match_id: string; t: number; minute: number; score: { home: number; away: number };
  stats: { home: TeamStats; away: TeamStats };
  momentum: { minute: number; value: number }[];                 // -1 (away dominant) .. +1 (home dominant)
  win_prob: ({ minute: number; t: number } & WinProb)[];
  xg_timeline: { minute: number; home: number; away: number }[];  // cumulative
  shots: Shot[];
  moments: Moment[];
  tactics: { home: Tactics; away: Tactics };
  top_players: PlayerStat[];                                       // top 6 by rating
};

type FactCheck = { passed: boolean; checked_claims: number; issues: { sentence: string; problem: string }[];
  bias_flags: { phrase: string; suggestion: string }[] };

type Citation = { fact_id: string; label: string; value: string | number; event_ids?: string[] };

type Narrative = {
  id: string; match_id: string; scope: "moment"|"live_line"|"halftime"|"fulltime";
  moment_id?: string; persona: string; language: string;
  text: string;                     // may contain [f12]-style citation markers
  citations: Citation[]; fact_check: FactCheck;
  engine: "azure"|"offline"; latency_ms: number;
  agent_trace: AgentStep[];
};

type AgentStep = { agent: string; action: string; ms: number; detail?: string };

type StudioItem = {
  id: string; match_id: string; moment_id?: string;
  kind: "lower_third"|"stat_card"|"talking_point"|"replay_cue"|"score_bug_alert";
  priority: number;                 // 0..100
  title: string; body: string;
  data: Record<string, unknown>;    // template payload for the overlay renderer
  status: "proposed"|"approved"|"rejected"|"on_air";
  t: number; minute: number; created_at: string;
  duration_s: number;               // how long it stays on air
};
```

## Endpoints

| Method & path | Request | Response |
|---|---|---|
| `GET /api/reference/summary` | | `{ matches, first_date, last_date, teams, goals_recorded, shootouts, source, licence, name }` |
| `GET /api/reference/teams` | query `limit` | `{ team_id, name, elo, rank, played, colors }[]` ranked by current Elo |
| `GET /api/reference/teams/{team_id}` | | `{ team_id, name, colors, elo, rank, elo_history: {date, elo}[], record: {played, won, drawn, lost, gf, ga}, recent: {date, opponent, gf, ga, tournament, city}[], top_scorers: {name, goals}[] }` |
| `GET /api/reference/h2h` | query `a`, `b`, `before?` | h2h block (real results) |
| `GET /api/health` | | `{ status: "ok", mode: "azure"\|"offline", version: string, services: { llm: bool, agents: bool, speech: bool, translator: bool, safety: bool, cosmos: bool, eventhub: bool, onelake: bool } }` |
| `GET /api/matches` | | `MatchSummary[]` |
| `GET /api/matches/{id}` | | `MatchMeta` |
| `GET /api/matches/{id}/events` | query `from_t`, `to_t`, `types` (comma list) | `Event[]` |
| `GET /api/matches/{id}/analysis` | query `upto_t` (default full match) | `Analysis` |
| `GET /api/matches/{id}/moments/{moment_id}` | | `{ moment: Moment, sequence: Event[], freeze_frame: FreezeFramePlayer[] \| null, xg_breakdown: XgBreakdown \| null }` |
| `GET /api/matches/{id}/players` | query `upto_t` | `PlayerStat[]` |
| `GET /api/matches/{id}/live` | query `speed` (default 30), `start_t` (default 0), `persona`, `language`, `drill` (default false, see Verifier drill) | **SSE** stream, see below |
| `POST /api/narrate` | `{ match_id, scope, moment_id?, persona, language, upto_t? }` | `Narrative` |
| `POST /api/recap` | `{ match_id, persona, language }` | `Recap` (below) |
| `POST /api/ask` | `{ match_id, question, persona, language, upto_t?, history?: {role, content}[] }` | `{ answer: string, citations: Citation[], tool_calls: { tool: string, args: object, ms: number }[], engine, fact_check: FactCheck, agent_trace: AgentStep[] }` |
| `POST /api/speech` | `{ text, language, persona? }` | `audio/mpeg` bytes, or **HTTP 501** when Speech is not configured (frontend then falls back to `window.speechSynthesis`) |
| `POST /api/translate` | `{ texts: string[], to: string }` | `{ texts: string[], engine }` |
| `POST /api/video/read` | `{ frames: [{ t, image }] (1–10, JPEG/PNG/WebP data URLs), teams?: { a?, b?: { kit, name } } }` | `{ teams, frames: [{ t, view, possession, zone, scoreboard }], events: [{ t, type, team, description }], summary, model }` read by the reasoning deployment (gpt-5.5); times are snapped to the frames sent and unknown event types dropped. **HTTP 501** without Azure OpenAI, **502** if the model fails |
| `GET /api/studio/{match_id}/queue` | query `upto_t` | `StudioItem[]` |
| `POST /api/studio/{match_id}/items/{item_id}` | `{ action: "approve"\|"reject"\|"on_air"\|"edit", title?, body? }` | `StudioItem` |
| `GET /api/studio/{match_id}/overlay` | | **SSE**: `event: on_air` `data: StudioItem` whenever an item goes on air; `event: clear` `data: {id}` |
| `GET /api/forge/teams` | query `limit` | `Team[]`: real national teams (top N by Elo) with squads from recorded scorers |
| `POST /api/forge/scenario` | `{ prompt }` | `{ config: ForgeConfig, explanation: string, engine }` |
| `POST /api/forge/generate` | `ForgeConfig` | `{ match: MatchSummary, calibration: Calibration }` (the new match is immediately available under `/api/matches/{id}`) |
| `GET /api/forge/real` | query `team`, optional `opponent`, `year`, `limit` (default 40) | `RealResult[]`: the team's real results, newest first, each with `match_id`, `replayable` and the `reason` when it isn't (incomplete goal records, extra time) |
| `POST /api/forge/real` | `{ match_id }` | `MatchSummary` with `rebuilt: true`: the real result rebuilt for replay (real score, scorers and minutes; synthetic play between them), at once when already built. 404 unknown result, 422 not replayable. The newest 30 rebuilt matches stay in memory; a match page rebuilds an older one on demand |
| `GET /api/forge/calibration` | query `n` (default 60) | `Calibration`: backtest on `n` real fixtures + event benchmarks + Brier score |

```ts
type Recap = {
  match_id: string; persona: string; language: string;
  headline: string; standfirst: string;
  report_md: string;                                  // 350–500 words, markdown, with [fNN] markers
  social_posts: { platform: "x"|"instagram"|"tiktok"|"whatsapp"; text: string }[];
  audio_script: string;                               // ~60 seconds read aloud
  run_sheet: { tc_start: string; tc_end: string; minute: number; title: string; event_ids: string[]; priority: number }[];  // highlight edit list, tc as "HH:MM:SS" match clock
  player_of_match: { player_id: string; name: string; team_id: string; reason: string; metrics: Evidence[] };
  citations: Citation[]; fact_check: FactCheck; engine: "azure"|"offline"; latency_ms: number;
  agent_trace: AgentStep[];
};

type ForgeConfig = {
  home_team_id: string; away_team_id: string; seed?: number;
  as_of?: string;                    // YYYY-MM-DD: team strength (Elo) and squads as of that date
  scenario?: "balanced"|"late_drama"|"comeback"|"red_card"|"derby"|"tactical_chess"|"goal_fest"|"underdog";
  intensity?: number;                // 0..1, affects fouls, pressing and tempo
  home_formation?: string; away_formation?: string;
};

type Calibration = {
  n_matches: number;
  reference: { name: string; source: string; licence: string; matches: number };
  metrics: { metric: string; simulated: number; reference: number; low: number; high: number; unit?: string; status: "pass"|"warn"|"fail"; source: string }[];
  goal_minute_distribution: { bin: string; simulated: number; reference: number }[];
  scoreline_distribution: { score: string; simulated: number; reference: number }[];
};
```

## Live SSE stream (`/api/matches/{id}/live`)

Each message is `event: <name>\ndata: <json>\n\n`.

| event | data | when |
|---|---|---|
| `meta` | `{ match_id, speed, start_t, duration_s }` | first message |
| `event` | `Event` | every match event, paced by `speed` (30 = 30 match-seconds per wall-second) |
| `snapshot` | `{ t, minute, score, momentum: number, win_prob: WinProb, stats: { home: TeamStats, away: TeamStats } }` | every 60 match-seconds and after goals/cards |
| `moment` | `Moment & { narrative?: Narrative }` | when a moment is detected; narrative uses the requested persona/language |
| `studio` | `StudioItem` | when the producer agent proposes a graphic |
| `end` | `{ t }` | full time |

## Environment variables read by the API

| Variable | Purpose |
|---|---|
| `REGISTA_DATA_DIR` | folder with match JSON (default `data/matches`, generated on first start if empty) |
| `AZURE_CLIENT_ID` | client id of the user-assigned managed identity (used by `DefaultAzureCredential`) |
| `AZURE_OPENAI_ENDPOINT` | `https://<ai-account>.openai.azure.com`: enables the LLM path |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | fast model deployment name (default `chat`) |
| `AZURE_OPENAI_REASONING_DEPLOYMENT` | stronger model deployment name for recaps/agents (default `reasoning`, falls back to chat) |
| `FOUNDRY_PROJECT_ENDPOINT` | `https://<ai-account>.services.ai.azure.com/api/projects/<project>`: enables Agent Framework agents |
| `AZURE_AI_SERVICES_ENDPOINT` | `https://<ai-account>.cognitiveservices.azure.com/`: Translator (custom domain) and Content Safety |
| `AZURE_AI_SERVICES_REGION` | e.g. `uksouth`: Speech and Translator region |
| `AZURE_AI_SERVICES_RESOURCE_ID` | full ARM id of the AI Services account: Speech Entra token format |
| `COSMOS_ENDPOINT` / `COSMOS_DATABASE` | Cosmos DB (NoSQL) for narratives, studio items, fan profiles (default db `regista`) |
| `STORAGE_ACCOUNT_URL` | blob storage for generated datasets and audio |
| `EVENTHUB_FQDN` / `EVENTHUB_NAME` / `EVENTHUB_CONSUMER_GROUP` | Event Hubs for the live pipeline (`match-events`, consumer group `api`) |
| `LIVE_SOURCE` | `replay` (default, in-process) or `eventhub` |
| `ONELAKE_WORKSPACE` / `ONELAKE_LAKEHOUSE` | Fabric OneLake export target for Data Forge datasets |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | OpenTelemetry export |
| `CORS_ORIGINS` | comma list, default `*` in dev. Deployments set it to the Static Web App's URL (the SPA calls the API cross-origin) |
| `PUBLIC_BASE_URL` | the API's public URL, used by agents to reach the MCP server (default `http://localhost:8000`) |
| `BROADCAST_VIEWER_COUNT_INTERVAL_S` / `BROADCAST_VIEWER_COUNT_MAX` | how often the live viewer count is refreshed from Web PubSub (default 5 s) and where it caps and shows "N+" (default 10,000) |
| `REGISTA_VIDEO_SAFE` | `1` replaces trademarked competition names with generic labels in every response (recorded demos); default `0` |

Every Azure dependency is optional. With none set, the API runs in `offline` mode with deterministic, data-grounded narratives so the demo never breaks.

## MCP tools (`/mcp`)

`list_matches`, `get_match_state(match_id, minute?)`, `get_key_moments(match_id, minute?, min_importance?)`, `explain_moment(match_id, moment_id)`, `get_player_stats(match_id, player)`, `get_tactical_summary(match_id, team?)`, `get_xg_breakdown(match_id, event_id)`, `compare_periods(match_id, from_minute, to_minute)`, `get_head_to_head(team_a, team_b, before_date?)` (real), `get_team_history(team)` (real), `generate_what_if(home_team, away_team, scenario?)`.

## Manager and scouting (Dugout)

Two kinds of numbers appear here, and the UI must label them:
- **REAL**: from the CC0 results dataset (goals, penalties scored, assists, minutes, venues, home/away/neutral, opponents' Elo).
- **MODEL**: from Regista's synthetic events (shot sides, feet, penalty placement, keeper dives, distance, sprints, passing, pressing). Every player has a stable tendency profile that the engine plays out; scouting rediscovers it from events. In production the same analytics run on a licensed event/tracking feed.

`Player` gains `player_key?: string`: a stable id across matches, `"<team_id>:<name-slug>"` for dataset names (e.g. `england:harry-kane`) or `"<team_id>:no-<shirt>"` for placeholders (e.g. `england:no-1`, the England goalkeeper).

`PlayerStat` gains `distance_km?: number; sprints?: number; player_key?: string`.

Penalty `shot` events gain `placement: "left"|"center"|"right"` and `gk_dive: "left"|"center"|"right"`, both from the **taker's** point of view (same value = keeper guessed right).

`MatchMeta` gains `venue_info?: { city: string; altitude_m?: number; note?: string }` and `physical?` is NOT on meta (use `/physical`).

```ts
type Rec = { played: number; won: number; drawn: number; lost: number; gf: number; ga: number; win_pct: number };
type Percentile = { metric: string; label: string; value: number; percentile: number; peers: number; higher_is_better: boolean };
type Advice = { title: string; detail: string; evidence: string };

type PlayerDNA = {
  player_key: string; name: string; team_id: string; team_name: string; position: string; name_source: "dataset"|"placeholder";
  real: null | {
    international_goals: number; penalty_goals: number; assists_recorded: number; first_goal: string; last_goal: string;
    goals_by_period: { bin: string; goals: number }[];               // "1-15" ... "76-90+"
    venue_split: { home: number; away: number; neutral: number };     // goals
    vs_top30_elo: number;                                             // goals against teams ranked top-30 by Elo at the time
    recent_goals: { date: string; opponent: string; minute: number; penalty: boolean; tournament: string }[];
    source: string;
  };
  model: {
    matches: number; minutes: number;
    per90: { goals: number; xg: number; shots: number; xt: number; key_passes: number; passes: number; pass_completion: number;
             progressive_passes: number; tackles: number; interceptions: number; pressures: number; dribbles: number;
             distance_km: number; sprints: number };
    foot: { right: number; left: number; head: number };            // shares of shots
    shot_channels: { left: number; center: number; right: number }; // shares, from the player's attacking view (left = his team's left)
    shot_zones: { inside_box: number; outside_box: number };
    shot_map: { x: number; y: number; xg: number; outcome: string }[];   // attacking frame, up to 80
    goal_map: { x: number; y: number; xg: number }[];
    penalties: null | { real_scored: number; modelled_taken: number; placement: { left: number; center: number; right: number }; conversion: number };
    goalkeeping: null | { penalties_faced: number; dive: { left: number; center: number; right: number }; penalty_save_pct: number;
                          shots_faced: number; saves: number; save_pct: number; xg_faced: number; goals_conceded: number; goals_prevented: number;
                          long_distribution_pct: number };
    percentiles: Percentile[];                                        // vs players of the same position family
  };
  strengths: string[]; weaknesses: string[];
  how_to_stop: Advice[];
  disclosure: string;
};

type Leader = { player_key: string; name: string; value: number; unit: string };

type TeamReport = {
  team_id: string; name: string; colors: TeamRef["colors"]; elo: number; rank: number | null;
  real: { overall: Rec; home: Rec; away: Rec; neutral: Rec; since: string;            // competitive + friendlies since `since`
          last10: { date: string; opponent: string; gf: number; ga: number; venue: "home"|"away"|"neutral"; tournament: string }[];
          top_scorers_recent: { name: string; goals: number; penalties: number }[] };
  model: { matches: number;
           leaders: { most_distance: Leader[]; most_passes: Leader[]; top_rated: Leader[]; top_threat: Leader[]; most_pressures: Leader[]; most_sprints: Leader[] };
           attacking_channels: { left: number; center: number; right: number };
           penalty_takers: { player_key: string; name: string; real_scored: number; favourite_side: string; share: number }[];
           goalkeeper: null | { player_key: string; name: string; favourite_dive: string; share: number; save_pct: number } };
  danger_men: { player_key: string; name: string; why: string }[];
  how_to_play_against: Advice[];
  disclosure: string;
};

type DugoutPlayer = {
  player_id: string; player_key?: string; name: string; position: string; shirt: number; on_pitch: boolean; minutes: number;
  rating: number; baseline: number | null; form_delta: number | null;
  fatigue: { distance_km: number; first15_km: number; last15_km: number; drop_pct: number; sprints: number; level: "fresh"|"tiring"|"exhausted" };
  booked: boolean; status: "good"|"ok"|"watch"|"struggling"; reasons: string[];
};

type Dugout = {
  match_id: string; side: "home"|"away"; team_id: string; opponent_id: string; minute: number; t: number;
  score: { home: number; away: number }; win_prob: WinProb;
  venue: { city: string; altitude_m?: number; note?: string; record_in_country?: Rec & { country: string } };
  players: DugoutPlayer[];                       // our players who have appeared, on-pitch first
  bench: { player_id: string; player_key?: string; name: string; position: string; baseline: number | null; fit: string }[];
  subs_used: number;
  recommendations: { id: string; type: "substitution"|"tactical"|"warning"; priority: number; title: string; detail: string; evidence: Evidence[];
                     substitution?: { off: { player_id: string; name: string }; on: { player_id: string; name: string };
                                      impact: { wp_before: WinProb; wp_after: WinProb; xg_delta: number } } }[];
  danger_men: { player_id: string; name: string; why: string; xt: number; xg: number }[];
  opponent_patterns: { channels: { left: number; center: number; right: number }; ppda: number; field_tilt: number; note: string };
};
```

| Method & path | Request | Response |
|---|---|---|
| `GET /api/scouting/players` | query `team_id?`, `q?` | `{ player_key, name, team_id, team_name, position, matches, rating, name_source }[]` |
| `GET /api/scouting/players/{player_key}` | | `PlayerDNA` |
| `GET /api/scouting/teams/{team_id}` | | `TeamReport` |
| `GET /api/matches/{id}/dugout` | query `side` (`home`/`away`), `upto_t` | `Dugout` (poll every few seconds during live replay with the current `t`) |
| `POST /api/dugout/brief` | `{ match_id, side, upto_t?, language }` | `Narrative` (assistant-coach briefing; scope `"dugout"`) |
| `GET /api/matches/{id}/physical` | query `upto_t` | `{ players: { player_id, player_key?, name, team_id, position, minutes, distance_km, sprints, top_speed_kmh, by_15: number[] }[] }` |

MCP tools added: `get_player_dna(player)`, `get_team_report(team)`, `get_dugout_advice(match_id, side, minute?)`.

## Truth loop: planted changes, insights, grader, counterfactuals

The engine can **secretly plant** tactical changes at exact times (scenario scripts). The plant labels are hidden from every agent and every normal endpoint. Detectors find changes from the event stream alone (two-segment change-point fit on per-minute features, the same idea as KQL `series_fit_2lines`), the agents explain them, and a **Grader** scores the result: detected or missed, seconds to detect, explanation right, false alarms. Truth is revealed only by `/truth` ("truth mode").

```ts
type Mechanism = "press_switch" | "shape_change" | "tiring_fullback" | "hot_streak" | "set_piece_routine" | "chaos_spell";

type Plant = { id: string; mechanism: Mechanism; team_id: string; minute: number; t: number; direction: string;
  difficulty: "obvious" | "moderate" | "subtle"; player_id?: string; player_name?: string; description: string };

type FeaturePoint = { minute: number; value: number };
type Insight = {
  id: string; match_id: string; team_id: string; mechanism: Mechanism; direction: string;
  start_minute: number;                 // detected change point
  detected_minute: number; detected_t: number;   // first minute the detector was confident (no look-ahead)
  confidence: number; title: string; text: string;   // sentence written from the structured fields
  player_id?: string; player_name?: string;
  feature: { name: string; label: string; unit?: string; series: FeaturePoint[]; change_minute: number;
             before: number; after: number; query: string };   // `query` = the KQL a Verifier would re-run on Eventhouse
  evidence: Evidence[];
};

type Grade = { plant_id: string; mechanism: Mechanism; team_id: string; difficulty: string; detected: boolean;
  insight_id?: string; seconds_to_detect?: number; explanation_correct?: boolean };

type TruthReport = { match_id: string; upto_t: number; plants: Plant[]; insights: Insight[]; grades: Grade[];
  false_alarms: Insight[]; score: { recall: number | null; false_alarms: number; median_seconds_to_detect: number | null;
  explanation_accuracy: number | null } };

type Counterfactual = { plant: Plant; metric: { name: string; label: string; unit?: string }; runs: number;
  with_change: { median: number; p10: number; p90: number }; without_change: { median: number; p10: number; p90: number };
  effect: { median: number; p10: number; p90: number }; explanation: string };
```

| Method & path | Request | Response |
|---|---|---|
| `GET /api/matches/{id}/insights` | query `upto_t` | `Insight[]` (no truth) |
| `GET /api/matches/{id}/truth` | query `upto_t` | `TruthReport` (truth mode: reveals plants) |
| `POST /api/matches/{id}/insights/{insight_id}/narrate` | `{ persona?: string = "analyst", language?: string = "en", drill?: boolean = false }` | `Narrative` (scope `insight`, with `verification`) |
| `POST /api/matches/{id}/counterfactual` | `{ plant_id, runs?: number }` (default 16) | `Counterfactual` |
| `GET /api/truth/score` | | `{ latest: { date, matches, plants, recall, false_alarms_per_match, median_seconds_to_detect, by_difficulty: {difficulty, recall, plants}[], by_mechanism: {mechanism, recall, plants}[] } \| null, history: { date, recall, false_alarms_per_match, median_seconds_to_detect }[] }` |

Live SSE gains `event: insight` with `Insight & { narrative?: Narrative }` (same upsert-by-id rule as moments), and the query parameter `drill` (default false).

**Verifier drill.** Planted claim errors are the twin of planted tactical changes. With `drill=true`, the headline number in the Analyst's draft is overstated on purpose, and the Verifier must catch it before anything airs. In Azure mode the Analyst then rewrites the line; offline, the line is rewritten from the structured insight. A known-bad draft never airs: if the Verifier missed it, the clean draft is used and `caught` is false. Insight narratives carry the record:

```ts
type Verification = {
  drill: boolean;                                   // true = error planted on purpose
  draft: string;                                    // the Analyst's draft as the Verifier saw it
  issues: { sentence: string; problem: string }[];  // e.g. "Number 1.48 is not in the fact sheet"
  caught: boolean | null;                           // drill only: did the Verifier flag the planted number?
  planted: { original: string; planted: string } | null;
};
// Narrative (scope "insight") gains: verification: Verification | null   (null = draft passed first time, no drill)
```

The Verifier checks that every number appears in the evidence. It does not yet check attribution, so a real number attached to the wrong claim would pass. The eval gate `verifier_drill` plants one overstated number in every offline line and requires all of them to be caught.

`MatchSummary` gains `planted_changes: number` (count only, never the content) so the hub can badge "Truth mode available".

## Brief features: event detail and control vs chaos

Events gain optional fields: `pass_length` (m), `difficulty` (0..1, from the engine's success model), `ball_speed_kmh` (passes and shots), `shot_speed_kmh`, `speed_kmh` (carries and dribbles). `tags` may include `"sprint"` (speed ≥ 25 km/h) and `"high_difficulty"` (difficulty ≥ 0.6).

`Analysis` gains `control_chaos: { minute: number; value: number }[]` (0 = one side in control, 1 = chaos: possession flipping, low completion) and `pass_profile: { home: PassProfile; away: PassProfile }` with `PassProfile = { avg_length: number; long_share: number; avg_difficulty: number; completion_by_difficulty: { band: "easy"|"medium"|"hard"; attempts: number; completion: number }[] }`. Live `snapshot` gains `control_chaos: number`.

`PlayerStat` gains `top_speed_kmh?: number; sprints?: number` (already) and `avg_pass_difficulty?: number`.

## Control room: governance

```ts
type Cue = { version: "1.0"; timecode: string; duration_s: number; priority: number; template: string;
  data: Record<string, unknown>; strings: Record<string, { title: string; body: string }> };   // strings per language
type BroadcasterProfile = { id: string; name: string; languages: string[]; tone: string;
  brand: { primary: string; secondary: string }; auto_approve_threshold: number | null };
type AuditEntry = { at: string; item_id: string; action: string; by: "producer" | "auto" | "system"; title: string; detail?: string };
```

`StudioItem` gains `cue: Cue`, `auto_approved?: boolean`, `editorial: { passed: boolean; issues: string[] }` and status `"killed"`.

| Method & path | Request | Response |
|---|---|---|
| `GET /api/studio/profiles` | | `BroadcasterProfile[]` |
| `GET /api/studio/{match_id}/settings` | | `{ profile_id: string; auto_approve_threshold: number \| null }` |
| `POST /api/studio/{match_id}/settings` | `{ profile_id?, auto_approve_threshold? }` | same |
| `POST /api/studio/{match_id}/items` | `{ kind: "lower_third" \| "stat_card" \| "talking_point" \| "replay_cue" \| "score_bug_alert"; title: string (≤120); body?: string (≤400); priority?: number = 60; duration_s?: number = 10 (3–30); t?: number (default end of match); template?: string; data?: object; key?: string (^[a-z0-9-]{1,40}$) }` | `StudioItem` with `source: "producer"` and status `proposed`. Same cue, editorial rules and audit as agent proposals (audit `by: "producer"`). Idempotent on `key` (id `si-pr-{key}`) |
| `POST /api/studio/{match_id}/items/{item_id}` | action may also be `"kill"` (take off air immediately) | `StudioItem` |
| `GET /api/studio/{match_id}/audit` | | `AuditEntry[]` (newest first) |

Overlay SSE also emits `event: kill` `data: {id}`. If the AI is slow or down, items still carry data-only cues (`cue.data`), so graphics never wait for text.

## Ops: SLO and cost per match

| Method & path | Response |
|---|---|
| `GET /api/ops` | `{ mode, uptime_s, slo: { target_p95_ms: number; p50_ms: number \| null; p95_ms: number \| null; samples: number; compliant: boolean \| null }, cost: { model_calls: number; input_tokens: number; output_tokens: number; est_cost_usd: number; per_match: { match_id: string; model_calls: number; est_cost_usd: number }[]; price_note: string } }` |

## Realtime broadcast (Azure Web PubSub)

The per-viewer SSE stream (`/api/matches/{id}/live`) is a **personal replay**: each viewer picks speed, start and persona, and each connection is served by the API. A **broadcast** is one shared live timeline for everyone: the API publishes **once** per tick to Azure Web PubSub groups and Web PubSub fans it out (1,000 concurrent connections per unit, up to 100 units = 100,000 viewers per resource; Premium P2 to 1,000,000). Narratives are generated once per language, never per viewer.

Source of a broadcast: `LIVE_SOURCE=eventhub` (feeder → Event Hubs → API), or a server-side shared replay started from the Studio (`POST /api/broadcast/{match_id}/start`). Without `WEBPUBSUB_ENDPOINT` the API reports `enabled: false` and clients use SSE.

Groups (all JSON, Web PubSub subprotocol `json.webpubsub.azure.v1`):

| Group | Messages |
|---|---|
| `match.{match_id}` | `tick` (once per second while live), `end` |
| `match.{match_id}.{language}` | `narrative` (moment and insight lines in that language) |
| `overlay.{match_id}` | `cue` (`on_air`, `kill`) for broadcast overlays |

```ts
type BroadcastTick = {
  type: "tick"; match_id: string; seq: number; sent_at: number;   // epoch ms, for delivery-latency measurement
  t: number; minute: number; score: { home: number; away: number };
  events: MatchEvent[];               // events since the previous tick, without freeze frames (kept small: billing counts 2 KB chunks)
  snapshot: { momentum: number; win_prob: { home: number; draw: number; away: number }; control_chaos: number };
  moments: LiveMoment[];              // detected since the previous tick (no narrative; see the language group)
  insights: Insight[];                // detected changes since the previous tick
};
type BroadcastNarrative = { type: "narrative"; match_id: string; ref_type: "moment" | "insight"; ref_id: string; language: string;
  scope: "moment" | "insight"; persona: string; engine: "azure" | "offline";
  text: string; citations: Citation[]; fact_check: FactCheck; verification?: Verification | null };
// Late joiners load history once with GET /api/matches/{id}/events?to_t=<tick.t> (inclusive), then apply ticks.
type BroadcastCue = { type: "cue"; match_id: string; action: "on_air" | "kill"; item: StudioItem | { id: string } };
type BroadcastEnd = { type: "end"; match_id: string; t: number };

type BroadcastStatus = { match_id: string; live: boolean; source: "replay" | "eventhub"; speed: number; t: number; minute: number;
  started_at: string | null; ticks_published: number; bytes_published: number; languages: string[];
  viewers: number /* connections in the match group, Studio monitors excluded */; viewers_more: boolean /* over the cap */ };
```

| Method & path | Request | Response |
|---|---|---|
| `GET /api/realtime/negotiate` | query `match_id`, `language` (default `en`), `monitor` (default false; the Studio sets it so its own connection isn't counted as a viewer) | `{ enabled: false }` or `{ enabled: true, url: string /* wss://…?access_token=… (Entra-issued, ~60 min) */, groups: string[], hub: string }` |
| `POST /api/broadcast/{match_id}/start` | `{ speed?: number = 1, start_t?: number = 0, languages?: string[] = ["en"] }` | `BroadcastStatus` (idempotent: an already-live match returns its status) |
| `POST /api/broadcast/{match_id}/stop` | | `BroadcastStatus` |
| `GET /api/broadcast/status` | | `BroadcastStatus[]` |

Client flow: negotiate → `new WebSocket(url, "json.webpubsub.azure.v1")` → send `{type:"joinGroup", group, ackId}` for each group → handle `{type:"message", from:"group", group, data}`. Re-negotiate on close (tokens are short-lived). Studio `on_air`/`kill` actions are published to `overlay.{match_id}` as well as the SSE overlay stream.

Billing note: Web PubSub counts every outbound delivery in 2 KB chunks, so the tick is batched once per second and trimmed (no freeze frames). Keyless: the API generates client tokens with Microsoft Entra ID (`Web PubSub Service Owner` on the resource); local auth is disabled.
