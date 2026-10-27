// Mirrors docs/API_CONTRACT.md exactly. Change the contract first, then this file.

export type Persona = "casual" | "analyst" | "kids" | "fantasy" | "broadcaster" | "social" | "accessible";
export type Language = "en" | "es" | "fr" | "de" | "pt" | "ar" | "hi" | "ja" | "zh-Hans" | "sw" | "it" | "nl";

export type TeamRef = {
  team_id: string;
  name: string;
  short: string;
  colors: { primary: string; secondary: string; text: string };
};

export type Position = "GK" | "RB" | "CB" | "LB" | "RWB" | "LWB" | "DM" | "CM" | "AM" | "RW" | "LW" | "ST";

export type Player = {
  player_id: string;
  team_id: string;
  name: string;
  shirt: number;
  position: Position;
  starter: boolean;
  /** "placeholder" players are named like "England No. 5": names are never invented. */
  name_source?: "dataset" | "placeholder";
  /** Stable id across matches: "england:harry-kane", or "england:no-1" for placeholders. */
  player_key?: string;
};

export type Team = TeamRef & {
  city: string;
  manager: string;
  formation: string;
  style: { label: string; possession: number; directness: number; press: number; width: number };
  players: Player[];
};

export type Score = { home: number; away: number };

export type RealGoal = { minute: number; team_id: string; scorer: string; penalty: boolean; own_goal: boolean; assist?: string };

export type MatchSource = {
  kind: "real_result" | "what_if";
  disclosure: string;
  real?: {
    date: string;
    tournament: string;
    city: string;
    country: string;
    neutral: boolean;
    goals: RealGoal[];
  };
  dataset: { name: string; source: string; licence: string };
};

export type H2HMatch = { date: string; home_team: string; away_team: string; home_score: number; away_score: number; tournament: string };

export type H2H = {
  played: number;
  home_wins: number;
  draws: number;
  away_wins: number;
  home_goals: number;
  away_goals: number;
  last: H2HMatch[];
};

export type MatchMeta = {
  match_id: string;
  competition: string;
  season: string;
  matchweek: number;
  venue: string;
  kickoff: string;
  referee: string;
  home: Team;
  away: Team;
  final_score: Score;
  duration_s: number;
  /** Stream clock at which each half kicks off, e.g. [0, 2880]. */
  period_starts?: number[];
  scenario_tags: string[];
  seed: number;
  headline_hint?: string;
  source: MatchSource;
  /** Pre-match Elo computed from every prior result since 1872. */
  elo: { home: number; away: number };
  h2h: H2H;
  venue_info?: VenueInfo;
  featured?: boolean;
};

export type VenueInfo = { city: string; altitude_m?: number; note?: string };

/** The list endpoint omits the head-to-head block. */
export type MatchSummary = Omit<MatchMeta, "home" | "away" | "h2h"> & {
  home: TeamRef;
  away: TeamRef;
  h2h?: H2H;
  /** Count of hidden planted changes (never their content): "Truth mode available". */
  planted_changes?: number;
};

export type FreezeFramePlayer = { player_id: string; team_id: string; x: number; y: number; actor?: boolean; gk?: boolean };

export type EventType =
  | "kick_off" | "pass" | "carry" | "dribble" | "shot" | "tackle" | "interception" | "clearance" | "recovery" | "pressure"
  | "foul" | "card" | "substitution" | "offside" | "corner" | "free_kick" | "throw_in" | "goal_kick" | "save" | "half_end" | "full_time";

export type ShotOutcome = "goal" | "saved" | "off_target" | "blocked" | "post";
export type BodyPart = "right_foot" | "left_foot" | "head";
export type Situation = "open_play" | "counter" | "set_piece" | "penalty";

