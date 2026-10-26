import type { H2H, MatchMeta } from "../api/types";
import { playerIndex } from "../lib/players";
import { PlayerLink } from "./ScoutViz";
import { RealTag } from "./SourceBadge";
import { TeamLink, TeamSwatch } from "./TeamSwatch";

/** Real facts of the fixture: final score, goals with scorers and assists, pre-match Elo. */
export function MatchFacts({ match, homeColor, awayColor }: { match: MatchMeta; homeColor: string; awayColor: string }) {
  const real = match.source?.real;
  const goals = [...(real?.goals ?? [])].sort((a, b) => a.minute - b.minute);
  const isWhatIf = match.source?.kind === "what_if";
  const { byName } = playerIndex(match);
  return (
    <div className="stack gap-12">
      <div className="row justify-between">
        <span className="small muted">
          {isWhatIf ? "Synthetic what-if score" : "Final score"} {isWhatIf ? null : <RealTag />}
        </span>
        <b className="display tnum fs-26">
          {match.final_score.home}–{match.final_score.away}
        </b>
      </div>
      {goals.length ? (
        <div>
          <div className="xs muted mb-6">
            Goals <RealTag />
          </div>
          <ul className="goal-list">
            {goals.map((g, i) => {
              const home = g.team_id === match.home.team_id;
              return (
                <li key={i}>
                  <span className="min tnum" style={{ color: home ? homeColor : awayColor }}>
                    {g.minute}'
                  </span>
                  <span>
                    <b>
                      <PlayerLink name={g.scorer} playerKey={byName.get(g.scorer)?.player_key} />
                    </b>
                    {g.penalty ? <span className="pill ms-6 py-0 px-6">pen</span> : null}
                    {g.own_goal ? <span className="pill danger ms-6 py-0 px-6">OG</span> : null}
                    <span className="muted"> · {home ? match.home.short : match.away.short}</span>
                    {g.assist ? (
                      <div className="xs muted">
                        Assist: <PlayerLink name={g.assist} playerKey={byName.get(g.assist)?.player_key} />
                      </div>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : real ? (
        <div className="xs muted">No goals recorded in the dataset for this match.</div>
      ) : null}
      {match.elo ? (
        <div>
          <div className="xs muted mb-6">
            Pre-match Elo <RealTag title="Computed from every prior real result since 1872" />
          </div>
          <EloCompare home={match.elo.home} away={match.elo.away} homeName={match.home.short} awayName={match.away.short} homeColor={homeColor} awayColor={awayColor} />
        </div>
      ) : null}
    </div>
  );
}

function EloCompare({ home, away, homeName, awayName, homeColor, awayColor }: { home: number; away: number; homeName: string; awayName: string; homeColor: string; awayColor: string }) {
  // Elo expected score (no home advantage term: many fixtures are on neutral ground)
  const expHome = 1 / (1 + 10 ** ((away - home) / 400));
  return (
    <div className="stack gap-6">
      <div className="row justify-between">
        <span>
          <b className="tnum">{Math.round(home)}</b> <span className="muted small">{homeName}</span>
        </span>
        <span>
          <span className="muted small">{awayName}</span> <b className="tnum">{Math.round(away)}</b>
        </span>
      </div>
      <div className="h2h-bar">
        <span style={{ width: `${expHome * 100}%`, background: homeColor }} />
        <span style={{ width: `${(1 - expHome) * 100}%`, background: awayColor }} />
      </div>
      <div className="xs faint">
        Elo expectation: {homeName} {Math.round(expHome * 100)}% · {awayName} {Math.round((1 - expHome) * 100)}%
      </div>
    </div>
  );
}

/** Broadcast-style head-to-head card. */
export function HeadToHead({
  h2h, home, away, homeColor, awayColor,
}: { h2h: H2H; home: MatchMeta["home"]; away: MatchMeta["away"]; homeColor: string; awayColor: string }) {
  const total = Math.max(1, h2h.played);
  return (
    <div className="stack gap-12">
      <div className="row justify-between">
        <span className="row gap-8">
          <TeamSwatch team={home} size="sm" />
          <TeamLink team={home} />
        </span>
        <span className="xs muted">
          {h2h.played} meetings <RealTag />
        </span>
        <span className="row gap-8">
          <TeamLink team={away} />
          <TeamSwatch team={away} size="sm" />
        </span>
      </div>
      <div className="h2h-nums">
        <div>
          <b style={{ color: homeColor }}>{h2h.home_wins}</b>
          <span className="xs muted">Wins</span>
        </div>
        <div>
          <b>{h2h.draws}</b>
          <span className="xs muted">Draws</span>
        </div>
        <div>
          <b style={{ color: awayColor }}>{h2h.away_wins}</b>
          <span className="xs muted">Wins</span>
        </div>
      </div>
      <div className="h2h-bar" aria-hidden="true">
        <span style={{ width: `${(h2h.home_wins / total) * 100}%`, background: homeColor }} />
        <span className="bg-text-faint" style={{ width: `${(h2h.draws / total) * 100}%` }} />
        <span style={{ width: `${(h2h.away_wins / total) * 100}%`, background: awayColor }} />
      </div>
      <div className="xs muted text-center">
        Goals {h2h.home_goals}–{h2h.away_goals}
      </div>
      {h2h.last.length ? (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {h2h.last.slice(0, 6).map((m, i) => (
                <tr key={i}>
                  <td className="mono faint">{m.date}</td>
                  <td>
                    {m.home_team} <b className="tnum">{m.home_score}–{m.away_score}</b> {m.away_team}
                  </td>
                  <td className="xs muted">{m.tournament}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
