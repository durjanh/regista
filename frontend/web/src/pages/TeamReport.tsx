import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { scoutingService } from "../api";
import type { Leader, TeamReport as TeamReportT } from "../api/types";
import { AdviceCards, ChannelArrows, GoalMouth, PlayerLink, RecordTable } from "../components/ScoutViz";
import { InfoPop, ModelTag, RealTag } from "../components/SourceBadge";
import { ErrorState, Skeleton, SkeletonCard } from "../components/States";
import { TeamSwatch } from "../components/TeamSwatch";
import { useAsync } from "../hooks/useAsync";
import { slugName } from "../lib/players";
import { usePrefs } from "../lib/prefs";
import { IconBack, IconDNA } from "../components/icons";
import { FavouriteToggle } from "../components/FavouriteToggle";
import { cx } from "../lib/format";

const pct = (v: number) => `${Math.round((v > 1 ? v / 100 : v) * 100)}%`;

const BOARDS: { key: keyof TeamReportT["model"]["leaders"]; title: string }[] = [
  { key: "top_rated", title: "Top rated" },
  { key: "top_threat", title: "Biggest threat (xT)" },
  { key: "most_distance", title: "Most distance" },
  { key: "most_sprints", title: "Most sprints" },
  { key: "most_passes", title: "Most passes" },
  { key: "most_pressures", title: "Most pressures" },
];

