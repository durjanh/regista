import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { Analysis, LiveMoment, MatchMeta, MomentType, Narrative, Physical, PlayerStat, Position } from "../api/types";
import type { LiveState } from "../hooks/useLiveMatch";
import { MOMENT_ICON, clock, cx, describeEvent } from "../lib/format";
import type { I18nKey } from "../lib/i18n";
import { usePrefs } from "../lib/prefs";
import { usePoll } from "../lib/truth";
import { ChaosMeter, EventDetail } from "./ChaosMeter";
import { EventLayer } from "./EventLayer";
import { InsightCard } from "./InsightCard";
import { ListenButton } from "./ListenButton";
import { MomentCard } from "./MomentCard";
import { Pitch } from "./Pitch";
import { PlayerLink } from "./ScoutViz";
import { ModelTag } from "./SourceBadge";
import { EmptyState, Skeleton } from "./States";
import { TeamSwatch } from "./TeamSwatch";

// ---------------------------------------------------------------- view state (URL first, then this browser's last choice)

export type ViewMode = "analyst" | "casual" | "player" | "club" | "metric";
export const VIEW_MODES: ViewMode[] = ["analyst", "casual", "player", "club", "metric"];
const VIEW_LABEL: Record<ViewMode, I18nKey> = {
  analyst: "view.analyst", casual: "view.casual", player: "view.player", club: "view.club", metric: "view.metric",
};
const VIEW_ICON: Record<ViewMode, string> = { analyst: "📊", casual: "🍿", player: "👟", club: "🏳", metric: "①" };
const STORE_KEY = "regista.matchdayView";

function storedView(): ViewMode {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return VIEW_MODES.includes(v as ViewMode) ? (v as ViewMode) : "analyst";
  } catch {
    return "analyst";
  }
}

/** ?view= wins (shareable links); otherwise the view this browser used last. Extra per-view choices live in the URL too. */
export function useMatchdayView() {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("view");
  const view = VIEW_MODES.includes(fromUrl as ViewMode) ? (fromUrl as ViewMode) : storedView();
  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      }, { replace: true }),
    [setParams],
  );
  const setView = useCallback(
    (v: ViewMode) => {
      try {
        localStorage.setItem(STORE_KEY, v);
      } catch {
        /* storage unavailable: the URL still carries the view */
      }
      setParam("view", v);
    },
    [setParam],
  );
  return { view, setView, params, setParam };
}

export function ViewSwitch({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const { t } = usePrefs();
  return (
    <div className="view-switch" role="group" aria-label={t("view.label")}>
      <span className="xs muted hide-sm">{t("view.label")}</span>
      <div className="seg">
        {VIEW_MODES.map((v) => (
          <button key={v} className={cx(view === v && "on")} aria-pressed={view === v} onClick={() => onChange(v)}>
            <span aria-hidden="true">{VIEW_ICON[v]} </span>
            {t(VIEW_LABEL[v])}
          </button>
        ))}
      </div>
    </div>
  );
}

type Colors = { home: string; away: string };
type Side = "home" | "away";
const stripCites = (s: string) => s.replace(/\s?\[f\d+\]/g, "");

/** Fetch `fn` every `ms` while the replay runs, and once more whenever it stops, so paused views show the final clock. */
function useLiveData<T>(fn: () => Promise<T>, ms: number, state: LiveState, deps: unknown[] = []) {
  const live = state.status === "live";
  const poll = usePoll(fn, ms, live, deps);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!live && state.t > 0) fnRef.current().then(poll.setData).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, state.status, ...deps]);
  return poll;
}

// ---------------------------------------------------------------- Casual: key moments only, bigger type, a slower feed

const ALWAYS: MomentType[] = ["goal", "penalty", "red_card", "wp_swing"];
const IF_BIG: MomentType[] = ["big_chance", "save", "momentum_swing", "tactical_shift", "pressing_spell"];
export const isKeyMoment = (m: Pick<LiveMoment, "type" | "importance">) =>
  ALWAYS.includes(m.type) || (IF_BIG.includes(m.type) && m.importance >= 70);

