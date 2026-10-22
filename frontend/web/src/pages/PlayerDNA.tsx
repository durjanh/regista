import { Link, useParams } from "react-router-dom";
import { referenceService, scoutingService } from "../api";
import type { PlayerDNA as PlayerDNAT } from "../api/types";
import { AdviceCards, ChannelArrows, GoalMouth, HalfPitchShots, PercentileBar, SplitBar } from "../components/ScoutViz";
import { InfoPop, ModelTag, RealTag } from "../components/SourceBadge";
import { ErrorState, Skeleton, SkeletonCard } from "../components/States";
import { useAsync } from "../hooks/useAsync";
import { readableOn } from "../lib/format";
import { teamReportPath } from "../lib/players";
import { usePrefs } from "../lib/prefs";
import { IconBack } from "../components/icons";

const pct = (v: number) => `${Math.round(v * 100)}%`;

function initials(name: string): string {
  if (/ No\. \d+$/.test(name)) return name.split("No. ")[1] ?? "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

export function PlayerDNA() {
  const { key = "" } = useParams();
  const { t } = usePrefs();
  const { data, error, loading, reload } = useAsync<PlayerDNAT>(() => scoutingService.playerDNA(key), [key]);
  const team = useAsync(() => referenceService.team(key.split(":")[0] ?? ""), [key]);

  if (error)
    return (
      <div className="card">
        <ErrorState message={error.includes("404") || /not found|unknown/i.test(error) ? "No scouting profile for this player yet." : error} onRetry={reload} />
      </div>
    );
  if (loading || !data)
    return (
      <div className="stack">
        <Skeleton h={64} w="50%" />
        <SkeletonCard h={160} />
        <SkeletonCard h={220} />
      </div>
    );

  const color = team.data?.colors.primary ?? "var(--accent)";
  const ink = team.data ? readableOn(team.data.colors.primary) : "var(--accent-ink)";
  const placeholder = data.name_source === "placeholder";
  const real = data.real;
  const m = data.model;
  const isKeeper = data.position === "GK" || !!m.goalkeeping;
  const maxPeriod = Math.max(1, ...(real?.goals_by_period.map((g) => g.goals) ?? [1]));

  return (
    <div className="stack">
      <div className="scout-head">
        <div className="scout-avatar" style={{ background: color, color: ink }} aria-hidden="true">
          {initials(data.name)}
        </div>
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title" style={{ fontSize: "clamp(26px, 4vw, 38px)" }}>
            <span className={placeholder ? "placeholder-name" : undefined}>{data.name}</span>
          </h1>
          <div className="row small muted" style={{ gap: 8, flexWrap: "wrap" }}>
            <Link to={teamReportPath(data.team_id)} className="team-link">
              {data.team_name}
            </Link>
            <span>·</span>
            <span className="pill" style={{ padding: "0 7px" }}>
              {data.position}
            </span>
            {placeholder ? <span className="xs faint">No name in the dataset: shown by shirt number</span> : null}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <InfoPop text={data.disclosure} label="Where these numbers come from" />
        <Link to="/scouting" className="btn sm">
          <IconBack /> {t("scout.title")}
        </Link>
      </div>

      {/* ---------------- REAL ---------------- */}
      <div className="section-band">
        <h2>{t("scout.real")}</h2>
        <RealTag title="From the CC0 international results dataset (goalscorers table)" />
        <span className="line" />
      </div>
      {real ? (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="label">International goals</div>
              <div className="value tnum">{real.international_goals}</div>
              <div className="sub">
                {real.first_goal} → {real.last_goal}
              </div>
            </div>
            <div className="kpi">
              <div className="label">Penalty goals</div>
              <div className="value tnum">{real.penalty_goals}</div>
              <div className="sub">{real.international_goals ? pct(real.penalty_goals / real.international_goals) : "0%"} of his goals</div>
            </div>
            <div className="kpi">
              <div className="label">Assists recorded</div>
              <div className="value tnum">{real.assists_recorded}</div>
              <div className="sub">assists are recorded for major tournaments</div>
            </div>
            <div className="kpi">
              <div className="label">v top-30 Elo teams</div>
              <div className="value tnum">{real.vs_top30_elo}</div>
              <div className="sub">goals against elite opposition</div>
            </div>
          </div>
          <div className="two-col">
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">When he scores</h2>
                <RealTag />
              </div>
              <div className="period-bars" role="img" aria-label={real.goals_by_period.map((g) => `${g.bin}: ${g.goals}`).join(", ")}>
                {real.goals_by_period.map((g) => (
                  <div key={g.bin} className="col">
                    <b className="tnum xs">{g.goals}</b>
                    <div className="b" style={{ height: `${(g.goals / maxPeriod) * 80}%` }} />
                    <span className="xs faint">{g.bin}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Home, away, neutral</h2>
                <RealTag />
              </div>
              <SplitBar
                parts={[
                  { label: t("scout.home"), value: real.venue_split.home, color: "#5cc8ff" },
                  { label: t("scout.away"), value: real.venue_split.away, color: "#c39bff" },
                  { label: t("scout.neutral"), value: real.venue_split.neutral, color: "var(--text-faint)" },
                ]}
              />
              <div className="xs muted" style={{ marginTop: 8 }}>
                Goals: {real.venue_split.home} home · {real.venue_split.away} away · {real.venue_split.neutral} neutral
              </div>
            </section>
          </div>
          {real.recent_goals.length ? (
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Recent goals</h2>
                <RealTag />
              </div>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {real.recent_goals.map((g, i) => (
                      <tr key={i}>
                        <td className="mono faint">{g.date}</td>
                        <td>
                          v <b>{g.opponent}</b>
                        </td>
                        <td className="tnum">
                          {g.minute}'
                          {g.penalty ? (
                            <span className="pill" style={{ marginInlineStart: 6, padding: "0 6px" }}>
                              pen
                            </span>
                          ) : null}
                        </td>
                        <td className="xs muted">{g.tournament}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <div className="note">
          No goals recorded for this player in the dataset. {isKeeper ? "Goalkeepers rarely appear in goalscorer records." : "Defenders and holding midfielders often have no recorded goals."}
        </div>
      )}

      {/* ---------------- MODEL ---------------- */}
      <div className="section-band">
        <h2>{t("scout.model")}</h2>
        <ModelTag />
        <span className="line" />
        <span className="xs muted tnum">
          {m.matches} matches · {Math.round(m.minutes)} minutes
        </span>
      </div>

      <div className="kpis">
        {isKeeper && m.goalkeeping ? (
          <>
            <Kpi label="Save %" value={pct(m.goalkeeping.save_pct)} sub={`${m.goalkeeping.saves}/${m.goalkeeping.shots_faced} shots`} />
            <Kpi label="Goals prevented" value={signed(m.goalkeeping.goals_prevented)} sub={`xG faced ${m.goalkeeping.xg_faced.toFixed(1)} · conceded ${m.goalkeeping.goals_conceded}`} />
            <Kpi label="Penalty save %" value={pct(m.goalkeeping.penalty_save_pct)} sub={`${m.goalkeeping.penalties_faced} penalties faced`} />
            <Kpi label="Long distribution" value={pct(m.goalkeeping.long_distribution_pct > 1 ? m.goalkeeping.long_distribution_pct / 100 : m.goalkeeping.long_distribution_pct)} sub="goal kicks and throws played long" />
            <Kpi label="Distance / 90" value={m.per90.distance_km.toFixed(1)} sub="km" />
          </>
        ) : (
          <>
            <Kpi label="Goals / 90" value={m.per90.goals.toFixed(2)} sub={`xG ${m.per90.xg.toFixed(2)}`} />
            <Kpi label="Shots / 90" value={m.per90.shots.toFixed(1)} sub={`${pct(m.shot_zones.inside_box)} inside the box`} />
            <Kpi label="Threat added / 90" value={m.per90.xt.toFixed(2)} sub="expected threat (xT)" />
            <Kpi label="Key passes / 90" value={m.per90.key_passes.toFixed(2)} sub={`${m.per90.progressive_passes.toFixed(1)} progressive passes`} />
            <Kpi label="Passes / 90" value={m.per90.passes.toFixed(0)} sub={`${pct(m.per90.pass_completion > 1 ? m.per90.pass_completion / 100 : m.per90.pass_completion)} completed`} />
            <Kpi label="Defending / 90" value={(m.per90.tackles + m.per90.interceptions).toFixed(1)} sub={`${m.per90.tackles.toFixed(1)} tackles · ${m.per90.interceptions.toFixed(1)} interceptions`} />
            <Kpi label="Pressures / 90" value={m.per90.pressures.toFixed(1)} sub={`${m.per90.dribbles.toFixed(1)} dribbles`} />
            <Kpi label="Distance / 90" value={m.per90.distance_km.toFixed(1)} sub={`km · ${m.per90.sprints.toFixed(0)} sprints`} />
          </>
        )}
      </div>

      {isKeeper && m.goalkeeping ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Penalty dive tendency</h2>
            <ModelTag />
          </div>
          <GoalMouth
            split={m.goalkeeping.dive}
            title="Where he dives on penalties"
            caption={`Seen from the penalty taker. ${m.goalkeeping.penalties_faced} modelled penalties faced; he saves ${pct(m.goalkeeping.penalty_save_pct)}.`}
          />
        </section>
      ) : null}

      {!isKeeper || m.shot_map.length ? (
        <div className="two-col">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Shot map</h2>
              <ModelTag />
              <span className="spacer" />
              <span className="xs muted">size = xG · filled = goal</span>
            </div>
            <HalfPitchShots shots={m.shot_map} goals={m.goal_map} color={color.startsWith("#") ? color : "#22d68a"} label={`${data.name} shot map`} />
          </section>
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Where he shoots from</h2>
              <ModelTag />
            </div>
            <ChannelArrows split={m.shot_channels} color={color.startsWith("#") ? color : "#22d68a"} label={`${data.name} shot channels`} unit="of his shots" />
            <div style={{ marginTop: 12 }}>
              <div className="xs muted" style={{ marginBottom: 6 }}>
                Foot / head
              </div>
              <SplitBar
                parts={[
                  { label: "Right foot", value: m.foot.right, color: "#22d68a" },
                  { label: "Left foot", value: m.foot.left, color: "#5cc8ff" },
                  { label: "Head", value: m.foot.head, color: "#ffb224" },
                ]}
              />
            </div>
          </section>
        </div>
      ) : null}

      {m.penalties ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("scout.penalties")}</h2>
            <span className="spacer" />
            <span className="tag-row">
              <RealTag /> <ModelTag />
            </span>
          </div>
          <div className="two-col">
            <GoalMouth
              split={m.penalties.placement}
              title="Where he places his penalties"
              caption={`Seen from the taker. Placement modelled over ${m.penalties.modelled_taken} kicks; ${pct(m.penalties.conversion)} converted.`}
            />
            <div className="kpis" style={{ alignContent: "start" }}>
              <div className="kpi">
                <div className="label">
                  Penalty goals <RealTag />
                </div>
                <div className="value tnum">{m.penalties.real_scored}</div>
                <div className="sub">for his country, from the dataset</div>
              </div>
              <div className="kpi">
                <div className="label">
                  Favourite side <ModelTag />
                </div>
                <div className="value" style={{ fontSize: 22 }}>
                  {favourite(m.penalties.placement)}
                </div>
                <div className="sub">keeper's best guess</div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {m.percentiles.length ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("scout.percentiles")}</h2>
            <ModelTag />
            <span className="spacer" />
            <span className="xs muted">percentile vs {data.position} peers</span>
          </div>
          <div className="pct-list">
            {m.percentiles.map((p) => (
              <PercentileBar key={p.metric} p={p} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("scout.strengths")}</h2>
          </div>
          {data.strengths.length ? (
            <ul className="sw-list good">
              {data.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <div className="xs muted">Not enough evidence yet.</div>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("scout.weaknesses")}</h2>
          </div>
          {data.weaknesses.length ? (
            <ul className="sw-list bad">
              {data.weaknesses.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <div className="xs muted">Nothing stands out.</div>
          )}
        </section>
      </div>

      {data.how_to_stop.length ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("scout.howToStop")}</h2>
            <ModelTag />
          </div>
          <AdviceCards items={data.how_to_stop} />
        </section>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value tnum">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

function favourite(split: { left: number; center: number; right: number }): string {
  const [k, v] = Object.entries(split).sort((a, b) => b[1] - a[1])[0] ?? ["center", 0];
  const label = k === "left" ? "Taker's left" : k === "right" ? "Taker's right" : "Centre";
  return `${label} · ${pct(v)}`;
}
