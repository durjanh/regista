import { useMemo } from "react";
import { Link } from "react-router-dom";
import { forgeService, matchService, scoutingService } from "../api";
import type { ScoutingPlayer, TeamRef } from "../api/types";
import { FavouriteToggle } from "../components/FavouriteToggle";
import { EmptyState, ErrorState, Skeleton } from "../components/States";
import { TeamLink, TeamSwatch } from "../components/TeamSwatch";
import { PlayerLink } from "../components/ScoutViz";
import { IconFavourites, IconPlay, IconReport, IconScouting } from "../components/icons";
import { useAsync } from "../hooks/useAsync";
import { teamReportPath } from "../lib/players";
import { usePrefs } from "../lib/prefs";
import { Fixture } from "./Hub";

const NO_COLOURS = { primary: "var(--surface-3)", secondary: "var(--border-strong)", text: "var(--text)" };

/** Every team and player this browser saved as a favourite, with their matches, in one place. */
export function Favourites() {
  const { t, favClubs, favPlayers, toggleFavClub, toggleFavPlayer } = usePrefs();
  const teams = useAsync(() => forgeService.teams(), []);
  const players = useAsync(() => scoutingService.players(), []);
  const matches = useAsync(() => matchService.list(), []);

  const teamById = useMemo(() => {
    const m = new Map<string, TeamRef>();
    for (const x of teams.data ?? []) m.set(x.team_id, x);
    for (const x of matches.data ?? []) for (const side of [x.home, x.away]) if (!m.has(side.team_id)) m.set(side.team_id, side);
    return m;
  }, [teams.data, matches.data]);
  const playerByKey = useMemo(() => new Map((players.data ?? []).map((p) => [p.player_key, p])), [players.data]);

  const favTeams = favClubs.map((id) => teamById.get(id) ?? { team_id: id, name: id, short: id.slice(0, 3).toUpperCase(), colors: NO_COLOURS });
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
              <div className="stack gap-10">
                {favTeams.map((tm) => (
                  <div key={tm.team_id} className="row gap-10 wrap">
                    <TeamSwatch team={tm} />
                    <span className="fw-700"><TeamLink team={tm} /></span>
                    <span className="grow" />
                    <Link to={teamReportPath(tm.team_id)} className="btn sm"><IconReport /> {t("scout.teamReport")}</Link>
                    <FavouriteToggle name={tm.name} on onToggle={() => toggleFavClub(tm.team_id)} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">No teams saved. Press ☆ {t("fav.add")} on a team's page.</p>
            )}
          </section>

          <section className="card">
            <div className="card-head"><h2 className="card-title">Players</h2><span className="spacer" /><span className="xs muted tnum">{favPlayers.length}</span></div>
            {favPlayerRows.length ? (
              <div className="stack gap-10">
                {favPlayerRows.map((p) => {
                  const m = matchFor(p.team_id);
                  return (
                    <div key={p.player_key} className="row gap-10 wrap">
                      <span className="fw-700"><PlayerLink name={p.name} playerKey={p.player_key} /></span>
                      <span className="small muted">{p.team_name} · <span className="pill py-0 px-7">{p.position}</span></span>
                      <span className="grow" />
                      {m ? (
                        <Link to={`/match/${m.match_id}?view=player`} className="btn sm"><IconPlay /> {t("view.player")}</Link>
                      ) : null}
                      <FavouriteToggle name={p.name} on onToggle={() => toggleFavPlayer(p.player_key)} />
                    </div>
                  );
                })}
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
              <div className="card"><EmptyState>None of the matches here involve your teams or players' teams yet.</EmptyState></div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
