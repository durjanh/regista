import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { forgeService, scoutingService } from "../api";
import { PlayerLink } from "../components/ScoutViz";
import { InfoPop, ModelTag } from "../components/SourceBadge";
import { EmptyState, ErrorState, Skeleton } from "../components/States";
import { TeamSwatch } from "../components/TeamSwatch";
import { useAsync } from "../hooks/useAsync";
import { teamReportPath } from "../lib/players";
import { usePrefs } from "../lib/prefs";
import { IconNext } from "../components/icons";
import { PlayerAvatar } from "../components/PlayerAvatar";

const INDEX_NOTE =
  "Profiles combine a REAL record from the international results dataset (competitive goals, penalties, assists, venues; friendlies aren't in its goalscorers) with MODEL tendencies " +
  "rediscovered from Regista's synthetic match events (shot sides, feet, penalty placement, keeper dives, distance, passing).";

export function Scouting() {
  const { t } = usePrefs();
  const players = useAsync(() => scoutingService.players(), []);
  const allTeams = useAsync(() => forgeService.teams(), []);
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("");

  // A report for every team with scouted players (the same teams as the player filter), not only featured fixtures.
  const reportTeams = useMemo(() => {
    const scouted = new Set((players.data ?? []).map((p) => p.team_id));
    return (allTeams.data ?? []).filter((tm) => scouted.has(tm.team_id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [players.data, allTeams.data]);

  const teams = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of players.data ?? []) map.set(p.team_id, p.team_name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [players.data]);

  const kit = useMemo(() => new Map((allTeams.data ?? []).map((tm) => [tm.team_id, tm.colors])), [allTeams.data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = players.data ?? [];
    // Rank by a rating shrunk towards the pool average (3 matches' worth of prior), so one big game does not top the
    // list over a player who has done it eleven times. The table still shows the raw average.
    const rated = all.filter((p) => p.rating != null);
    const prior = rated.length ? rated.reduce((s, p) => s + p.rating, 0) / rated.length : 6.5;
    const ranked = (p: (typeof all)[number]) => ((p.rating ?? prior) * p.matches + prior * 3) / (p.matches + 3);
    return all
      .filter((p) => (!team || p.team_id === team) && (!needle || p.name.toLowerCase().includes(needle) || p.team_name.toLowerCase().includes(needle)))
      .sort((a, b) => ranked(b) - ranked(a));
  }, [players.data, q, team]);

  return (
    <div className="stack">
      <div className="row gap-10 wrap">
        <div>
          <h1 className="page-title">{t("scout.title")}</h1>
          <div className="small muted">Player DNA and opposition reports for coaching staff.</div>
        </div>
        <span className="grow" />
        <InfoPop text={INDEX_NOTE} label="Where these numbers come from" />
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">{t("scout.teamReport")}</h2>
        </div>
        {players.loading || allTeams.loading ? (
          <Skeleton h={40} />
        ) : (
          <div className="chips">
            {reportTeams.map((tm) => (
              <Link key={tm.team_id} to={teamReportPath(tm.team_id)} className="chip">
                <TeamSwatch team={tm} size="sm" /> {tm.name}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Players</h2>
          <ModelTag title="Rating and match count come from synthetic match events" />
          <span className="spacer" />
          <span className="xs muted tnum">{rows.length}</span>
        </div>
        <div className="row gap-10 wrap mb-12">
          <input className="input search-input" placeholder={t("scout.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("scout.search")} />
          <select className="select" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
            <option value="">{t("scout.allTeams")}</option>
            {teams.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          {team ? (
            <Link to={teamReportPath(team)} className="btn">
              {t("scout.teamReport")} <IconNext />
            </Link>
          ) : null}
        </div>
        {players.error ? (
          <ErrorState message={players.error} onRetry={players.reload} />
        ) : players.loading ? (
          <div className="stack">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} h={28} />
            ))}
          </div>
        ) : rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Team</th>
                  <th>Pos</th>
                  <th className="tnum">Matches</th>
                  <th className="tnum">Avg rating</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((p) => (
                  <tr key={p.player_key}>
                    <td>
                      <span className="player-cell">
                        <PlayerAvatar name={p.name} colors={kit.get(p.team_id)} size={28} />
                        <PlayerLink name={p.name} playerKey={p.player_key} placeholder={p.name_source === "placeholder"} />
                      </span>
                    </td>
                    <td>
                      <Link to={teamReportPath(p.team_id)} className="team-link">
                        {p.team_name}
                      </Link>
                    </td>
                    <td>
                      <span className="pill py-0 px-6">
                        {p.position}
                      </span>
                    </td>
                    <td className="tnum">{p.matches}</td>
                    <td className="tnum">
                      <b>{p.rating.toFixed(1)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="🔎">No players match that search.</EmptyState>
        )}
      </section>
    </div>
  );
}