export type MatchEvent = {
  id: string;
  seq: number;
  period: 1 | 2;
  t: number;
  minute: number;
  added_minute?: number;
  second: number;
  type: EventType;
  team_id: string;
  player_id?: string;
  player_name?: string;
  x: number;
  y: number;
  end_x?: number;
  end_y?: number;
  outcome?: "success" | "fail";
  recipient_id?: string;
  possession_id: number;
  pass_type?: "short" | "long" | "cross" | "through_ball" | "cutback" | "switch";
  body_part?: BodyPart;
  situation?: Situation;
  shot_outcome?: ShotOutcome;
  xg?: number;
  xt_added?: number;
  card?: "yellow" | "second_yellow" | "red";
  sub_in?: string;
  sub_out?: string;
  score: Score;
  freeze_frame?: FreezeFramePlayer[];
  tags?: string[];
  own_goal_by?: string;
  assist_event_id?: string;
  /** Penalties only, from the taker's point of view. Same value = keeper guessed right. */
  placement?: Side3;
  gk_dive?: Side3;
  /** Brief features (MODEL): metres, 0..1 difficulty from the engine's success model, km/h speeds. */
  pass_length?: number;
  difficulty?: number;
  ball_speed_kmh?: number;
  shot_speed_kmh?: number;
  speed_kmh?: number;
};

export type Side3 = "left" | "center" | "right";

export type Evidence = { fact_id: string; label: string; value: string | number; unit?: string; event_ids?: string[] };

export type WinProb = { home: number; draw: number; away: number };

export type MomentType =
  | "goal" | "big_chance" | "save" | "penalty" | "red_card" | "yellow_card" | "substitution"
  | "momentum_swing" | "tactical_shift" | "turning_point" | "pressing_spell" | "wp_swing";

export type Moment = {
  id: string;
  match_id: string;
  t: number;
  minute: number;
  added_minute?: number;
  type: MomentType;
  team_id?: string;
  player_id?: string;
  title: string;
  summary: string;
  importance: number;
  confidence: number;
  event_ids: string[];
  evidence: Evidence[];
  explanation: {
    why_it_matters: string;
    factors: { name: string; impact: "positive" | "negative" | "neutral"; detail: string }[];
  };
  wp_before?: WinProb;
  wp_after?: WinProb;
  xg?: number;
};

export type TeamStats = {
  team_id: string;
  goals: number;
  xg: number;
  shots: number;
  shots_on_target: number;
  big_chances: number;
  passes: number;
  pass_completion: number;
  possession: number;
  progressive_passes: number;
  final_third_entries: number;
  xt: number;
  corners: number;
  fouls: number;
  yellow: number;
  red: number;
  offsides: number;
  tackles: number;
  interceptions: number;
  ppda: number;
  field_tilt: number;
};

export type Shot = {
  event_id: string;
  t: number;
  minute: number;
  team_id: string;
  player_id: string;
  player_name: string;
  x: number;
  y: number;
  xg: number;
  outcome: ShotOutcome | undefined;
  body_part: BodyPart | undefined;
  situation: Situation | undefined;
};

export type XgBreakdown = {
  event_id: string;
  xg: number;
  base: number;
  factors: { name: string; contribution: number; detail: string }[];
};

export type PassNetwork = {
  team_id: string;
  nodes: { player_id: string; name: string; shirt: number; x: number; y: number; touches: number }[];
  edges: { source: string; target: string; count: number }[];
};

export type Tactics = {
  team_id: string;
  formation: { detected: string; confidence: number };
  shifts: { minute: number; from: string; to: string; trigger_event_id?: string; explanation: string }[];
  ppda: { window: string; value: number }[];
  channels: { left: number; center: number; right: number };
  pass_network: PassNetwork;
  avg_line_height: number;
};

export type PlayerStat = {
  player_id: string;
  name: string;
  team_id: string;
  shirt: number;
  position: string;
  minutes: number;
  touches: number;
  passes: number;
  pass_completion: number;
  xt: number;
  xg: number;
  shots: number;
  goals: number;
  assists: number;
  key_passes: number;
  tackles: number;
  interceptions: number;
  rating: number;
  /** MODEL (synthetic events) */
  distance_km?: number;
  sprints?: number;
  player_key?: string;
  top_speed_kmh?: number;
  avg_pass_difficulty?: number;
};

export type Analysis = {
  match_id: string;
  t: number;
  minute: number;
  score: Score;
  stats: { home: TeamStats; away: TeamStats };
  momentum: { minute: number; value: number }[];
  win_prob: ({ minute: number; t: number } & WinProb)[];
  xg_timeline: { minute: number; home: number; away: number }[];
  shots: Shot[];
  moments: Moment[];
  tactics: { home: Tactics; away: Tactics };
  top_players: PlayerStat[];
  /** 0 = one side in control, 1 = chaos (possession flipping, low completion). */
  control_chaos?: { minute: number; value: number }[];
  /** Game rhythm per 15-minute window (MODEL): tempo (passes a minute) and patience (passes per possession). */
  rhythm?: RhythmWindow[];
  pass_profile?: { home: PassProfile; away: PassProfile };
};

