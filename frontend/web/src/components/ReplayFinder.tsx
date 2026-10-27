import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { forgeService, referenceService } from "../api";
import type { RealResult } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { usePrefs } from "../lib/prefs";
import { RealTag } from "./SourceBadge";
import { EmptyState, ErrorState, Skeleton } from "./States";
import { IconPlay } from "./icons";

/**
 * Search a team's real results (150 years, CC0) and replay one: the engine rebuilds it in about a second with the real
 * score, scorers and goal minutes, and synthetic play between them. `?replay=<team id>` opens it on that team.
 */
export function ReplayFinder() {
  const { t } = usePrefs();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const teams = useAsync(() => referenceService.teams(400), []);
  const sorted = useMemo(() => [...(teams.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [teams.data]);
  const [team, setTeam] = useState(params.get("replay") ?? "");
  const [opponent, setOpponent] = useState(params.get("opponent") ?? "");
  const [year, setYear] = useState("");
  const [building, setBuilding] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const results = useAsync<RealResult[] | null>(
    () => (team ? forgeService.realResults(team, opponent || undefined, /^\d{4}$/.test(year) ? Number(year) : undefined) : Promise.resolve(null)),
    [team, opponent, year],
  );

  useEffect(() => {
    if (params.get("replay")) document.getElementById("replay")?.scrollIntoView({ block: "start" });
  }, [params]);

  const replay = async (r: RealResult) => {
    setBuilding(r.match_id);
    setFailed(null);
    try {
      await forgeService.replay(r.match_id);
      navigate(`/match/${r.match_id}`);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(null);
    }
  };

  return (
    <section className="card" id="replay">
      <div className="card-head">
        <h2 className="card-title">Replay a real match</h2>
        <RealTag title="Real score, scorers and goal minutes from the CC0 dataset; the play between the goals is synthetic" />
      </div>
      <p className="small muted mb-12 max-70ch">
        Pick a team to see its real results since 1872. Replay rebuilds a match with its real score, scorers and goal minutes,
        and synthetic play between them, so you can watch it with live narration, tactics and Ask Regista. Where the dataset
        doesn't record who scored, the score stays real and the goals are modelled, with nobody named.
      </p>
      <div className="row gap-10 wrap mb-12">
        <select className="select" value={team} onChange={(e) => { setTeam(e.target.value); setOpponent(""); }} aria-label="Team">
          <option value="">Choose a team…</option>
          {sorted.map((x) => <option key={x.team_id} value={x.team_id}>{x.name}</option>)}
        </select>
        <select className="select" value={opponent} onChange={(e) => setOpponent(e.target.value)} aria-label="Opponent" disabled={!team}>
          <option value="">Any opponent</option>
          {sorted.filter((x) => x.team_id !== team).map((x) => <option key={x.team_id} value={x.team_id}>{x.name}</option>)}
        </select>
        <input className="input year-input" inputMode="numeric" placeholder="Year (optional)" value={year} maxLength={4}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} aria-label="Year" disabled={!team} />
      </div>
      {failed ? <p className="small text-danger mb-8">{failed}</p> : null}
      {!team ? null : results.error ? (
        <ErrorState message={results.error} onRetry={results.reload} />
      ) : results.loading || teams.loading ? (
        <Skeleton h={120} />
      ) : !results.data?.length ? (
        <EmptyState>No real results match. Try another opponent or year.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {results.data.map((r) => (
                <tr key={r.match_id}>
                  <td className="mono faint">{r.date}</td>
                  <td>
                    {r.home_team} <b className="tnum">{r.home_score}–{r.away_score}</b> {r.away_team}
                    {r.shootout_winner ? <span className="xs muted"> · {r.shootout_winner} won on penalties</span> : null}
                  </td>
                  <td className="xs muted">{r.tournament}<div className="faint">{r.city}</div></td>
                  <td className="text-end">
                    {r.replayable ? (
                      <div className="stack gap-4 items-end">
                        <button className="btn sm primary" onClick={() => void replay(r)} disabled={building !== null}
                          aria-busy={building === r.match_id}>
                          <IconPlay /> {t("live.play")}
                        </button>
                        {r.goals_modelled && r.home_score + r.away_score > 0 ? (
                          <span className="xs muted" title="The dataset has this score but not who scored or when: the replay models the goal minutes and names nobody">
                            Scorers not recorded: goals modelled
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="xs faint" title={r.reason ?? undefined}>{r.reason}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
