import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { narrationService, truthService } from "../api";
import type { Evidence, MatchEvent, Narrative } from "../api/types";
import { ChaosBand, ChaosMeter, EventDetail } from "../components/ChaosMeter";
import { EventLayer } from "../components/EventLayer";
import {
  CasualView, ClubFocusView, EventTicker, KeyBattle, PlayerFocusView, SingleMetricView, ViewSwitch, useMatchdayView, type Metric,
} from "../components/FanViews";
import { InsightCard } from "../components/InsightCard";
import { TruthPanel } from "../components/TruthPanel";
import { useMatch } from "../components/Layout";
import { LiveControls, statusLabel } from "../components/LiveControls";
import { MatchPulse } from "../components/MatchPulse";
import { MomentCard } from "../components/MomentCard";
import { Pitch } from "../components/Pitch";
import { ScoreBug } from "../components/ScoreBug";
import { StatBars } from "../components/StatBars";
import { EmptyState, Skeleton } from "../components/States";
import { HeadToHead, MatchFacts } from "../components/RealFacts";
import { PersonaSelect } from "../components/TopBar";
import { useLiveMatch } from "../hooks/useLiveMatch";
import { useBroadcast } from "../hooks/useBroadcast";
import { LiveBadge, SourceSwitch, useBroadcastStatus, type LiveSource } from "../components/Broadcast";
import { clock, describeEvent } from "../lib/format";
import { currentChain, goalsFromEvents, playerMaps, teamColors } from "../lib/match";
import { usePrefs } from "../lib/prefs";
import { speak } from "../lib/speech";
import { usePoll, useTruthMode } from "../lib/truth";
import { IconBack } from "../components/icons";
import { quietly } from "../lib/activity";
import { Lineups } from "../components/Lineups";
import { ModelTag } from "../components/SourceBadge";
import { webglAvailable } from "../lib/webgl";
import { venueStyle } from "../lib/venue";

// Three.js loads only when the 3D pitch is shown.
const Pitch3D = lazy(() => import("../components/Pitch3D").then((m) => ({ default: m.Pitch3D })));
type PitchMode = "3d" | "2d";
const storedPitchMode = (): PitchMode => {
  try {
    const v = localStorage.getItem("regista.pitchMode");
    if (v === "2d" || v === "3d") return v;
  } catch {
    /* storage unavailable */
  }
  return "3d";
};