export type RhythmWindow = { from: number; to: number; passes_per_min: number; passes_per_possession: number };

export type PassProfile = {
  avg_length: number;
  long_share: number;
  avg_difficulty: number;
  completion_by_difficulty: { band: "easy" | "medium" | "hard"; attempts: number; completion: number }[];
};

export type FactCheck = {
  passed: boolean;
  checked_claims: number;
  issues: { sentence: string; problem: string }[];
  bias_flags: { phrase: string; suggestion: string }[];
};

export type Citation = { fact_id: string; label: string; value: string | number; event_ids?: string[] };

export type AgentStep = { agent: string; action: string; ms: number; detail?: string };

export type Engine = "azure" | "offline";

export type Narrative = {
  id: string;
  match_id: string;
  scope: "moment" | "live_line" | "halftime" | "fulltime" | "dugout" | "insight";
  moment_id?: string;
  persona: string;
  language: string;
  text: string;
  citations: Citation[];
  fact_check: FactCheck;
  engine: Engine;
  latency_ms: number;
  agent_trace: AgentStep[];
  /** Insight lines: what the Verifier caught in the Analyst's draft before the line aired. */
  verification?: Verification | null;
};

/**
 * The Verifier's catch on an insight draft. In a drill, one supported number was overstated on purpose (a planted
 * claim error, like a planted tactical change); `caught` says whether the Verifier flagged it. A known-bad draft never airs.
 */
export type Verification = {
  drill: boolean;
  draft: string;
  issues: { sentence: string; problem: string }[];
  caught: boolean | null;
  planted: { original: string; planted: string } | null;
};

export type StudioKind = "lower_third" | "stat_card" | "talking_point" | "replay_cue" | "score_bug_alert";
export type StudioStatus = "proposed" | "approved" | "rejected" | "on_air" | "killed";

export type StudioItem = {
  id: string;
  match_id: string;
  moment_id?: string;
  kind: StudioKind;
  priority: number;
  title: string;
  body: string;
  data: Record<string, unknown>;
  status: StudioStatus;
  t: number;
  minute: number;
  created_at: string;
  duration_s: number;
  cue?: Cue;
  auto_approved?: boolean;
  editorial?: { passed: boolean; issues: string[] };
  /** "producer" when a human added it (e.g. from the half-time pack); agent proposals omit it. */
  source?: string;
};

/** Versioned, machine-readable graphic cue any renderer can play (OBS, vMix, a CG system). */
export type Cue = {
  version: "1.0" | string;
  timecode: string;
  duration_s: number;
  priority: number;
  template: string;
  data: Record<string, unknown>;
  strings: Record<string, { title: string; body: string }>;
};

export type BroadcasterProfile = {
  id: string;
  name: string;
  languages: string[];
  tone: string;
  brand: { primary: string; secondary: string };
  auto_approve_threshold: number | null;
};

export type StudioSettings = { profile_id: string; auto_approve_threshold: number | null };

export type AuditEntry = { at: string; item_id: string; action: string; by: "producer" | "auto" | "system"; title: string; detail?: string };

export type Recap = {
  match_id: string;
  persona: string;
  language: string;
  headline: string;
  standfirst: string;
  report_md: string;
  social_posts: { platform: "x" | "instagram" | "tiktok" | "whatsapp"; text: string }[];
  audio_script: string;
  run_sheet: { tc_start: string; tc_end: string; minute: number; title: string; event_ids: string[]; priority: number }[];
  player_of_match: { player_id: string; name: string; team_id: string; reason: string; metrics: Evidence[] };
  citations: Citation[];
  fact_check: FactCheck;
  engine: Engine;
  latency_ms: number;
  agent_trace: AgentStep[];
};

export type Scenario = "balanced" | "late_drama" | "comeback" | "red_card" | "derby" | "tactical_chess" | "goal_fest" | "underdog";

export type ForgeConfig = {
  home_team_id: string;
  away_team_id: string;
  seed?: number;
  scenario?: Scenario;
  intensity?: number;
  home_formation?: string;
  away_formation?: string;
  /** Team strength as of this date (YYYY-MM-DD). */
  as_of?: string;
};