export function TeamReport() {
  const { teamId = "" } = useParams();
  const { t, favClubs, toggleFavClub } = usePrefs();
  const { data, error, loading, reload } = useAsync<TeamReportT>(() => scoutingService.teamReport(teamId), [teamId]);
  const squad = useAsync(() => scoutingService.players({ team_id: teamId }), [teamId]);
  const known = useMemo(() => new Set((squad.data ?? []).map((p) => p.player_key)), [squad.data]);

  if (error) return <div className="card"><ErrorState message={error} onRetry={reload} /></div>;
  if (loading || !data)
    return (
      <div className="stack">
        <Skeleton h={44} w="45%" />
        <SkeletonCard h={160} />
        <SkeletonCard h={220} />
      </div>
    );

  const color = data.colors.primary;
  const keyFor = (name: string) => {
    const k = `${data.team_id}:${slugName(name)}`;
    return known.has(k) ? k : undefined;
  };

  return (
    <div className="stack">
      <div className="row gap-14 wrap">
        <TeamSwatch team={data} size="lg" />
        <div>
          <h1 className="page-title fs-display">
            {data.name}
          </h1>
          <div className="row xs muted gap-8">
            <span>{t("scout.teamReport")}</span>
            <span>·</span>
            <span className="tnum">
              Elo {Math.round(data.elo)}
              {data.rank ? ` · world #${data.rank}` : ""}
            </span>
            <RealTag title="Elo computed from every real result since 1872" />
          </div>
        </div>
        <span className="grow" />
        <FavouriteToggle name={data.name} on={favClubs.includes(data.team_id)} onToggle={() => toggleFavClub(data.team_id)} />
        <InfoPop text={data.disclosure} label="Where these numbers come from" />
        <Link to={`/team/${encodeURIComponent(data.team_id)}`} className="btn sm">
          <IconDNA /> Team DNA
        </Link>
        <Link to="/scouting" className="btn sm">
          <IconBack /> {t("scout.title")}
        </Link>
      </div>

      <div className="section-band">
        <h2>{t("scout.real")}</h2>
        <RealTag />
        <span className="line" />
        <span className="xs muted">since {data.real.since}</span>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Home v away</h2>
            <RealTag />
          </div>
          <RecordTable
            rows={[
              { label: t("scout.overall"), rec: data.real.overall },
              { label: t("scout.home"), rec: data.real.home },
              { label: t("scout.away"), rec: data.real.away },
              { label: t("scout.neutral"), rec: data.real.neutral },
            ]}
          />
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Recent scorers</h2>
            <RealTag />
          </div>
          {data.real.top_scorers_recent.length ? (
            <div className="leader-board">
              {data.real.top_scorers_recent.map((s, i) => {
                const max = Math.max(1, ...data.real.top_scorers_recent.map((x) => x.goals));
                return (
                  <div key={s.name} className="leader-row">
                    <span className="faint tnum">{i + 1}</span>
                    <PlayerLink name={s.name} playerKey={keyFor(s.name)} />
                    <span className="tnum">
                      <b>{s.goals}</b>
                      {s.penalties ? <span className="xs muted"> ({s.penalties} pen)</span> : null}
                    </span>
                    <span className="bar">
                      <span className="bg-data-blue" style={{ width: `${(s.goals / max) * 100}%` }} />
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="xs muted">No recent goals recorded.</div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Last 10 results</h2>
          <RealTag />
        </div>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {data.real.last10.map((m, i) => {
                const res = m.gf > m.ga ? "W" : m.gf < m.ga ? "L" : "D";
                return (
                  <tr key={i}>
                    <td className="mono faint">{m.date}</td>
                    <td>
                      <span className={cx(res === "W" ? "pill accent" : res === "L" ? "pill danger" : "pill", "py-0 px-7 me-8")}>
                        {res}
                      </span>
                      <b className="tnum">
                        {m.gf}–{m.ga}
                      </b>{" "}
                      v {m.opponent}
                    </td>
                    <td className="xs muted">{m.venue}</td>
                    <td className="xs muted">{m.tournament}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="section-band">
        <h2>{t("scout.model")}</h2>
        <ModelTag />
        <span className="line" />
        <span className="xs muted tnum">{data.model.matches} matches</span>
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">{t("scout.leaders")}</h2>
          <ModelTag />
        </div>
        <div className="leaders-grid">
          {BOARDS.map((b) => (
            <LeaderBoard key={b.key} title={b.title} rows={data.model.leaders[b.key] ?? []} color={color} />
          ))}
        </div>
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Attacking channels</h2>
            <ModelTag />
          </div>
          <ChannelArrows split={data.model.attacking_channels} color={color} label={`${data.name} attacking channels`} unit="of final-third entries" />
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Set pieces and goalkeeper</h2>
            <span className="spacer" />
            <span className="tag-row">
              <RealTag /> <ModelTag />
            </span>
          </div>
          <div className="stack gap-12">
            <div>
              <div className="xs muted mb-6">
                Penalty takers
              </div>
              {data.model.penalty_takers.length ? (
                <div className="bench-list">
                  {data.model.penalty_takers.map((p) => (
                    <div key={p.player_key} className="bench-row no-avatar">
                      <PlayerLink name={p.name} playerKey={p.player_key} />
                      <span className="xs muted tnum" title="Real penalty goals from the dataset">
                        {p.real_scored} pen goals <RealTag />
                      </span>
                      <span className="xs tnum" title="Modelled favourite side">
                        {sideLabel(p.favourite_side)} {pct(p.share)} <ModelTag />
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="xs muted">No penalty takers on record.</div>
              )}
            </div>
            {data.model.goalkeeper ? (
              <div>
                <div className="xs muted mb-6">
                  Goalkeeper: <PlayerLink name={data.model.goalkeeper.name} playerKey={data.model.goalkeeper.player_key} /> · saves {pct(data.model.goalkeeper.save_pct)}
                </div>
                <GoalMouth
                  split={splitFromFavourite(data.model.goalkeeper.favourite_dive, data.model.goalkeeper.share)}
                  title="Goalkeeper dive tendency"
                  caption={`Favourite dive: ${sideLabel(data.model.goalkeeper.favourite_dive)} (${pct(data.model.goalkeeper.share)}). Seen from the taker.`}
                />
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {data.danger_men.length ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Danger men</h2>
          </div>
          <div className="advice-list">
            {data.danger_men.map((d) => (
              <article key={d.player_key} className="advice">
                <div className="advice-icon bg-danger-soft" aria-hidden="true">
                  ⚠
                </div>
                <div>
                  <div className="advice-title">
                    <PlayerLink name={d.name} playerKey={d.player_key} />
                  </div>
                  <div className="small">{d.why}</div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {data.how_to_play_against.length ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("scout.howToPlay")}</h2>
            <ModelTag />
          </div>
          <AdviceCards items={data.how_to_play_against} icon="♟" />
        </section>
      ) : null}
    </div>
  );
}

function LeaderBoard({ title, rows, color }: { title: string; rows: Leader[]; color: string }) {
  const max = Math.max(1e-6, ...rows.map((r) => r.value));
  return (
    <div>
      <div className="xs muted mb-6 fw-700 uppercase tracking-wide">
        {title}
      </div>
      {rows.length ? (
        <div className="leader-board">
          {rows.slice(0, 5).map((r, i) => (
            <div key={r.player_key} className="leader-row">
              <span className="faint tnum">{i + 1}</span>
              <PlayerLink name={r.name} playerKey={r.player_key} />
              <span className="tnum">
                <b>{r.value % 1 === 0 ? r.value : r.value.toFixed(r.value >= 10 ? 1 : 2)}</b> <span className="xs muted">{r.unit}</span>
              </span>
              <span className="bar">
                <span style={{ width: `${(r.value / max) * 100}%`, background: color }} />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="xs muted">No data.</div>
      )}
    </div>
  );
}

function sideLabel(side: string): string {
  return side === "left" ? "Taker's left" : side === "right" ? "Taker's right" : side === "center" ? "Centre" : side;
}

function splitFromFavourite(side: string, share: number) {
  const s = Math.max(0, Math.min(1, share > 1 ? share / 100 : share));
  const rest = (1 - s) / 2;
  return {
    left: side === "left" ? s : rest,
    center: side === "center" ? s : rest,
    right: side === "right" ? s : rest,
  };
}