/** Casual pace: each big moment stays on screen for at least `holdMs`, and the view never trails the game by more than two. */
function useHeld<T extends { id: string }>(items: T[], holdMs: number): T | undefined {
  const [shownId, setShownId] = useState<string>();
  const shownAt = useRef(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!items.length) return;
    const idx = shownId ? items.findIndex((x) => x.id === shownId) : -1;
    if (idx === items.length - 1) return;
    const wait = shownAt.current + holdMs - Date.now();
    if (idx >= 0 && wait > 0) {
      const tid = window.setTimeout(() => setTick((n) => n + 1), wait);
      return () => window.clearTimeout(tid);
    }
    setShownId(items[Math.max(idx + 1, items.length - 3)].id);
    shownAt.current = Date.now();
  }, [items, shownId, holdMs, tick]);
  return items.find((x) => x.id === shownId);
}

function WinBar({ wp, match, colors, big }: { wp: { home: number; draw: number; away: number } | undefined; match: MatchMeta; colors: Colors; big?: boolean }) {
  const { t } = usePrefs();
  if (!wp) return <Skeleton h={big ? 120 : 64} />;
  const parts = [
    { key: "home", label: match.home.short, v: wp.home, color: colors.home },
    { key: "draw", label: t("casual.draw"), v: wp.draw, color: "var(--surface-3)" },
    { key: "away", label: match.away.short, v: wp.away, color: colors.away },
  ];
  return (
    <div className={cx("winbar", big && "big")} role="img"
      aria-label={`${t("casual.chance")}: ${parts.map((p) => `${p.label} ${Math.round(p.v * 100)}%`).join(", ")}`}>
      <div className="winbar-nums">
        {parts.map((p) => (
          <div key={p.key} className={cx("winbar-num", p.key)}>
            <span className="display tnum">{Math.round(p.v * 100)}%</span>
            <span className="xs muted">{p.label}</span>
          </div>
        ))}
      </div>
      <div className="winbar-track" aria-hidden="true">
        {parts.map((p) => (
          <span key={p.key} style={{ width: `${p.v * 100}%`, background: p.color }} />
        ))}
      </div>
    </div>
  );
}

