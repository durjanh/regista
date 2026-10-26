import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { matchService } from "../api";
import type { Analysis, MomentDetail, PassProfile, Shot } from "../api/types";
import { ChaosBand, EventDetail } from "../components/ChaosMeter";
import { ModelTag } from "../components/SourceBadge";
import { ChannelBars, PassNetworkChart, PpdaChart, ShotMap, XgWaterfall } from "../components/charts";
import { EventLayer } from "../components/EventLayer";
import { useMatch } from "../components/Layout";
import { Pitch } from "../components/Pitch";
import { EmptyState, ErrorState, Skeleton, SkeletonCard } from "../components/States";
import { useAsync } from "../hooks/useAsync";
import { MOMENT_ICON, clock, cx, describeEvent } from "../lib/format";
import { playerMaps, teamColors } from "../lib/match";
import { PlayerLink } from "../components/ScoutViz";
import { IconPause, IconPlay, IconStepBack, IconStepForward, IconToStart } from "../components/icons";

export function Tactics() {
  const { id = "" } = useParams();
  const match = useMatch();
  const colors = teamColors(match);
  const { shirts, names, placeholders } = useMemo(() => playerMaps(match), [match]);
  const keys = useMemo(() => new Map([...match.home.players, ...match.away.players].map((pl) => [pl.player_id, pl.player_key])), [match]);
  const { data, error, loading, reload } = useAsync<Analysis>(() => matchService.analysis(id), [id]);
  const [side, setSide] = useState<"home" | "away">("home");
  const [minEdge, setMinEdge] = useState(3);
  const [shot, setShot] = useState<Shot | null>(null);
  const [momentId, setMomentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MomentDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [retry, setRetry] = useState(0);

  // Load the chosen moment (from the explorer or a shot click).
  useEffect(() => {
    if (!momentId) return;
    let alive = true;
    setDetail(null);
    setDetailErr(null);
    matchService
      .moment(id, momentId)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setStep(Math.max(0, d.sequence.length - 1));
      })
      .catch((e: unknown) => alive && setDetailErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [id, momentId, retry]);

  useEffect(() => {
    if (!playing || !detail) return;
    if (step >= detail.sequence.length - 1) {
      setPlaying(false);
      return;
    }
    const tid = window.setTimeout(() => setStep((s) => s + 1), 750);
    return () => window.clearTimeout(tid);
  }, [playing, step, detail]);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data)
    return (
      <div className="tactics-grid">
        <SkeletonCard h={360} />
        <SkeletonCard h={260} />
      </div>
    );

  const team = side === "home" ? match.home : match.away;
  const tactics = data.tactics[side];
  const stats = data.stats[side];
  const color = side === "home" ? colors.home : colors.away;
  const momentsSorted = [...data.moments].sort((a, b) => a.t - b.t);

  const onShot = (s: Shot) => {
    setShot(s);
    const m = data.moments.find((mm) => mm.event_ids.includes(s.event_id));
    setMomentId(m ? m.id : null);
    if (!m) setDetail(null);
  };

  const seq = detail?.sequence ?? [];
  const visible = seq.slice(0, step + 1);
  const atEnd = step >= seq.length - 1;
  const ffEvent = [...visible].reverse().find((e) => e.freeze_frame?.length);
  const freeze = atEnd ? detail?.freeze_frame ?? ffEvent?.freeze_frame ?? null : ffEvent?.freeze_frame ?? null;
  const ffTeam = (atEnd && detail?.freeze_frame ? seq[seq.length - 1]?.team_id : ffEvent?.team_id) ?? detail?.moment.team_id;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="seg" role="tablist" aria-label="Team">
          {(["home", "away"] as const).map((s) => (
            <button key={s} role="tab" aria-selected={side === s} className={cx(side === s && "on")} onClick={() => setSide(s)}>
              <span className="swatch" style={{ background: s === "home" ? colors.home : colors.away, marginInlineEnd: 6 }} />
              {s === "home" ? match.home.name : match.away.name}
            </button>
          ))}
        </div>
        <span className="xs muted">Full match · {data.minute}'</span>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="label">Shape</div>
          <div className="value">{tactics.formation.detected}</div>
          <div className="sub">{Math.round(tactics.formation.confidence * 100)}% confidence</div>
        </div>
        <div className="kpi">
          <div className="label">xG</div>
          <div className="value tnum">{stats.xg.toFixed(2)}</div>
          <div className="sub">{stats.shots} shots · {stats.big_chances} big chances</div>
        </div>
        <div className="kpi">
          <div className="label">PPDA</div>
          <div className="value tnum">{stats.ppda.toFixed(1)}</div>
          <div className="sub">lower = higher press</div>
        </div>
        <div className="kpi">
          <div className="label">Field tilt</div>
          <div className="value tnum">{Math.round(stats.field_tilt * 100)}%</div>
          <div className="sub">share of final-third passes</div>
        </div>
        <div className="kpi">
          <div className="label">Line height</div>
          <div className="value tnum">{tactics.avg_line_height.toFixed(0)}m</div>
          <div className="sub">avg outfield position</div>
        </div>
        <div className="kpi">
          <div className="label">xT</div>
          <div className="value tnum">{stats.xt.toFixed(2)}</div>
          <div className="sub">threat added by passes and carries</div>
        </div>
      </div>

      <div className="tactics-grid">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Pass network · {team.short}</h2>
            <span className="spacer" />
            <label className="row xs muted" style={{ gap: 6 }}>
              Min passes
              <input type="range" min={1} max={10} value={minEdge} onChange={(e) => setMinEdge(Number(e.target.value))} aria-label="Minimum passes per link" />
              <b className="tnum">{minEdge}</b>
            </label>
          </div>
          <PassNetworkChart network={tactics.pass_network} color={color} minCount={minEdge} />
          <div className="pitch-caption">
            Average positions in possession; node size = touches, line weight = passes between the pair. {team.short} attack →
          </div>
        </section>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Shape shifts</h2>
            </div>
            {tactics.shifts.length ? (
              <div className="timeline">
                {tactics.shifts.map((s, i) => (
                  <div className="timeline-item" key={i}>
                    <div>
                      <b className="tnum">{s.minute}'</b> {s.from} → <b>{s.to}</b>
                    </div>
                    <div className="muted small">{s.explanation}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="♟">No shape change detected: {team.short} held a {tactics.formation.detected} throughout.</EmptyState>
            )}
          </section>
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Attacking channels · {team.short}</h2>
            </div>
            <ChannelBars channels={tactics.channels} color={color} />
          </section>
          {data.pass_profile ? (
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Pass profile · {team.short}</h2>
                <ModelTag />
              </div>
              <PassProfileCard p={data.pass_profile[side]} color={color} />
            </section>
          ) : null}
        </div>
      </div>

      {data.control_chaos?.length ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Control vs chaos</h2>
            <ModelTag />
            <span className="spacer" />
            <span className="xs muted">green = one side in control · red = possession flipping, low completion</span>
          </div>
          <ChaosBand series={data.control_chaos} />
        </section>
      ) : null}

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Pressing intensity (PPDA)</h2>
            <span className="spacer" />
            <div className="legend">
              <span><i style={{ background: colors.home }} />{match.home.short}</span>
              <span><i style={{ background: colors.away }} />{match.away.short}</span>
            </div>
          </div>
          <PpdaChart home={data.tactics.home.ppda} away={data.tactics.away.ppda} homeColor={colors.home} awayColor={colors.away} />
          <div className="xs faint">Passes allowed per defensive action in the opponent's 60%. Shorter bars mean a more aggressive press.</div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Top performers</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Rating</th>
                  <th>xG</th>
                  <th>xT</th>
                  <th>Key passes</th>
                  {data.top_players.some((p) => p.top_speed_kmh !== undefined) ? <th title="Modelled top speed">Top speed</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.top_players.map((p) => (
                  <tr key={p.player_id}>
                    <td>
                      <span className="swatch" style={{ background: p.team_id === match.home.team_id ? colors.home : colors.away, marginInlineEnd: 6 }} />
                      <span title={placeholders.has(p.player_id) ? "No player name in the dataset" : undefined}>
                        <PlayerLink name={p.name} playerKey={p.player_key ?? keys.get(p.player_id)} placeholder={placeholders.has(p.player_id)} />
                      </span>{" "}
                      <span className="faint xs">#{p.shirt} {p.position}</span>
                    </td>
                    <td className="tnum"><b>{p.rating.toFixed(1)}</b></td>
                    <td className="tnum">{p.xg.toFixed(2)}</td>
                    <td className="tnum">{p.xt.toFixed(2)}</td>
                    <td className="tnum">{p.key_passes}</td>
                    {data.top_players.some((q) => q.top_speed_kmh !== undefined) ? (
                      <td className="tnum">{p.top_speed_kmh !== undefined ? `${p.top_speed_kmh.toFixed(1)} km/h` : "–"}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="tactics-grid">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Shot map</h2>
            <span className="spacer" />
            <span className="xs muted">click a shot to explain its xG</span>
          </div>
          <ShotMap shots={data.shots} homeId={match.home.team_id} homeColor={colors.home} awayColor={colors.away} selected={shot?.event_id} onSelect={onShot} />
          <div className="pitch-legend">
            <span><i className="swatch" style={{ background: "#22d68a" }} />Goal</span>
            <span><i className="swatch" style={{ background: "#ffb224" }} />Saved / post</span>
            <span><i className="swatch" style={{ background: "#9aa6bd" }} />Blocked</span>
            <span><i className="swatch" style={{ background: "#ff5c5c" }} />Off target</span>
            <span>Size = xG · {match.home.short} attack →</span>
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Why that xG?</h2>
          </div>
          {shot ? (
            <div className="stack" style={{ gap: 10 }}>
              <div className="small">
                <b>{shot.minute}'</b> {shot.player_name} · {shot.situation?.replace("_", " ")} · {shot.body_part?.replace("_", " ")} ·{" "}
                <b>{shot.outcome?.replace("_", " ")}</b>
              </div>
              {detail?.xg_breakdown && detail.xg_breakdown.event_id === shot.event_id ? (
                <XgWaterfall breakdown={detail.xg_breakdown} />
              ) : momentId && !detail && !detailErr ? (
                <Skeleton h={160} />
              ) : (
                <div className="note">
                  xG <b className="tnum">{shot.xg.toFixed(2)}</b>. This shot wasn't flagged as a key moment, so there's no full model breakdown.
                  Shots with a breakdown appear in the moment explorer below.
                </div>
              )}
            </div>
          ) : (
            <EmptyState icon="🎯">Select a shot on the map to see what drove its expected-goals value.</EmptyState>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Moment explorer</h2>
          <span className="spacer" />
          <span className="xs muted">replay any moment's possession, step by step</span>
        </div>
        <div className="tactics-grid">
          <div>
            {detail ? (
              <>
                <Pitch label="Moment replay">
                  <EventLayer
                    events={visible}
                    homeId={match.home.team_id}
                    homeColor={colors.home}
                    awayColor={colors.away}
                    freezeFrame={freeze}
                    freezeFrameTeam={ffTeam}
                    shirts={shirts}
                    names={names}
                    activeId={visible[visible.length - 1]?.id}
                  />
                </Pitch>
                <div className="stepper" style={{ marginTop: 10 }}>
                  <button className="btn sm" onClick={() => { setPlaying(false); setStep(0); }} disabled={step === 0} aria-label="First event"><IconToStart /></button>
                  <button className="btn sm" onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }} disabled={step === 0} aria-label="Previous event"><IconStepBack /></button>
                  <button
                    className="btn sm primary"
                    onClick={() => {
                      if (atEnd) setStep(0);
                      setPlaying((p) => !p);
                    }}
                  >
                    {playing ? <><IconPause /> Pause</> : <><IconPlay /> Play</>}
                  </button>
                  <button className="btn sm" onClick={() => { setPlaying(false); setStep((s) => Math.min(seq.length - 1, s + 1)); }} disabled={atEnd} aria-label="Next event"><IconStepForward /></button>
                  <span className="xs muted tnum">
                    {step + 1}/{seq.length}
                  </span>
                  <span className="small">{visible[visible.length - 1] ? describeEvent(visible[visible.length - 1]) : ""}</span>
                  <EventDetail e={visible[visible.length - 1]} />
                </div>
                <div className="note" style={{ marginTop: 10 }}>
                  <b>{detail.moment.title}.</b> {detail.moment.explanation.why_it_matters}
                </div>
                {detail.xg_breakdown ? (
                  <details className="disclosure" style={{ marginTop: 10 }}>
                    <summary>xG model breakdown</summary>
                    <div style={{ marginTop: 10 }}>
                      <XgWaterfall breakdown={detail.xg_breakdown} />
                    </div>
                  </details>
                ) : null}
              </>
            ) : detailErr ? (
              <ErrorState message={detailErr} onRetry={() => setRetry((r) => r + 1)} />
            ) : momentId ? (
              <Skeleton h={340} />
            ) : (
              <EmptyState icon="🎬">Pick a moment to replay the move that led to it.</EmptyState>
            )}
          </div>
          <div className="explorer-list" role="listbox" aria-label="Moments">
            {momentsSorted.map((m) => (
              <button
                key={m.id}
                role="option"
                aria-selected={momentId === m.id}
                className={cx("explorer-item", momentId === m.id && "on")}
                onClick={() => {
                  setShot(null);
                  setPlaying(false);
                  setMomentId(m.id);
                }}
              >
                <b className="tnum display" style={{ fontSize: 17, minWidth: 40 }}>
                  {clock(m.minute, m.added_minute)}
                </b>
                <span aria-hidden="true">{MOMENT_ICON[m.type]}</span>
                <span className="small" style={{ flex: 1 }}>
                  {m.title}
                </span>
                <span className="xs faint tnum">{Math.round(m.importance)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/** Brief features: how long, how risky and how successful a team's passing is, by difficulty band. */
function PassProfileCard({ p, color }: { p: PassProfile; color: string }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="kpi">
          <div className="label">Avg length</div>
          <div className="value tnum" style={{ fontSize: 22 }}>{p.avg_length.toFixed(1)}m</div>
        </div>
        <div className="kpi">
          <div className="label">Long passes</div>
          <div className="value tnum" style={{ fontSize: 22 }}>{Math.round(p.long_share * 100)}%</div>
        </div>
        <div className="kpi">
          <div className="label">Avg difficulty</div>
          <div className="value tnum" style={{ fontSize: 22 }}>{Math.round(p.avg_difficulty * 100)}</div>
          <div className="sub">/100</div>
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {p.completion_by_difficulty.map((b) => (
          <div key={b.band} className="pp-row">
            <span className="xs muted" style={{ textTransform: "capitalize" }}>{b.band}</span>
            <div className="pp-track" role="img" aria-label={`${b.band} passes: ${Math.round(b.completion * 100)}% completed of ${b.attempts}`}>
              <span style={{ width: `${Math.round(b.completion * 100)}%`, background: color }} />
            </div>
            <b className="tnum xs">{Math.round(b.completion * 100)}%</b>
            <span className="xs faint tnum">{b.attempts}</span>
          </div>
        ))}
      </div>
      <div className="xs faint">Completion by difficulty band; difficulty comes from the engine's pass-success model (distance, pressure, angle).</div>
    </div>
  );
}
