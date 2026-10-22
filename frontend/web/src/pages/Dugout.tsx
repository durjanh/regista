import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { dugoutService } from "../api";
import type { Dugout as DugoutT, DugoutPlayer, DugoutRecommendation, Evidence, Narrative, WinProb } from "../api/types";
import { EngineBadge, FactCheckBadge } from "../components/FactCheck";
import { InsightCard } from "../components/InsightCard";
import { useMatch } from "../components/Layout";
import { ListenButton } from "../components/ListenButton";
import { LiveControls, statusLabel } from "../components/LiveControls";
import { CitedText } from "../components/Markdown";
import { ScoreBug } from "../components/ScoreBug";
import { ChannelArrows, PlayerLink } from "../components/ScoutViz";
import { InfoPop, ModelTag, RealTag } from "../components/SourceBadge";
import { EmptyState, ErrorState, Skeleton } from "../components/States";
import { TeamSwatch } from "../components/TeamSwatch";
import { useLiveMatch } from "../hooks/useLiveMatch";
import { clock, cx, readableOn } from "../lib/format";
import { teamColors } from "../lib/match";
import { playerIndex, teamReportPath } from "../lib/players";
import { usePrefs } from "../lib/prefs";
import { IconApprove, IconBrief, IconReject } from "../components/icons";
import { quietly } from "../lib/activity";

type Side = "home" | "away";

const POLL_MS = 3000;
const pct = (v: number) => `${Math.round(v * 100)}%`;

const DUGOUT_DISCLOSURE =
  "Ratings, fatigue, distance, sprints, danger men and substitution impact come from Regista's synthetic match events (MODEL). " +
  "Baselines compare a player with his own modelled form across other matches. Records in a country and venue facts come from the real results dataset (REAL). " +
  "In a club deployment the same logic runs on a licensed event and tracking feed.";