export function Matchday() {
  const { id = "" } = useParams();
  const match = useMatch();
  const { persona, language, t, accessible, setAccessible, autoplayAudio, setAutoplayAudio, favClubs, favPlayers } = usePrefs();
  // Club and player focus open on the viewer's favourites when they play in this match (a link's ?side / ?player wins).
  const favSide = favClubs.includes(match.away.team_id) && !favClubs.includes(match.home.team_id) ? "away" : "home";
  const favPlayer = [...match.home.players, ...match.away.players].find((p) => p.player_key && favPlayers.includes(p.player_key));
  const live = useLiveMatch(id, { persona, language, initialSpeed: accessible ? 10 : 30 });
  // Live broadcast: one shared timeline over Azure Web PubSub, chosen by default when the match is on air. Replay:
  // the viewer's own SSE stream with speed and seek. Every view renders either source (same LiveState shape).
  const { status: onAir } = useBroadcastStatus(id);
  const [source, setSource] = useState<LiveSource | null>(null);
  const wantBroadcast = Boolean(onAir?.live) && (source ?? "broadcast") === "broadcast";
  const bc = useBroadcast(id, { language, active: wantBroadcast, homeId: match.home.team_id, awayId: match.away.team_id });
  const usingBroadcast = wantBroadcast && bc.available !== false;
  const { pause: pauseReplay, play: playReplay } = live;
  useEffect(() => {
    if (usingBroadcast) pauseReplay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingBroadcast]);
  const chooseSource = (s: LiveSource) => {
    setSource(s);
    if (s === "replay") playReplay();
  };
  // No Web PubSub in this deployment: carry on with the viewer's replay.
  useEffect(() => {
    if (wantBroadcast && bc.available === false) playReplay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantBroadcast, bc.available]);
  const state = usingBroadcast ? bc.state : live.state;
  // Fan views differ in layout and pace, not just wording: analyst, casual, player focus, club focus, single metric.
  const { view, setView, params, setParam } = useMatchdayView();
  const colors = teamColors(match);
  const { shirts, names } = useMemo(() => playerMaps(match), [match]);

  const [evidence, setEvidence] = useState<{ key: string; label: string; ids: string[] } | null>(null);
  const [selectedMoment, setSelectedMoment] = useState<string | null>(null);
  const [narratives, setNarratives] = useState<Record<string, Narrative>>({});
  const [narrating, setNarrating] = useState<string | null>(null);

  const momentumSeries = useMemo(() => state.snapshots.map((s) => ({ minute: s.minute, value: s.momentum })), [state.snapshots]);
  const wpSeries = useMemo(() => state.snapshots.map((s) => ({ minute: s.minute, ...s.win_prob })), [state.snapshots]);
  const goals = useMemo(() => goalsFromEvents(state.events), [state.events]);
  const lastEvent = state.events[state.events.length - 1];
  const clockLabel = lastEvent ? clock(lastEvent.minute, lastEvent.added_minute) : state.status === "ended" ? "FT" : "0'";

  // Pitch content: evidence takes priority over the live possession chain.
  const pitch = useMemo(() => {
    if (evidence) {
      const set = new Set(evidence.ids);
      const evs = state.events.filter((e) => set.has(e.id));
      const ff = [...evs].reverse().find((e) => e.freeze_frame?.length);
      return { events: evs, freeze: ff?.freeze_frame ?? null, ffTeam: ff?.team_id, caption: evidence.label };
    }
    let chain = currentChain(state.events);
    if (chain.length < 3) chain = state.events.slice(-6);
    const ff = [...chain].reverse().find((e) => e.freeze_frame?.length && (e.type === "shot" || e.tags?.includes("big_chance")));
    return { events: chain, freeze: ff?.freeze_frame ?? null, ffTeam: ff?.team_id, caption: lastEvent ? describeEvent(lastEvent) : "" };
  }, [evidence, state.events, lastEvent]);

  const sortedMoments = useMemo(() => [...state.moments].sort((a, b) => b.t - a.t), [state.moments]);

  // Accessible mode: announce and optionally read out new moments.
  const [announcement, setAnnouncement] = useState("");
  const spoken = useRef(new Set<string>());
  const speaking = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    const latest = sortedMoments[0];
    if (!latest || spoken.current.has(latest.id)) return;
    const n = narratives[latest.id] ?? latest.narrative;
    const announce = () => {
      spoken.current.add(latest.id);
      const text = n?.text ?? `${latest.title}. ${latest.summary}`;
      setAnnouncement(`${clock(latest.minute, latest.added_minute)}. ${text.replace(/\s?\[f\d+\]/g, "")}`);
      if (autoplayAudio && latest.importance >= 45) {
        speaking.current = speaking.current.then(() => speak(text, n?.language ?? language, persona));
      }
    };
    // The narrative usually follows the moment by a second or two; wait briefly for it on big moments.
    if (n || latest.importance < 45) {
      announce();
      return;
    }
    const tid = window.setTimeout(announce, 3500);
    return () => window.clearTimeout(tid);
  }, [sortedMoments, autoplayAudio, language, persona, narratives]);

  const onEvidence = (ev: Evidence, momentId: string) => {
    const key = `${momentId}:${ev.fact_id}`;
    if (evidence?.key === key) return setEvidence(null);
    const m = state.moments.find((x) => x.id === momentId);
    const ids = ev.event_ids?.length ? ev.event_ids : m?.event_ids ?? [];
    setEvidence({ key, label: `${ev.label}: ${ev.value}${ev.unit ? ` ${ev.unit}` : ""}`, ids });
  };

  const narrate = async (momentId: string) => {
    setNarrating(momentId);
    try {
      const n = await quietly(() => narrationService.narrate({ match_id: id, scope: "moment", moment_id: momentId, persona, language, upto_t: state.t }));
      setNarratives((prev) => ({ ...prev, [momentId]: n }));
    } catch {
      /* keep the deterministic summary */
    } finally {
      setNarrating(null);
    }
  };

  // A persona change shows at once: the latest big moment is rewritten in the new voice. Later lines follow on their
  // own in the viewer's replay; the shared broadcast keeps one broadcaster voice for everyone.
  const shownPersona = useRef(persona);
  useEffect(() => {
    if (persona === shownPersona.current) return;
    shownPersona.current = persona;
    const latest = sortedMoments.find((m) => m.importance >= 45) ?? sortedMoments[0];
    if (latest) void narrate(latest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona]);

  const can3d = useMemo(() => webglAvailable(), []);
  const [pitchMode, setPitchModeRaw] = useState<PitchMode>(storedPitchMode);
  const setPitchMode = (m: PitchMode) => {
    setPitchModeRaw(m);
    try {
      localStorage.setItem("regista.pitchMode", m);
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  };
  const show3d = can3d && pitchMode === "3d" && !evidence;
  const venue = useMemo(() => venueStyle(match), [match]);

  const stats = state.latest?.stats;

  // Truth loop: detected changes stream in live; truth mode reveals what was planted and how the agents scored.
  const [truthMode, setTruthMode] = useTruthMode();
  const tLive = useRef(0);
  tLive.current = state.t;
  const truthActive = truthMode && (state.status === "live" || state.status === "ended" || state.status === "paused");
  const truth = usePoll(() => truthService.report(id, Math.max(1, tLive.current)), 3000, truthActive && state.status === "live", [id]);
  // one refresh when the stream stops, so the panel reflects the final clock
  useEffect(() => {
    if (truthMode && (state.status === "paused" || state.status === "ended") && state.t > 0) {
      truthService.report(id, Math.max(1, state.t)).then(truth.setData).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truthMode, state.status, id]);
  const plantedFor = useMemo(() => {
    const map = new Map<string, number>();
    const rep = truth.data;
    if (!rep) return map;
    for (const g of rep.grades) {
      const p = rep.plants.find((x) => x.id === g.plant_id);
      if (g.insight_id && p) map.set(g.insight_id, p.minute);
    }
    return map;
  }, [truth.data]);
  const falseAlarms = useMemo(() => new Set(truth.data?.false_alarms.map((f) => f.id) ?? []), [truth.data]);
  const insights = useMemo(() => [...state.insights].sort((a, b) => b.detected_t - a.detected_t), [state.insights]);
  const chaosSeries = useMemo(
    () => state.snapshots.filter((s) => typeof s.control_chaos === "number").map((s) => ({ minute: s.minute, value: s.control_chaos as number })),
    [state.snapshots],
  );
  const teamMeta = {
    [match.home.team_id]: { short: match.home.short, color: colors.home },
    [match.away.team_id]: { short: match.away.short, color: colors.away },
  };

  return (
    <div className="stack">
      <ScoreBug
        home={match.home}
        away={match.away}
        score={state.score}
        clockLabel={clockLabel}
        live={state.status === "live"}
        statusLabel={state.status === "live" ? undefined : statusLabel(state, t)}
      />

      <div className="card p-12">
        {onAir?.live ? (
          <div className="row mb-10 gap-12">
            <SourceSwitch source={usingBroadcast ? "broadcast" : "replay"} onChange={chooseSource} />
            {usingBroadcast ? <LiveBadge connection={bc.connection} latencyMs={bc.latencyMs} /> : null}
            <span className="xs muted">{usingBroadcast ? t("bc.liveHint") : t("bc.replayHint")}</span>
            {usingBroadcast && persona !== "broadcaster" ? <span className="xs muted">{t("bc.personaHint")}</span> : null}
            {wantBroadcast && bc.available === false ? <span className="xs muted">{t("bc.unavailable")}</span> : null}
          </div>
        ) : null}
        {usingBroadcast ? null : <LiveControls {...live} />}
        <div className="row mt-10">
          <ViewSwitch view={view} onChange={setView} />
        </div>
        <div className="row mt-10 gap-14">
          <span className="show-sm-only">
            <PersonaSelect />
          </span>
          <label className="toggle">
            <input type="checkbox" checked={accessible} onChange={(e) => setAccessible(e.target.checked)} />
            {t("a11y.mode")}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={autoplayAudio} onChange={(e) => setAutoplayAudio(e.target.checked)} />
            {t("a11y.autoplay")}
          </label>
          <label className="toggle" title="Reveal the hidden planted changes and the Grader's verdicts">
            <input type="checkbox" checked={truthMode} onChange={(e) => setTruthMode(e.target.checked)} />
            {t("truth.mode")}
          </label>
          {truthMode ? <span className="pill truth-pill">◎ {t("truth.mode")}</span> : null}
          {state.status === "error" ? <span className="xs text-danger">{state.error}</span> : null}
        </div>
      </div>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {view === "casual" ? <CasualView match={match} state={state} colors={colors} narratives={narratives} /> : null}
      {view === "player" ? (
        <PlayerFocusView match={match} state={state} colors={colors} playerId={params.get("player") ?? favPlayer?.player_id ?? null} onPlayer={(p) => setParam("player", p)} />
      ) : null}
      {view === "club" ? (
        <ClubFocusView match={match} state={state} colors={colors} narratives={narratives}
          side={(params.get("side") ?? favSide) === "away" ? "away" : "home"} onSide={(x) => setParam("side", x)} />
      ) : null}
      {view === "metric" ? (
        <SingleMetricView match={match} state={state} colors={colors}
          metric={(["winprob", "xg", "chaos"].includes(params.get("metric") ?? "") ? params.get("metric") : "winprob") as Metric}
          onMetric={(m) => setParam("metric", m)} />
      ) : null}

      {view === "analyst" && (insights.length || truthMode) ? (
        <div className={truthMode ? "truth-row" : "truth-row single"}>
          <section className="card" aria-labelledby="insights-title">
            <div className="card-head">
              <h2 className="card-title" id="insights-title">{t("insight.title")}</h2>
              <span className="spacer" />
              <span className="xs muted">{insights.length}</span>
            </div>
            {insights.length ? (
              <div className="insight-list">
                {insights.slice(0, 6).map((ins) => (
                  <InsightCard
                    key={ins.id}
                    insight={ins}
                    teamName={teamMeta[ins.team_id]?.short}
                    teamColor={teamMeta[ins.team_id]?.color}
                    plantedMinute={truthMode ? plantedFor.get(ins.id) ?? null : null}
                    verdict={truthMode ? (plantedFor.has(ins.id) ? "hit" : falseAlarms.has(ins.id) ? "false_alarm" : null) : null}
                    activeFact={evidence?.key ?? null}
                    onEvidence={(ev, insightId) => {
                      const key = `${insightId}:${ev.fact_id}`;
                      if (evidence?.key === key) return setEvidence(null);
                      setEvidence({ key, label: `${ev.label}: ${ev.value}`, ids: ev.event_ids ?? [] });
                    }}
                  />
                ))}
              </div>
            ) : (
              <EmptyState icon="📈">{t("insight.empty")}</EmptyState>
            )}
          </section>
          {truthMode ? (
            <section className="card truth-card" aria-labelledby="truth-title">
              <div className="card-head">
                <h2 className="card-title" id="truth-title">◎ {t("truth.panel")}</h2>
                <span className="spacer" />
                <span className="xs muted">{t("truth.hidden")}</span>
              </div>
              <TruthPanel matchId={id} report={truth.data} t={state.t} ended={state.status === "ended"} teams={teamMeta} error={truth.error} />
            </section>
          ) : null}
        </div>
      ) : null}

      {view === "analyst" ? (
        <div className="matchday-areas">
          <section className="card area-pulse">
            <div className="card-head">
              <h2 className="card-title">{t("pulse.title")}</h2>
              <span className="spacer" />
              <div className="legend">
                <span>
                  <i style={{ background: colors.home }} />
                  {match.home.short}
                </span>
                <span>
                  <i style={{ background: colors.away }} />
                  {match.away.short}
                </span>
              </div>
              <ChaosMeter value={state.latest?.control_chaos} />
            </div>
            {momentumSeries.length > 1 ? (
              <MatchPulse
                momentum={momentumSeries}
                winProb={wpSeries}
                goals={goals}
                homeColor={colors.home}
                awayColor={colors.away}
                homeName={match.home.short}
                awayName={match.away.short}
                currentMinute={lastEvent?.minute}
              />
            ) : (
              <Skeleton h={200} />
            )}
            {chaosSeries.length > 1 ? <ChaosBand series={chaosSeries} /> : null}
          </section>

          <section className="card area-feed" aria-labelledby="feed-title">
            <div className="card-head">
              <h2 className="card-title" id="feed-title">
                {t("feed.title")}
              </h2>
              <span className="spacer" />
              <span className="xs muted">{state.moments.length}</span>
            </div>
            {sortedMoments.length ? (
              <div className="feed">
                {sortedMoments.map((m) => (
                  <MomentCard
                    key={m.id}
                    moment={m}
                    narrative={narratives[m.id]}
                    teamColor={m.team_id === match.home.team_id ? colors.home : m.team_id === match.away.team_id ? colors.away : undefined}
                    selected={selectedMoment === m.id}
                    activeFact={evidence?.key ?? null}
                    onEvidence={onEvidence}
                    onSelect={() => {
                      setSelectedMoment(m.id);
                      setEvidence({ key: `${m.id}:all`, label: m.title, ids: m.event_ids });
                    }}
                    language={language}
                    persona={persona}
                    onNarrate={() => narrate(m.id)}
                    narrating={narrating === m.id}
                  />
                ))}
              </div>
            ) : (
              <EmptyState icon="⏱">{t("feed.empty")}</EmptyState>
            )}
          </section>

          <section className="card area-pitch">
            <div className="card-head">
              <h2 className="card-title">{evidence ? "Evidence on the pitch" : t("pitch.title")}</h2>
              <span className="spacer" />
              {evidence ? (
                <button className="btn sm" onClick={() => { setEvidence(null); setSelectedMoment(null); }}>
                  <IconBack /> Back to live
                </button>
              ) : (
                <span className="xs muted">{match.home.short} attack →</span>
              )}
              {can3d && !evidence ? (
                <div className="seg" role="group" aria-label="Pitch view">
                  {(["3d", "2d"] as const).map((m) => (
                    <button key={m} className={pitchMode === m ? "on" : undefined} aria-pressed={pitchMode === m} onClick={() => setPitchMode(m)}>
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {show3d ? (
              <Suspense fallback={<Skeleton h={320} />}>
                <Pitch3D events={state.events} home={match.home} away={match.away} homeColor={colors.home} awayColor={colors.away}
                  venue={venue} label={`3D live pitch at ${venue.label}: ${pitch.caption}`} />
              </Suspense>
            ) : (
            <Pitch label="Live pitch view">
              <EventLayer
                events={pitch.events as MatchEvent[]}
                homeId={match.home.team_id}
                homeColor={colors.home}
                awayColor={colors.away}
                freezeFrame={pitch.freeze}
                freezeFrameTeam={pitch.ffTeam}
                shirts={shirts}
                names={names}
              />
            </Pitch>
            )}
            <div className="pitch-caption">
              {pitch.caption} {!evidence ? <EventDetail e={lastEvent} /> : null}
            </div>
            <div className="pitch-legend">
              <span><i className="swatch" style={{ background: colors.home }} />{match.home.name}</span>
              <span><i className="swatch" style={{ background: colors.away }} />{match.away.name}</span>
              {show3d ? (
                <span className="row gap-6">
                  <span title="Regista knows each venue's city, country and altitude, not its stadium: the ground is generated from those">
                    🏟 {venue.label}{venue.altitude ? ` · ${venue.altitude.toLocaleString()} m` : ""} (generated ground)
                  </span>
                  <span>● on the ball · other players placed from each team's shape</span>
                  <ModelTag title="The ball and the player on it follow the event stream; the other 20 players are placed from each team's formation, shifted with the ball" />
                </span>
              ) : (
                <span>─ pass · - - carry · ○ shot (size = xG)</span>
              )}
            </div>
          </section>

          <section className="card area-lineups">
            <div className="card-head">
              <h2 className="card-title">Line-ups</h2>
            </div>
            <Lineups match={match} events={state.events} />
          </section>

          <section className="card area-facts">
            <div className="card-head">
              <h2 className="card-title">Match facts</h2>
            </div>
            <MatchFacts match={match} homeColor={colors.home} awayColor={colors.away} />
          </section>

          {match.h2h && match.h2h.played > 0 ? (
            <section className="card area-h2h">
              <div className="card-head">
                <h2 className="card-title">Head to head</h2>
              </div>
              <HeadToHead h2h={match.h2h} home={match.home} away={match.away} homeColor={colors.home} awayColor={colors.away} />
            </section>
          ) : null}

          <section className="card area-stats">
            <div className="card-head">
              <h2 className="card-title">{t("stats.title")}</h2>
            </div>
            {stats ? (
              <StatBars home={stats.home} away={stats.away} homeColor={colors.home} awayColor={colors.away} />
            ) : (
              <div className="stack">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} h={22} />
                ))}
              </div>
            )}
          </section>

          <EventTicker match={match} state={state} />
          <KeyBattle match={match} state={state} colors={colors} />
        </div>
      ) : null}
    </div>
  );
}
