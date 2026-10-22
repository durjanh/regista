import { Link, useParams } from "react-router-dom";
import { referenceService, scoutingService } from "../api";
import type { TeamDNA as TeamDNAT } from "../api/types";
import { EloChart } from "../components/EloChart";
import { RealTag } from "../components/SourceBadge";
import { ErrorState, Skeleton, SkeletonCard } from "../components/States";
import { TeamSwatch } from "../components/TeamSwatch";
import { useAsync } from "../hooks/useAsync";
import { PlayerLink } from "../components/ScoutViz";
import { slugName, teamReportPath } from "../lib/players";
import { useMemo } from "react";
import { IconBack } from "../components/icons";

export function TeamDNA() {
  const { teamId = "" } = useParams();
  const { data, error, loading, reload } = useAsync<TeamDNAT>(() => referenceService.team(teamId), [teamId]);
  const squad = useAsync(() => scoutingService.players({ team_id: teamId }), [teamId]);
  const known = useMemo(() => new Set((squad.data ?? []).map((p) => p.player_key)), [squad.data]);

  if (error) return <div className="card"><ErrorState message={error} onRetry={reload} /></div>;
  if (loading || !data)
    return (
      <div className="stack">
        <Skeleton h={40} w="40%" />
        <SkeletonCard h={240} />
      </div>
    );

  const r = data.record;
  const winPct = r.played ? r.won / r.played : 0;
  const first = data.elo_history[0]?.date?.slice(0, 4);
  const maxGoals = Math.max(1, ...data.top_scorers.map((s) => s.goals));

  return (
    <div className="stack">
      <div className="row" style={{ gap: 14 }}>
        <TeamSwatch team={data} size="lg" />
        <div>
          <h1 className="page-title" style={{ fontSize: "clamp(28px, 4vw, 40px)" }}>
            {data.name}
          </h1>
          <div className="row xs muted" style={{ gap: 8 }}>
            <span>Team DNA</span>
            <span>·</span>
            <span>
              {first ? `${first}–today` : ""} <RealTag />
            </span>
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <Link to={teamReportPath(data.team_id)} className="btn sm primary">
          🔎 Scouting report
        </Link>
        <Link to="/" className="btn sm">
          <IconBack /> Fixtures
        </Link>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="label">Elo</div>
          <div className="value tnum">{Math.round(data.elo)}</div>
          <div className="sub">World rank #{data.rank}</div>
        </div>
        <div className="kpi">
          <div className="label">Played</div>
          <div className="value tnum">{r.played.toLocaleString()}</div>
          <div className="sub">
            {r.won}W · {r.drawn}D · {r.lost}L
          </div>
        </div>
        <div className="kpi">
          <div className="label">Win rate</div>
          <div className="value tnum">{Math.round(winPct * 100)}%</div>
          <div className="sub">all competitions</div>
        </div>
        <div className="kpi">
          <div className="label">Goals</div>
          <div className="value tnum">{r.gf.toLocaleString()}</div>
          <div className="sub">
            {r.ga.toLocaleString()} conceded · {r.played ? (r.gf / r.played).toFixed(2) : "0"} per game
          </div>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Elo rating history</h2>
          <RealTag title="Computed from every real result in the CC0 dataset" />
        </div>
        <EloChart history={data.elo_history} color={data.colors.primary} />
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Recent results</h2>
            <RealTag />
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {data.recent.map((m, i) => {
                  const res = m.gf > m.ga ? "W" : m.gf < m.ga ? "L" : "D";
                  return (
                    <tr key={i}>
                      <td className="mono faint">{m.date}</td>
                      <td>
                        <span className={res === "W" ? "pill accent" : res === "L" ? "pill danger" : "pill"} style={{ padding: "0 7px", marginInlineEnd: 8 }}>
                          {res}
                        </span>
                        <b className="tnum">
                          {m.gf}–{m.ga}
                        </b>{" "}
                        v {m.opponent}
                      </td>
                      <td className="xs muted">
                        {m.tournament}
                        <div className="faint">{m.city}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">All-time top scorers</h2>
            <RealTag title="Goals recorded in the dataset's goalscorers table (coverage is incomplete for early years)" />
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {data.top_scorers.map((s, i) => (
              <div key={s.name} className="row" style={{ gap: 10 }}>
                <span className="tnum faint" style={{ width: 18 }}>
                  {i + 1}
                </span>
                <span style={{ flex: "0 0 40%", fontWeight: 600 }}>
                  <PlayerLink name={s.name} playerKey={known.has(`${data.team_id}:${slugName(s.name)}`) ? `${data.team_id}:${slugName(s.name)}` : undefined} />
                </span>
                <div style={{ flex: 1, height: 8, background: "var(--surface-3)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ width: `${(s.goals / maxGoals) * 100}%`, height: "100%", background: data.colors.primary }} />
                </div>
                <b className="tnum" style={{ width: 30, textAlign: "end" }}>
                  {s.goals}
                </b>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
