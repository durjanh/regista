import { useMemo } from "react";
import { Link } from "react-router-dom";
import { matchService, referenceService, scoutingService } from "../api";
import type { ReferenceTeam, ScoutingPlayer } from "../api/types";
import { FavouriteToggle } from "../components/FavouriteToggle";
import { EmptyState, ErrorState, Skeleton } from "../components/States";
import { TeamSwatch } from "../components/TeamSwatch";
import { PlayerAvatar } from "../components/PlayerAvatar";
import { PlayerLink } from "../components/ScoutViz";
import { IconDNA, IconFavourites, IconPlay, IconReport, IconScouting } from "../components/icons";
import { useAsync } from "../hooks/useAsync";
import { scoutingPath, teamReportPath } from "../lib/players";
import { usePrefs } from "../lib/prefs";
import { Fixture } from "./Hub";

const NO_COLOURS = { primary: "var(--surface-3)", secondary: "var(--border-strong)", text: "var(--text)" };

/** Every team and player this browser saved as a favourite, with their matches, in one place. */
export function Favourites() {
  const { t, favClubs, favPlayers, toggleFavClub, toggleFavPlayer } = usePrefs();
  const teams = useAsync(() => referenceService.teams(400), []);
  const players = useAsync(() => scoutingService.players(), []);
  const matches = useAsync(() => matchService.list(), []);

  const teamById = useMemo(() => new Map<string, ReferenceTeam>((teams.data ?? []).map((x) => [x.team_id, x])), [teams.data]);
  const playerByKey = useMemo(() => new Map((players.data ?? []).map((p) => [p.player_key, p])), [players.data]);

  const favTeams: ReferenceTeam[] = favClubs.map((id) => teamById.get(id) ?? { team_id: id, name: id, elo: 0, rank: 0, played: 0, colors: NO_COLOURS });
  const favPlayerRows = favPlayers.map((key) => playerByKey.get(key)).filter((p): p is ScoutingPlayer => !!p);
  const relevant = new Set([...favClubs, ...favPlayerRows.map((p) => p.team_id)]);
  const theirMatches = (matches.data ?? []).filter((m) => relevant.has(m.home.team_id) || relevant.has(m.away.team_id));
  const matchFor = (teamId: string) => (matches.data ?? []).find((m) => m.home.team_id === teamId || m.away.team_id === teamId);

  const loading = teams.loading || players.loading || matches.loading;
  const error = teams.error ?? players.error ?? matches.error;
  const reload = () => {
    teams.reload();
    players.reload();
    matches.reload();
  };

  return (
    <div className="stack gap-22">
      <div>
        <h1 className="page-title row gap-10"><IconFavourites width={30} height={30} /> {t("nav.favourites")}</h1>
        <p className="muted max-70ch">
          The teams and players you saved, in this browser. Matches with your teams are listed first on the Matches page, and
          Matchday's Player focus opens on your player.
        </p>
      </div>

      {error ? (
        <div className="card"><ErrorState message={error} onRetry={reload} /></div>
      ) : loading ? (
        <Skeleton h={160} />
      ) : !favClubs.length && !favPlayers.length ? (
        <div className="card">
          <EmptyState icon="☆">
            Nothing saved yet. Open a team or a player and press <b>☆ {t("fav.add")}</b>: on a player's Player DNA page, a team's
            scouting report or Team DNA page, or Matchday's Player focus and Team focus views.
            <div className="row justify-center gap-8 mt-12">
              <Link to="/scouting" className="btn primary"><IconScouting /> {t("nav.scouting")}</Link>
              <Link to="/" className="btn">{t("nav.hub")}</Link>
            </div>
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="card">
            <div className="card-head"><h2 className="card-title">Teams</h2><span className="spacer" /><span className="xs muted tnum">{favTeams.length}</span></div>
            {favTeams.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Team</th><th className="tnum">Elo</th><th className="tnum">World rank</th><th className="tnum">Matches recorded</th><th /></tr>
                  </thead>
                  <tbody>
                    {favTeams.map((tm) => (
                      <tr key={tm.team_id}>
                        <td>
                          <span className="player-cell">
                            <TeamSwatch team={tm} />
                            <Link to={`/team/${encodeURIComponent(tm.team_id)}`} className="team-link fw-700">{tm.name}</Link>
                          </span>
                        </td>
                        <td className="tnum">{tm.elo ? Math.round(tm.elo) : "-"}</td>
                        <td className="tnum">{tm.rank ? `#${tm.rank}` : "-"}</td>
                        <td className="tnum">{tm.played ? tm.played.toLocaleString() : "-"}</td>
                        <td>
                          <span className="row gap-6 justify-end wrap">
                            <Link to={teamReportPath(tm.team_id)} className="btn sm"><IconReport /> {t("scout.teamReport")}</Link>
                            <Link to={`/?replay=${encodeURIComponent(tm.team_id)}`} className="btn sm"><IconPlay /> Replay a real match</Link>
                            <FavouriteToggle name={tm.name} on onToggle={() => toggleFavClub(tm.team_id)} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="small muted">No teams saved. Press ☆ {t("fav.add")} on a team's page.</p>
            )}
          </section>

          <section className="card">
            <div className="card-head"><h2 className="card-title">Players</h2><span className="spacer" /><span className="xs muted tnum">{favPlayers.length}</span></div>
            {favPlayerRows.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Player</th><th>Team</th><th>Pos</th><th className="tnum">Matches</th><th className="tnum">Avg rating</th><th /></tr>
                  </thead>
                  <tbody>
                    {favPlayerRows.map((p) => {
                      const m = matchFor(p.team_id);
                      return (
                        <tr key={p.player_key}>
                          <td>
                            <span className="player-cell">
                              <PlayerAvatar name={p.name} colors={teamById.get(p.team_id)?.colors} size={28} />
                              <PlayerLink name={p.name} playerKey={p.player_key} placeholder={p.name_source === "placeholder"} />
                            </span>
                          </td>
                          <td><Link to={teamReportPath(p.team_id)} className="team-link">{p.team_name}</Link></td>
                          <td><span className="pill py-0 px-6">{p.position}</span></td>
                          <td className="tnum">{p.matches}</td>
                          <td className="tnum"><b>{p.rating.toFixed(1)}</b></td>
                          <td>
                            <span className="row gap-6 justify-end wrap">
                              <Link to={scoutingPath(p.player_key)} className="btn sm"><IconDNA /> Player DNA</Link>
                              {m ? <Link to={`/match/${m.match_id}?view=player`} className="btn sm"><IconPlay /> {t("view.player")}</Link> : null}
                              <FavouriteToggle name={p.name} on onToggle={() => toggleFavPlayer(p.player_key)} />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="small muted">No players saved. Press ☆ {t("fav.add")} on a player's Player DNA page.</p>
            )}
          </section>

          <section>
            <div className="row justify-between mb-12">
              <h2 className="section-title">Their matches</h2>
              <span className="xs muted">{theirMatches.length} matches</span>
            </div>
            {theirMatches.length ? (
              <div className="fixtures">{theirMatches.map((m) => <Fixture key={m.match_id} m={m} />)}</div>
            ) : (
              <div className="card">
                <EmptyState>
                  None of the featured matches involve your teams or players' teams. Replay one of their real matches instead:
                  <div className="row justify-center gap-8 mt-12 wrap">
                    {[...relevant].map((id) => (
                      <Link key={id} to={`/?replay=${encodeURIComponent(id)}`} className="btn sm">
                        <IconPlay /> {teamById.get(id)?.name ?? id}
                      </Link>
                    ))}
                  </div>
                </EmptyState>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