export function CasualView({ match, state, colors, narratives }: { match: MatchMeta; state: LiveState; colors: Colors; narratives: Record<string, Narrative> }) {
  const { t, language, persona } = usePrefs();
  const key = useMemo(() => state.moments.filter(isKeyMoment), [state.moments]);
  const now = useHeld(key, 8000);
  const earlier = useMemo(() => key.filter((m) => now && m.t < now.t).reverse(), [key, now]);
  const colorFor = (team?: string) => (team === match.home.team_id ? colors.home : team === match.away.team_id ? colors.away : undefined);
  const textOf = (m: LiveMoment) => {
    const n = narratives[m.id] ?? m.narrative;
    return stripCites(n?.text ?? `${m.title}. ${m.summary}`);
  };
  return (
    <div className="casual">
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">{t("casual.chance")}</h2>
        </div>
        <WinBar wp={state.latest?.win_prob} match={match} colors={colors} />
      </section>
      <section className="card casual-now" style={{ "--team": colorFor(now?.team_id) ?? "var(--accent)" } as CSSProperties} aria-live="polite">
        <div className="card-head">
          <h2 className="card-title">{t("casual.now")}</h2>
        </div>
        {now ? (
          <article key={now.id} className="casual-moment">
            <div className="casual-icon" aria-hidden="true">{MOMENT_ICON[now.type] ?? "•"}</div>
            <div className="stack" style={{ gap: 8 }}>
              <div className="casual-title">
                <span className="tnum faint">{clock(now.minute, now.added_minute)}</span> {now.title}
              </div>
              <p className="casual-text">{textOf(now)}</p>
              <div>
                <ListenButton text={textOf(now)} language={language} persona={persona} />
              </div>
            </div>
          </article>
        ) : (
          <EmptyState icon="🍿">{t("casual.empty")}</EmptyState>
        )}
      </section>
      {earlier.length ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("casual.earlier")}</h2>
          </div>
          <ol className="casual-list">
            {earlier.map((m) => (
              <li key={m.id} style={{ "--team": colorFor(m.team_id) ?? "var(--accent)" } as CSSProperties}>
                <span className="tnum faint">{clock(m.minute, m.added_minute)}</span>
                <span aria-hidden="true">{MOMENT_ICON[m.type]}</span>
                <span>{m.title}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Player focus

const fmtKm = (v: number | undefined) => (v === undefined ? "–" : v.toFixed(1));

export function PlayerFocusView({ match, state, colors, playerId, onPlayer }: {
  match: MatchMeta; state: LiveState; colors: Colors; playerId: string | null; onPlayer: (id: string) => void;
}) {
  const { t } = usePrefs();
  const id = match.match_id;
  const roster = useMemo(() => [...match.home.players, ...match.away.players], [match]);
  const fallback = useMemo(
    () => (match.home.players.find((p) => p.starter && p.position === "ST") ?? match.home.players.find((p) => p.starter) ?? roster[0])?.player_id,
    [match, roster],
  );
  const pid = playerId && roster.some((p) => p.player_id === playerId) ? playerId : fallback;
  const player = roster.find((p) => p.player_id === pid);
  const side: Side = player?.team_id === match.away.team_id ? "away" : "home";
  const tRef = useRef(0);
  tRef.current = state.t;
  const stats = useLiveData<PlayerStat[]>(() => api.players(id, tRef.current || undefined), 5000, state, [id]);
  const phys = useLiveData<Physical>(() => api.physical(id, tRef.current || undefined), 5000, state, [id]);
  const st = stats.data?.find((p) => p.player_id === pid);
  const ph = phys.data?.players.find((p) => p.player_id === pid);
  const mine = useMemo(() => state.events.filter((e) => e.player_id === pid), [state.events, pid]);
  const sprintTags = mine.filter((e) => e.tags?.includes("sprint")).length;
  const recent = mine.slice(-8).reverse();
  const { shirts, names } = useMemo(() => {
    const s = new Map<string, number>();
    const n = new Map<string, string>();
    roster.forEach((p) => {
      s.set(p.player_id, p.shirt);
      n.set(p.player_id, p.name);
    });
    return { shirts: s, names: n };
  }, [roster]);

  if (!player) return <EmptyState icon="👟">{t("player.empty")}</EmptyState>;
  const kpis: { label: string; value: string; sub?: string; model?: boolean }[] = [
    { label: t("player.touches"), value: String(st?.touches ?? mine.length) },
    { label: t("player.passes"), value: String(st?.passes ?? "–"), sub: st ? `${Math.round(st.pass_completion * 100)}%` : undefined },
    { label: t("player.shots"), value: String(st?.shots ?? "–"), sub: st ? `xG ${st.xg.toFixed(2)}` : undefined },
    { label: t("player.distance"), value: fmtKm(ph?.distance_km ?? st?.distance_km), sub: "km", model: true },
    { label: t("player.sprints"), value: String(ph?.sprints ?? st?.sprints ?? "–"), sub: `${sprintTags} ⚡ ≥25 km/h`, model: true },
    { label: t("player.topSpeed"), value: ph ? ph.top_speed_kmh.toFixed(1) : st?.top_speed_kmh?.toFixed(1) ?? "–", sub: "km/h", model: true },
  ];
  const by15 = ph?.by_15 ?? [];
  const maxSeg = Math.max(0.1, ...by15);
  return (
    <div className="stack">
      <section className="card player-focus" style={{ "--team": colors[side] } as CSSProperties}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 10 }}>
            <TeamSwatch team={match[side]} size="lg" />
            <div>
              <div className="pf-name">
                <span className="tnum faint">#{player.shirt}</span>{" "}
                <PlayerLink name={player.name} playerKey={player.player_key} placeholder={player.name_source === "placeholder"} />
              </div>
              <div className="xs muted">{player.position} · {match[side].name}{st?.goals ? ` · ⚽ ${st.goals}` : ""}{st?.assists ? ` · 🅰 ${st.assists}` : ""}</div>
            </div>
          </div>
          <label className="row" style={{ gap: 6 }}>
            <span className="xs muted">{t("player.pick")}</span>
            <select className="select" value={pid} onChange={(e) => onPlayer(e.target.value)} aria-label={t("player.pick")}>
              {(["home", "away"] as Side[]).map((s) => (
                <optgroup key={s} label={match[s].name}>
                  {match[s].players.map((p) => (
                    <option key={p.player_id} value={p.player_id}>
                      #{p.shirt} {p.name} · {p.position}{p.starter ? "" : " (bench)"}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <div className="kpis" style={{ marginTop: 12 }}>
          {kpis.map((k) => (
            <div className="kpi" key={k.label}>
              <div className="label">{k.label}</div>
              <div className="value tnum">{k.value}</div>
              <div className="sub">{k.sub ?? " "}{k.model ? " · MODEL" : ""}</div>
            </div>
          ))}
        </div>
        {player.player_key ? (
          <div className="xs" style={{ marginTop: 8 }}>
            🧬 <PlayerLink name={t("player.dna")} playerKey={player.player_key} />
          </div>
        ) : null}
      </section>
      <div className="focus-grid">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("player.onPitch")}</h2>
            <span className="spacer" />
            <ModelTag />
          </div>
          <Pitch label={`${player.name}: actions`}>
            <EventLayer events={mine.slice(-24)} homeId={match.home.team_id} homeColor={colors.home} awayColor={colors.away} shirts={shirts} names={names} />
          </Pitch>
          {by15.length ? (
            <div style={{ marginTop: 12 }}>
              <div className="xs muted" style={{ marginBottom: 6 }}>{t("player.by15")} (km)</div>
              <div className="by15">
                {by15.map((v, i) => (
                  <div key={i} className="by15-col" title={`${i * 15}–${(i + 1) * 15}': ${v.toFixed(2)} km`}>
                    <span style={{ height: `${(v / maxSeg) * 100}%`, background: colors[side] }} />
                    <small className="tnum">{i * 15}'</small>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("player.recent")}</h2>
          </div>
          {recent.length ? (
            <ul className="ticker">
              {recent.map((e) => (
                <li key={e.id}>
                  <span className="tnum faint">{clock(e.minute, e.added_minute)}</span>
                  <span>{describeEvent(e)} <EventDetail e={e} /></span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="👟">{t("player.empty")}</EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Club focus

function Spark({ values, color, label }: { values: { minute: number; value: number }[]; color: string; label: string }) {
  if (values.length < 2) return <Skeleton h={90} />;
  const W = 320;
  const H = 90;
  const maxM = Math.max(90, values[values.length - 1].minute);
  const x = (m: number) => (m / maxM) * W;
  const y = (v: number) => H - 4 - v * (H - 8);
  const d = values.map((p, i) => `${i ? "L" : "M"} ${x(p.minute).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  return (
    <svg className="chart-svg spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      <line className="chart-axis" x1={0} x2={W} y1={y(0.5)} y2={y(0.5)} strokeDasharray="3 4" />
      <path d={`${d} L ${x(values[values.length - 1].minute)} ${H} L ${x(values[0].minute)} ${H} Z`} fill={color} opacity={0.14} />
      <path d={d} fill="none" stroke={color} strokeWidth={2.2} />
    </svg>
  );
}

export function ClubFocusView({ match, state, colors, side, onSide, narratives }: {
  match: MatchMeta; state: LiveState; colors: Colors; side: Side; onSide: (s: Side) => void; narratives: Record<string, Narrative>;
}) {
  const { t, language, persona } = usePrefs();
  const team = match[side];
  const opp = match[side === "home" ? "away" : "home"];
  const other: Side = side === "home" ? "away" : "home";
  const s = state.latest?.stats;
  const wp = state.latest?.win_prob[side];
  const trend = useMemo(() => state.snapshots.map((x) => ({ minute: x.minute, value: x.win_prob[side] })), [state.snapshots, side]);
  const moments = useMemo(
    () => [...state.moments].filter((m) => m.team_id === team.team_id || (m.type === "goal" && m.team_id === opp.team_id)).sort((a, b) => b.t - a.t),
    [state.moments, team.team_id, opp.team_id],
  );
  const insights = useMemo(
    () => [...state.insights].sort((a, b) => Number(b.team_id === team.team_id) - Number(a.team_id === team.team_id) || b.detected_t - a.detected_t),
    [state.insights, team.team_id],
  );
  const kpis = [
    { label: t("casual.chance"), value: wp === undefined ? "–" : `${Math.round(wp * 100)}%` },
    { label: "xG", value: s ? `${s[side].xg.toFixed(2)}`: "–", sub: s ? `v ${s[other].xg.toFixed(2)}` : undefined },
    { label: t("player.shots"), value: s ? String(s[side].shots) : "–", sub: s ? `v ${s[other].shots}` : undefined },
    { label: "Possession", value: s ? `${Math.round(s[side].possession * 100)}%` : "–" },
    { label: "PPDA", value: s ? s[side].ppda.toFixed(1) : "–", sub: "lower = more pressing" },
  ];
  return (
    <div className="stack">
      <section className="card club-head" style={{ "--team": colors[side] } as CSSProperties}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 10 }}>
            <TeamSwatch team={team} size="lg" />
            <div>
              <div className="xs muted">{t("club.pick")}</div>
              <div className="pf-name">{team.name}</div>
            </div>
          </div>
          <div className="seg" role="group" aria-label={t("club.pick")}>
            {(["home", "away"] as Side[]).map((x) => (
              <button key={x} className={cx(side === x && "on")} aria-pressed={side === x} onClick={() => onSide(x)}>
                {match[x].short}
              </button>
            ))}
          </div>
        </div>
        <div className="kpis" style={{ marginTop: 12 }}>
          {kpis.map((k) => (
            <div className="kpi" key={k.label}>
              <div className="label">{k.label}</div>
              <div className="value tnum">{k.value}</div>
              <div className="sub">{k.sub ?? " "}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="xs muted" style={{ marginBottom: 4 }}>{t("club.trend")}</div>
          <Spark values={trend} color={colors[side]} label={t("club.trend")} />
        </div>
      </section>
      <div className="focus-grid">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("club.moments")}</h2>
            <span className="spacer" />
            <span className="xs muted">{moments.length}</span>
          </div>
          {moments.length ? (
            <div className="feed">
              {moments.map((m) => (
                <MomentCard key={m.id} moment={m} narrative={narratives[m.id]} language={language} persona={persona}
                  teamColor={m.team_id === team.team_id ? colors[side] : colors[other]} />
              ))}
            </div>
          ) : (
            <EmptyState icon="⏱">{t("feed.empty")}</EmptyState>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("club.insights")}</h2>
          </div>
          {insights.length ? (
            <div className="insight-list">
              {insights.slice(0, 4).map((ins) => (
                <InsightCard key={ins.id} insight={ins} compact
                  teamName={ins.team_id === team.team_id ? team.short : opp.short}
                  teamColor={ins.team_id === team.team_id ? colors[side] : colors[other]} />
              ))}
            </div>
          ) : (
            <EmptyState icon="📈">{t("insight.empty")}</EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Single metric: one number, big, for a second screen

export type Metric = "winprob" | "xg" | "chaos";
const METRICS: Metric[] = ["winprob", "xg", "chaos"];

export function SingleMetricView({ match, state, colors, metric, onMetric }: {
  match: MatchMeta; state: LiveState; colors: Colors; metric: Metric; onMetric: (m: Metric) => void;
}) {
  const { t } = usePrefs();
  const label: Record<Metric, string> = { winprob: t("pulse.winprob"), xg: t("metric.xg"), chaos: t("chaos.title") };
  const s = state.latest?.stats;
  return (
    <section className="card metric-view">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 className="card-title">{label[metric]}</h2>
        <div className="seg" role="group" aria-label={t("metric.pick")}>
          {METRICS.map((m) => (
            <button key={m} className={cx(metric === m && "on")} aria-pressed={metric === m} onClick={() => onMetric(m)}>
              {label[m]}
            </button>
          ))}
        </div>
      </div>
      <div className="metric-stage" aria-live="polite">
        {metric === "winprob" ? <WinBar wp={state.latest?.win_prob} match={match} colors={colors} big /> : null}
        {metric === "xg" ? (
          s ? (
            <div className="metric-pair">
              {(["home", "away"] as Side[]).map((x) => (
                <div key={x} className="metric-big" style={{ color: colors[x] }}>
                  <span className="display tnum">{s[x].xg.toFixed(2)}</span>
                  <span className="xs muted">{match[x].short}</span>
                </div>
              ))}
            </div>
          ) : (
            <Skeleton h={160} />
          )
        ) : null}
        {metric === "chaos" ? (
          <div className="metric-chaos">
            <ChaosMeter value={state.latest?.control_chaos} />
          </div>
        ) : null}
      </div>
      <div className="xs faint">{metric === "winprob" ? "MODEL · Poisson goal model on Elo, updated live" : "MODEL · from synthetic match events"}</div>
    </section>
  );
}

// ---------------------------------------------------------------- Analyst extras: key battle and a dense event feed

const ATTACKERS: Record<"left" | "right", Position[]> = { right: ["RW", "RWB"], left: ["LW", "LWB"] };
const DEFENDERS: Record<"left" | "right", Position[]> = { right: ["LB", "LWB"], left: ["RB", "RWB"] };

/** The flank one side attacks most, the winger who carries it and the full-back facing him, with their duel numbers. */
export function KeyBattle({ match, state, colors }: { match: MatchMeta; state: LiveState; colors: Colors }) {
  const { t } = usePrefs();
  const tRef = useRef(0);
  tRef.current = state.t;
  const analysis = useLiveData<Analysis>(() => api.analysis(match.match_id, tRef.current || undefined), 15000, state, [match.match_id]);
  const a = analysis.data;
  const battle = useMemo(() => {
    if (!a) return null;
    const best = (["home", "away"] as Side[])
      .map((side) => {
        const ch = a.tactics[side].channels;
        const total = ch.left + ch.center + ch.right;
        const flank: "left" | "right" = ch.left >= ch.right ? "left" : "right";
        return { side, flank, share: total ? ch[flank] / total : 0, n: ch[flank] };
      })
      .sort((x, y) => y.share - x.share)[0];
    if (best.share < 0.36 || best.n < 8) return null;
    const def: Side = best.side === "home" ? "away" : "home";
    const touches = new Map<string, number>();
    state.events.forEach((e) => e.player_id && touches.set(e.player_id, (touches.get(e.player_id) ?? 0) + 1));
    const pick = (side: Side, positions: Position[]) =>
      match[side].players.filter((p) => positions.includes(p.position)).sort((x, y) => (touches.get(y.player_id) ?? 0) - (touches.get(x.player_id) ?? 0))[0];
    const attacker = pick(best.side, ATTACKERS[best.flank]) ?? pick(best.side, ["ST", "AM"]);
    const defender = pick(def, DEFENDERS[best.flank]);
    if (!attacker || !defender) return null;
    const ev = (pid: string) => state.events.filter((e) => e.player_id === pid);
    const dribbles = ev(attacker.player_id).filter((e) => e.type === "dribble");
    const crosses = ev(attacker.player_id).filter((e) => e.type === "pass" && e.pass_type === "cross").length;
    const stops = ev(defender.player_id).filter((e) => (e.type === "tackle" || e.type === "interception") && e.outcome !== "fail").length;
    return { ...best, def, attacker, defender, dribblesWon: dribbles.filter((e) => e.outcome === "success").length, dribbles: dribbles.length, crosses, stops };
  }, [a, state.events, match]);

  return (
    <section className="card" style={{ gridArea: "battle" }}>
      <div className="card-head">
        <h2 className="card-title">⚔ {t("battle.title")}</h2>
        <span className="spacer" />
        <ModelTag />
      </div>
      {!battle ? (
        a ? <EmptyState icon="⚔">{t("battle.empty")}</EmptyState> : <Skeleton h={90} />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="battle">
            <div className="battle-side" style={{ "--team": colors[battle.side] } as CSSProperties}>
              <small>{battle.attacker.position}</small>
              <b><PlayerLink name={battle.attacker.name} playerKey={battle.attacker.player_key} placeholder={battle.attacker.name_source === "placeholder"} /></b>
              <span className="xs muted tnum">{battle.dribblesWon}/{battle.dribbles} dribbles · {battle.crosses} crosses</span>
            </div>
            <span className="battle-vs" aria-label="versus">vs</span>
            <div className="battle-side" style={{ "--team": colors[battle.def] } as CSSProperties}>
              <small>{battle.defender.position}</small>
              <b><PlayerLink name={battle.defender.name} playerKey={battle.defender.player_key} placeholder={battle.defender.name_source === "placeholder"} /></b>
              <span className="xs muted tnum">{battle.stops} tackles + interceptions</span>
            </div>
          </div>
          <div className="xs">
            <b>{match[battle.side].short}</b>: <b className="tnum">{Math.round(battle.share * 100)}%</b> {t("battle.attacks")}
          </div>
        </div>
      )}
    </section>
  );
}

export function EventTicker({ match, state }: { match: MatchMeta; state: LiveState }) {
  const { t } = usePrefs();
  const recent = state.events.slice(-14).reverse();
  return (
    <section className="card" style={{ gridArea: "ticker" }}>
      <div className="card-head">
        <h2 className="card-title">{t("ticker.title")}</h2>
        <span className="spacer" />
        <ModelTag />
      </div>
      {recent.length ? (
        <ul className="ticker">
          {recent.map((e) => (
            <li key={e.id}>
              <span className="tnum faint">{clock(e.minute, e.added_minute)}</span>
              <span>
                <TeamSwatch team={e.team_id === match.home.team_id ? match.home : match.away} size="sm" /> {describeEvent(e)} <EventDetail e={e} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="⏱">{t("feed.empty")}</EmptyState>
      )}
    </section>
  );
}