export function Dugout() {
  const { id = "" } = useParams();
  const match = useMatch();
  const { persona, language, t } = usePrefs();
  const colors = teamColors(match);
  const index = useMemo(() => playerIndex(match), [match]);

  const [side, setSide] = useState<Side>("home");
  const live = useLiveMatch(id, { persona, language, initialSpeed: 30 });
  const { state } = live;

  const [data, setData] = useState<DugoutT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handled, setHandled] = useState<Record<string, "accepted" | "dismissed">>({});
  const [brief, setBrief] = useState<Narrative | null>(null);
  const [briefing, setBriefing] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const tRef = useRef(state.t);
  tRef.current = state.t;
  const callId = useRef(0);

  const fetchDugout = useCallback(
    async (s: Side) => {
      const call = ++callId.current;
      try {
        const d = await dugoutService.dashboard(id, s, Math.max(1, tRef.current));
        if (call === callId.current) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (call === callId.current) setError(e instanceof Error ? e.message : String(e));
      }
    },
    [id],
  );

  const running = state.status === "live" || state.status === "connecting";

  // Poll while the replay runs; fetch once on pause, full time, or a change of side.
  useEffect(() => {
    void fetchDugout(side);
    if (!running) return;
    const h = window.setInterval(() => void fetchDugout(side), POLL_MS);
    return () => window.clearInterval(h);
  }, [fetchDugout, side, running]);

  useEffect(() => {
    setHandled({});
    setBrief(null);
  }, [side]);

  const runBrief = async () => {
    setBriefing(true);
    setBriefError(null);
    try {
      setBrief(await quietly(() => dugoutService.brief({ match_id: id, side, upto_t: Math.max(1, Math.floor(state.t)), language })));
    } catch (e) {
      setBriefError(e instanceof Error ? e.message : String(e));
    } finally {
      setBriefing(false);
    }
  };

  const team = side === "home" ? match.home : match.away;
  const opp = side === "home" ? match.away : match.home;
  const teamColor = side === "home" ? colors.home : colors.away;
  const oppColor = side === "home" ? colors.away : colors.home;
  const lastEvent = state.events[state.events.length - 1];
  const clockLabel = lastEvent ? clock(lastEvent.minute, lastEvent.added_minute) : state.status === "ended" ? "FT" : "0'";

  const onPitch = data?.players.filter((p) => p.on_pitch) ?? [];
  const offPitch = data?.players.filter((p) => !p.on_pitch) ?? [];
  const recs = [...(data?.recommendations ?? [])].sort((a, b) => b.priority - a.priority);
  // Detected changes: what the opponent changed matters most to the bench, then our own.
  const insights = [...state.insights].sort((a, b) => (a.team_id === opp.team_id ? 0 : 1) - (b.team_id === opp.team_id ? 0 : 1) || b.detected_t - a.detected_t);

  return (
    <div className="stack">
      <div className="row" style={{ gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="xs muted">{t("dugout.side")}</span>
          <div className="seg" role="group" aria-label={t("dugout.side")}>
            {(["home", "away"] as Side[]).map((s) => {
              const tm = s === "home" ? match.home : match.away;
              return (
                <button key={s} className={cx(side === s && "on")} onClick={() => setSide(s)} aria-pressed={side === s}>
                  <span className="row" style={{ gap: 6 }}>
                    <TeamSwatch team={tm} size="sm" />
                    {tm.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link to={teamReportPath(opp.team_id)} className="btn sm">
            🔎 {t("scout.teamReport")}: {opp.short}
          </Link>
          <InfoPop text={DUGOUT_DISCLOSURE} label="Where these numbers come from" />
        </div>
      </div>

      <ScoreBug
        home={match.home}
        away={match.away}
        score={state.score}
        clockLabel={clockLabel}
        live={state.status === "live"}
        statusLabel={state.status === "live" ? undefined : statusLabel(state, t)}
      />

      <div className="card" style={{ padding: 12 }}>
        <LiveControls {...live} />
      </div>

      {error && !data ? <ErrorState message={error} onRetry={() => void fetchDugout(side)} /> : null}

      {data ? (
        <div className="card" style={{ padding: 12 }}>
          <div className="dugout-head">
            <div className="stack" style={{ gap: 6 }}>
              <div className="row xs muted" style={{ gap: 8 }}>
                <span>Win probability · {team.name}</span>
                <ModelTag />
              </div>
              <WinStrip wp={data.win_prob} side={side} homeColor={colors.home} awayColor={colors.away} />
              <div className="row xs" style={{ gap: 12, flexWrap: "wrap" }}>
                <span>
                  {match.home.short} <b className="tnum">{pct(data.win_prob.home)}</b>
                </span>
                <span>
                  Draw <b className="tnum">{pct(data.win_prob.draw)}</b>
                </span>
                <span>
                  {match.away.short} <b className="tnum">{pct(data.win_prob.away)}</b>
                </span>
              </div>
            </div>
            <div className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
              <span className="pill" title={data.venue.note}>
                📍 {data.venue.city}
                {data.venue.altitude_m ? ` · ${data.venue.altitude_m.toLocaleString()} m altitude` : ""}
              </span>
              {data.venue.record_in_country ? (
                <span className="xs muted">
                  {team.short} in {data.venue.record_in_country.country}: {data.venue.record_in_country.won}W {data.venue.record_in_country.drawn}D{" "}
                  {data.venue.record_in_country.lost}L <RealTag />
                </span>
              ) : null}
              <span className="xs muted">
                {t("dugout.subsUsed")}: <b className="tnum">{data.subs_used}</b>/5
              </span>
            </div>
          </div>
          {data.venue.note ? <div className="note" style={{ marginTop: 10 }}>{data.venue.note}</div> : null}
        </div>
      ) : (
        !error && <Skeleton h={90} />
      )}

      <div className="dugout-grid">
        <div className="stack">
          <section className="card" aria-labelledby="recs-title">
            <div className="card-head">
              <h2 className="card-title" id="recs-title">
                {t("dugout.recs")}
              </h2>
              <ModelTag />
              <span className="spacer" />
              {data ? <span className="xs muted">{clock(data.minute)}</span> : null}
            </div>
            {!data ? (
              <div className="stack">
                <Skeleton h={90} />
                <Skeleton h={70} />
              </div>
            ) : recs.length ? (
              <div className="recs">
                {recs.map((r) => (
                  <RecommendationCard
                    key={r.id}
                    rec={r}
                    side={side}
                    teamName={team.short}
                    state={handled[r.id]}
                    onAccept={() => setHandled((h) => ({ ...h, [r.id]: "accepted" }))}
                    onDismiss={() => setHandled((h) => ({ ...h, [r.id]: "dismissed" }))}
                  />
                ))}
              </div>
            ) : (
              <EmptyState icon="✅">{t("dugout.none")}</EmptyState>
            )}
          </section>

          <section className="card" aria-labelledby="squad-title">
            <div className="card-head">
              <h2 className="card-title" id="squad-title">
                {t("dugout.squad")}
              </h2>
              <ModelTag />
              <span className="spacer" />
              <StatusLegend />
            </div>
            {!data ? (
              <div className="squad-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} h={130} />
                ))}
              </div>
            ) : onPitch.length ? (
              <div className="squad-grid">
                {onPitch.map((p) => (
                  <PlayerCard key={p.player_id} p={p} color={teamColor} ink={readableOn(teamColor)} placeholder={index.byId.get(p.player_id)?.name_source === "placeholder"} />
                ))}
              </div>
            ) : (
              <EmptyState icon="⏱">Player status appears once the match starts.</EmptyState>
            )}
          </section>

          {data && (data.bench.length || offPitch.length) ? (
            <section className="card">
              <div className="two-col">
                <div>
                  <div className="card-head">
                    <h2 className="card-title">{t("dugout.bench")}</h2>
                    <ModelTag title="Baseline = modelled average rating in other matches" />
                  </div>
                  <div className="bench-list">
                    {data.bench.map((b) => (
                      <div key={b.player_id} className="bench-row">
                        <span className="pill" style={{ padding: "0 6px", justifyContent: "center" }}>
                          {b.position}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <PlayerLink name={b.name} playerKey={b.player_key} placeholder={index.byId.get(b.player_id)?.name_source === "placeholder"} />
                          <div className="xs muted">{b.fit}</div>
                        </div>
                        <span className="tnum xs muted">{b.baseline !== null ? `avg ${b.baseline.toFixed(1)}` : "–"}</span>
                      </div>
                    ))}
                    {!data.bench.length ? <span className="xs muted">No substitutes left.</span> : null}
                  </div>
                </div>
                <div>
                  <div className="card-head">
                    <h2 className="card-title">{t("dugout.offpitch")}</h2>
                  </div>
                  <div className="bench-list">
                    {offPitch.map((p) => (
                      <div key={p.player_id} className="bench-row">
                        <span className="pill" style={{ padding: "0 6px", justifyContent: "center" }}>
                          {p.position}
                        </span>
                        <PlayerLink name={p.name} playerKey={p.player_key} />
                        <span className="tnum xs muted">
                          {p.rating.toFixed(1)} · {p.minutes}'
                        </span>
                      </div>
                    ))}
                    {!offPitch.length ? <span className="xs muted">Nobody substituted yet.</span> : null}
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">{t("dugout.briefing")}</h2>
              <span className="spacer" />
              <button className="btn primary sm" onClick={runBrief} disabled={briefing} aria-busy={briefing}>
                {briefing ? t("recap.generating") : <><IconBrief /> {t("dugout.brief")}</>}
              </button>
            </div>
            {brief ? (
              <div className="stack" style={{ gap: 10 }}>
                <p className="small" style={{ margin: 0, lineHeight: 1.55 }}>
                  <CitedText text={brief.text} citations={brief.citations} />
                </p>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <ListenButton text={brief.text.replace(/\[f\d+\]/g, "")} language={brief.language} persona="broadcaster" small />
                  <FactCheckBadge fc={brief.fact_check} />
                  <EngineBadge engine={brief.engine} ms={brief.latency_ms} />
                </div>
              </div>
            ) : briefError ? (
              <ErrorState message={briefError} onRetry={runBrief} />
            ) : (
              <div className="xs muted">A grounded summary of what's working, who's struggling and what to change, from the assistant-coach agent.</div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">{t("dugout.danger")}</h2>
              <span className="xs muted">{opp.name}</span>
              <ModelTag />
            </div>
            {!data ? (
              <Skeleton h={90} />
            ) : data.danger_men.length ? (
              <div className="stack" style={{ gap: 8 }}>
                {data.danger_men.map((d) => (
                  <div key={d.player_id} className="advice">
                    <div className="advice-icon" aria-hidden="true" style={{ background: "var(--danger-soft)" }}>
                      ⚠
                    </div>
                    <div>
                      <div className="advice-title">
                        <PlayerLink name={d.name} playerKey={index.byId.get(d.player_id)?.player_key} />
                      </div>
                      <div className="small">{d.why}</div>
                      <div className="row xs muted" style={{ gap: 10, marginTop: 4 }}>
                        <span>
                          xT <b className="tnum">{d.xt.toFixed(2)}</b>
                        </span>
                        <span>
                          xG <b className="tnum">{d.xg.toFixed(2)}</b>
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="xs muted">No standout threat yet.</div>
            )}
          </section>

          {insights.length ? (
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">{t("insight.title")}</h2>
                <ModelTag />
                <span className="spacer" />
                <span className="xs muted">{insights.length}</span>
              </div>
              <div className="insight-list">
                {insights.slice(0, 3).map((ins) => (
                  <InsightCard key={ins.id} insight={ins} compact
                    teamName={ins.team_id === match.home.team_id ? match.home.short : match.away.short}
                    teamColor={ins.team_id === match.home.team_id ? colors.home : colors.away} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">{t("dugout.patterns")}</h2>
              <ModelTag />
            </div>
            {data ? (
              <div className="stack" style={{ gap: 10 }}>
                <ChannelArrows split={data.opponent_patterns.channels} color={oppColor} label={`${opp.name} attacking channels`} unit="of their final-third entries" />
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="chip">
                    PPDA <b>{data.opponent_patterns.ppda.toFixed(1)}</b>
                  </span>
                  <span className="chip">
                    Field tilt <b>{pct(data.opponent_patterns.field_tilt)}</b>
                  </span>
                </div>
                {data.opponent_patterns.note ? <div className="note">{data.opponent_patterns.note}</div> : null}
              </div>
            ) : (
              <Skeleton h={180} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function WinStrip({ wp, homeColor, awayColor }: { wp: WinProb; side: Side; homeColor: string; awayColor: string }) {
  return (
    <div className="wp-strip" aria-hidden="true">
      <span style={{ width: pct(wp.home), background: homeColor }} />
      <span style={{ width: pct(wp.draw), background: "var(--text-faint)" }} />
      <span style={{ width: pct(wp.away), background: awayColor }} />
    </div>
  );
}

function StatusLegend() {
  return (
    <span className="row xs" style={{ gap: 6 }}>
      {(["good", "ok", "watch", "struggling"] as const).map((s) => (
        <span key={s} className={cx("status-chip", s)}>
          {s}
        </span>
      ))}
    </span>
  );
}

function evidenceChips(ev: Evidence[]) {
  if (!ev.length) return null;
  return (
    <div className="chips">
      {ev.map((e) => (
        <span key={e.fact_id} className="chip" title={e.fact_id}>
          {e.label} <b>{e.value}{e.unit ? ` ${e.unit}` : ""}</b>
        </span>
      ))}
    </div>
  );
}

function RecommendationCard({
  rec, side, teamName, state, onAccept, onDismiss,
}: {
  rec: DugoutRecommendation;
  side: Side;
  teamName: string;
  state?: "accepted" | "dismissed";
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const { t } = usePrefs();
  if (state === "dismissed") return null;
  const sub = rec.substitution;
  const icon = rec.type === "substitution" ? "🔁" : rec.type === "tactical" ? "♟" : "⚠";
  return (
    <article className={cx("rec", rec.type, state === "accepted" && "done")}>
      <div className="row" style={{ gap: 8, justifyContent: "space-between" }}>
        <span className="rec-title">
          <span aria-hidden="true">{icon}</span> {rec.title}
        </span>
        <span className="pill xs tnum" title="Priority">
          P{rec.priority}
        </span>
      </div>
      {sub ? (
        <div className="subswap">
          <div className="who off">
            <small>Off</small>
            {sub.off.name}
          </div>
          <span className="arrow faint" aria-hidden="true">
            →
          </span>
          <div className="who on">
            <small>On</small>
            {sub.on.name}
          </div>
        </div>
      ) : null}
      <div className="small">{rec.detail}</div>
      {sub ? (
        <div className="impact-line">
          {teamName} win probability <b className="tnum">{pct(sub.impact.wp_before[side])}</b> → <b className="tnum">{pct(sub.impact.wp_after[side])}</b>
          {", "}
          <b className="tnum">
            {sub.impact.xg_delta >= 0 ? "+" : ""}
            {sub.impact.xg_delta.toFixed(2)} xG
          </b>{" "}
          <ModelTag title="Estimated with the live win-probability model from the players' modelled ratings" />
        </div>
      ) : null}
      {evidenceChips(rec.evidence)}
      <div className="row" style={{ gap: 8 }}>
        {state === "accepted" ? (
          <span className="pill accent">✓ {t("dugout.accepted")}</span>
        ) : (
          <>
            <button className="btn sm primary" onClick={onAccept}>
              <IconApprove /> {t("dugout.accept")}
            </button>
            <button className="btn sm ghost" onClick={onDismiss}>
              <IconReject /> {t("dugout.dismiss")}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

const FATIGUE_WIDTH = { fresh: 88, tiring: 52, exhausted: 18 } as const;
const FATIGUE_COLOR = { fresh: "var(--accent)", tiring: "var(--warn)", exhausted: "var(--danger)" } as const;

function PlayerCard({ p, color, ink, placeholder }: { p: DugoutPlayer; color: string; ink: string; placeholder?: boolean }) {
  const [open, setOpen] = useState(p.status === "struggling");
  const delta = p.form_delta;
  return (
    <div className={cx("pcard", p.status)}>
      <div className="pcard-top">
        <span className="pcard-shirt" style={{ background: color, color: ink }}>
          {p.shirt}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="pcard-name">
            <PlayerLink name={p.name} playerKey={p.player_key} placeholder={placeholder} />
          </div>
          <div className="row xs muted" style={{ gap: 6 }}>
            <span>{p.position}</span>
            <span>·</span>
            <span className="tnum">{p.minutes}'</span>
            {p.booked ? <span title="Booked" aria-label="Booked">🟨</span> : null}
            <span className={cx("status-chip", p.status)}>{p.status}</span>
          </div>
        </div>
        <div>
          <div className="pcard-rating tnum">{p.rating.toFixed(1)}</div>
          {delta !== null && p.baseline !== null ? (
            <div className={delta >= 0 ? "delta-up" : "delta-down"} title={`Baseline ${p.baseline.toFixed(1)}`}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
            </div>
          ) : null}
        </div>
      </div>
      <div className="fatigue" title={`${p.fatigue.level}: last 15 min ${p.fatigue.last15_km.toFixed(2)} km vs first 15 min ${p.fatigue.first15_km.toFixed(2)} km`}>
        <span>Energy</span>
        <span className="fatigue-track">
          <span style={{ width: `${FATIGUE_WIDTH[p.fatigue.level]}%`, background: FATIGUE_COLOR[p.fatigue.level] }} />
        </span>
        <span className="tnum">{p.fatigue.drop_pct > 0 ? `−${Math.round(p.fatigue.drop_pct)}%` : p.fatigue.level}</span>
      </div>
      <div className="row xs muted" style={{ gap: 10 }}>
        <span>
          <b className="tnum" style={{ color: "var(--text)" }}>{p.fatigue.distance_km.toFixed(1)}</b> km
        </span>
        <span>
          <b className="tnum" style={{ color: "var(--text)" }}>{p.fatigue.sprints}</b> sprints
        </span>
        {p.reasons.length ? (
          <button className="btn ghost sm" style={{ marginInlineStart: "auto", minHeight: 0, padding: "0 6px" }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide" : "Why"}
          </button>
        ) : null}
      </div>
      {open && p.reasons.length ? (
        <ul className="reasons">
          {p.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