export type Calibration = {
  n_matches: number;
  reference: { name: string; source: string; licence: string; matches: number };
  metrics: {
    metric: string;
    simulated: number;
    reference: number;
    low: number;
    high: number;
    unit?: string;
    status: "pass" | "warn" | "fail";
    source: string;
  }[];
  goal_minute_distribution: { bin: string; simulated: number; reference: number }[];
  scoreline_distribution: { score: string; simulated: number; reference: number }[];
};

export type Health = {
  status: "ok";
  mode: "azure" | "offline";
  version: string;
  services: {
    llm: boolean;
    agents: boolean;
    speech: boolean;
    translator: boolean;
    safety: boolean;
    cosmos: boolean;
    eventhub: boolean;
    onelake: boolean;
  };
};

export type MomentDetail = {
  moment: Moment;
  sequence: MatchEvent[];
  freeze_frame: FreezeFramePlayer[] | null;
  xg_breakdown: XgBreakdown | null;
};

export type AskResponse = {
  answer: string;
  citations: Citation[];
  tool_calls: { tool: string; args: Record<string, unknown>; ms: number }[];
  engine: Engine;
  fact_check: FactCheck;
  agent_trace: AgentStep[];
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

// Live SSE payloads
export type LiveMeta = { match_id: string; speed: number; start_t: number; duration_s: number };
export type LiveSnapshot = {
  t: number;
  minute: number;
  score: Score;
  momentum: number;
  win_prob: WinProb;
  stats: { home: TeamStats; away: TeamStats };
  control_chaos?: number;
};
export type LiveMoment = Moment & { narrative?: Narrative };

// Reference data (CC0 martj42/international_results)
export type ReferenceSummary = {
  matches: number;
  first_date: string;
  last_date: string;
  teams: number;
  goals_recorded: number;
  shootouts: number;
  source: string;
  licence: string;
};

export type ReferenceTeam = { team_id: string; name: string; elo: number; rank: number; played: number; colors: TeamRef["colors"] };

export type TeamDNA = {
  team_id: string;
  name: string;
  colors: TeamRef["colors"];
  elo: number;
  rank: number;
  elo_history: { date: string; elo: number }[];
  record: { played: number; won: number; drawn: number; lost: number; gf: number; ga: number };
  recent: { date: string; opponent: string; gf: number; ga: number; tournament: string; city: string }[];
  top_scorers: { name: string; goals: number }[];
};

// ---------------------------------------------------------------- Manager and scouting (Dugout)
// REAL = results dataset (goals, penalty goals, assists, venues, records). MODEL = synthetic events.

export type Rec = { played: number; won: number; drawn: number; lost: number; gf: number; ga: number; win_pct: number };
export type Percentile = { metric: string; label: string; value: number; percentile: number; peers: number; higher_is_better: boolean };
export type Advice = { title: string; detail: string; evidence: string };
export type Split3 = { left: number; center: number; right: number };

export type PlayerDNA = {
  player_key: string;
  name: string;
  team_id: string;
  team_name: string;
  position: string;
  name_source: "dataset" | "placeholder";
  real: null | {
    international_goals: number;
    penalty_goals: number;
    assists_recorded: number;
    first_goal: string;
    last_goal: string;
    goals_by_period: { bin: string; goals: number }[];
    venue_split: { home: number; away: number; neutral: number };
    vs_top30_elo: number;
    recent_goals: { date: string; opponent: string; minute: number; penalty: boolean; tournament: string }[];
    source: string;
  };
  model: {
    matches: number;
    minutes: number;
    per90: {
      goals: number; xg: number; shots: number; xt: number; key_passes: number; passes: number; pass_completion: number;
      progressive_passes: number; tackles: number; interceptions: number; pressures: number; dribbles: number;
      distance_km: number; sprints: number;
    };
    foot: { right: number; left: number; head: number };
    shot_channels: Split3;
    shot_zones: { inside_box: number; outside_box: number };
    shot_map: { x: number; y: number; xg: number; outcome: string }[];
    goal_map: { x: number; y: number; xg: number }[];
    penalties: null | { real_scored: number; modelled_taken: number; placement: Split3; conversion: number };
    goalkeeping: null | {
      penalties_faced: number; dive: Split3; penalty_save_pct: number; shots_faced: number; saves: number; save_pct: number;
      xg_faced: number; goals_conceded: number; goals_prevented: number; long_distribution_pct: number;
    };
    percentiles: Percentile[];
  };
  strengths: string[];
  weaknesses: string[];
  how_to_stop: Advice[];
  disclosure: string;
};

export type Leader = { player_key: string; name: string; value: number; unit: string };

export type TeamReport = {
  team_id: string;
  name: string;
  colors: TeamRef["colors"];
  elo: number;
  rank: number | null;
  real: {
    overall: Rec; home: Rec; away: Rec; neutral: Rec; since: string;
    last10: { date: string; opponent: string; gf: number; ga: number; venue: "home" | "away" | "neutral"; tournament: string }[];
    top_scorers_recent: { name: string; goals: number; penalties: number }[];
  };
  model: {
    matches: number;
    leaders: {
      most_distance: Leader[]; most_passes: Leader[]; top_rated: Leader[]; top_threat: Leader[]; most_pressures: Leader[]; most_sprints: Leader[];
    };
    attacking_channels: Split3;
    penalty_takers: { player_key: string; name: string; real_scored: number; favourite_side: string; share: number }[];
    goalkeeper: null | { player_key: string; name: string; favourite_dive: string; share: number; save_pct: number };
  };
  danger_men: { player_key: string; name: string; why: string }[];
  how_to_play_against: Advice[];
  disclosure: string;
};

export type FatigueLevel = "fresh" | "tiring" | "exhausted";
export type PlayerStatus = "good" | "ok" | "watch" | "struggling";

export type DugoutPlayer = {
  player_id: string;
  player_key?: string;
  name: string;
  position: string;
  shirt: number;
  on_pitch: boolean;
  minutes: number;
  rating: number;
  baseline: number | null;
  form_delta: number | null;
  fatigue: { distance_km: number; first15_km: number; last15_km: number; drop_pct: number; sprints: number; level: FatigueLevel };
  booked: boolean;
  status: PlayerStatus;
  reasons: string[];
};

export type DugoutRecommendation = {
  id: string;
  type: "substitution" | "tactical" | "warning";
  priority: number;
  title: string;
  detail: string;
  evidence: Evidence[];
  substitution?: {
    off: { player_id: string; name: string };
    on: { player_id: string; name: string };
    impact: { wp_before: WinProb; wp_after: WinProb; xg_delta: number };
  };
};

export type Dugout = {
  match_id: string;
  side: "home" | "away";
  team_id: string;
  opponent_id: string;
  minute: number;
  t: number;
  score: Score;
  win_prob: WinProb;
  venue: { city: string; altitude_m?: number; note?: string; record_in_country?: Rec & { country: string } };
  players: DugoutPlayer[];
  bench: { player_id: string; player_key?: string; name: string; position: string; baseline: number | null; fit: string }[];
  subs_used: number;
  recommendations: DugoutRecommendation[];
  danger_men: { player_id: string; name: string; why: string; xt: number; xg: number }[];
  opponent_patterns: { channels: Split3; ppda: number; field_tilt: number; note: string };
};

export type ScoutingPlayer = {
  player_key: string;
  name: string;
  team_id: string;
  team_name: string;
  position: string;
  matches: number;
  rating: number;
  name_source: "dataset" | "placeholder";
};

export type PhysicalPlayer = {
  player_id: string;
  player_key?: string;
  name: string;
  team_id: string;
  position: string;
  minutes: number;
  distance_km: number;
  sprints: number;
  top_speed_kmh: number;
  by_15: number[];
};

export type Physical = { players: PhysicalPlayer[] };

// ---------------------------------------------------------------- Truth loop
// The engine secretly plants tactical changes; detectors find them from events alone; a Grader scores the agents.

export type Mechanism = "press_switch" | "shape_change" | "tiring_fullback" | "hot_streak" | "set_piece_routine" | "chaos_spell";
export type Difficulty = "obvious" | "moderate" | "subtle";

export type Plant = {
  id: string;
  mechanism: Mechanism;
  team_id: string;
  minute: number;
  t: number;
  direction: string;
  difficulty: Difficulty;
  player_id?: string;
  player_name?: string;
  description: string;
};

export type FeaturePoint = { minute: number; value: number };

export type Insight = {
  id: string;
  match_id: string;
  team_id: string;
  mechanism: Mechanism;
  direction: string;
  /** Detected change point. */
  start_minute: number;
  /** First minute the detector was confident (no look-ahead). */
  detected_minute: number;
  detected_t: number;
  confidence: number;
  title: string;
  text: string;
  player_id?: string;
  player_name?: string;
  feature: {
    name: string;
    label: string;
    unit?: string;
    series: FeaturePoint[];
    change_minute: number;
    before: number;
    after: number;
    /** The KQL a Verifier would re-run on Eventhouse. */
    query: string;
  };
  evidence: Evidence[];
};

export type LiveInsight = Insight & { narrative?: Narrative };

export type Grade = {
  plant_id: string;
  mechanism: Mechanism;
  team_id: string;
  difficulty: string;
  detected: boolean;
  insight_id?: string;
  seconds_to_detect?: number;
  explanation_correct?: boolean;
};

export type TruthReport = {
  match_id: string;
  upto_t: number;
  plants: Plant[];
  insights: Insight[];
  grades: Grade[];
  false_alarms: Insight[];
  score: {
    recall: number | null;
    false_alarms: number;
    median_seconds_to_detect: number | null;
    explanation_accuracy: number | null;
  };
};

export type Range3 = { median: number; p10: number; p90: number };

export type Counterfactual = {
  plant: Plant;
  metric: { name: string; label: string; unit?: string };
  runs: number;
  with_change: Range3;
  without_change: Range3;
  effect: Range3;
  explanation: string;
};

export type TruthScore = {
  latest: null | {
    date: string;
    matches: number;
    plants: number;
    recall: number;
    false_alarms_per_match: number;
    median_seconds_to_detect: number | null;
    by_difficulty: { difficulty: string; recall: number; plants: number }[];
    by_mechanism: { mechanism: string; recall: number; plants: number }[];
  };
  history: { date: string; recall: number; false_alarms_per_match: number; median_seconds_to_detect: number | null }[];
};

// ---------------------------------------------------------------- Ops
export type Ops = {
  mode: string;
  uptime_s: number;
  slo: { target_p95_ms: number; p50_ms: number | null; p95_ms: number | null; samples: number; compliant: boolean | null };
  cost: {
    model_calls: number;
    input_tokens: number;
    output_tokens: number;
    est_cost_usd: number;
    per_match: { match_id: string; model_calls: number; est_cost_usd: number }[];
    price_note: string;
  };
};

// Realtime broadcast (Azure Web PubSub): one shared live timeline, published once per tick and fanned out by Web
// PubSub to every viewer. Groups: match.{id} (tick, end), match.{id}.{language} (narrative), overlay.{id} (cue).
export type BroadcastSnapshot = { momentum: number; win_prob: WinProb; control_chaos: number };
export type BroadcastTick = {
  type: "tick";
  match_id: string;
  seq: number;
  /** Epoch ms when the API published the tick: now - sent_at is the delivery latency. */
  sent_at: number;
  t: number;
  minute: number;
  score: Score;
  /** Events since the previous tick, without freeze frames. */
  events: MatchEvent[];
  snapshot: BroadcastSnapshot;
  moments: Moment[];
  insights: Insight[];
};
export type BroadcastNarrative = {
  type: "narrative";
  match_id: string;
  ref_type: "moment" | "insight";
  ref_id: string;
  language: string;
  text: string;
  citations: Citation[];
  fact_check: FactCheck;
  verification?: Verification | null;
  /** Not in the contract yet; read when present. */
  persona?: string;
  engine?: Engine;
};
export type BroadcastCue = { type: "cue"; match_id: string; action: "on_air" | "kill"; item: StudioItem | { id: string } };
export type BroadcastEnd = { type: "end"; match_id: string; t: number };
export type BroadcastMessage = BroadcastTick | BroadcastNarrative | BroadcastCue | BroadcastEnd;

export type BroadcastStatus = {
  match_id: string;
  live: boolean;
  source: "replay" | "eventhub";
  speed: number;
  t: number;
  minute: number;
  started_at: string | null;
  ticks_published: number;
  bytes_published: number;
  languages: string[];
  /** Connections in the match's Web PubSub group, refreshed every few seconds while live. */
  viewers: number;
  /** True when the count stopped at the configured cap: shown as "N+". */
  viewers_more: boolean;
};

export type RealtimeNegotiate =
  | { enabled: false }
  | { enabled: true; url: string; groups: string[]; hub: string };
