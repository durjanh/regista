import type { MatchMeta } from "../api/types";
import { ModelTag } from "./SourceBadge";

/**
 * After full time: "after extra time" and, when the match went to penalties, the shoot-out kick by kick. The winner is
 * real; the dataset doesn't record the kicks, so they are modelled and the takers are shown by shirt number.
 */
export function ShootoutPanel({ match }: { match: MatchMeta }) {
  const so = match.shootout;
  if (!so && !match.extra_time) return null;
  const team = (side: "home" | "away") => match[side];
  return (
    <section className="card shootout" aria-label="Extra time and penalties">
      <div className="row gap-8 wrap">
        {match.extra_time ? <span className="pill">After extra time</span> : null}
        {so ? (
          <>
            <b>{team(so.winner).name} win {Math.max(so.home, so.away)}–{Math.min(so.home, so.away)} on penalties</b>
            <ModelTag title="The winner is real; the dataset doesn't record the kicks, so the shoot-out is modelled and takers are shown by shirt number" />
          </>
        ) : null}
      </div>
      {so ? (
        <div className="shootout-rows mt-10">
          {(["home", "away"] as const).map((side) => (
            <div key={side} className="row gap-8">
              <span className="shootout-team">{team(side).short}</span>
              {so.kicks.filter((k) => k.side === side).map((k, i) => (
                <span key={i} className={`shootout-kick ${k.outcome}`} title={`No. ${k.shirt}: ${k.outcome}, ${k.placement}`}>
                  {k.outcome === "scored" ? "●" : "○"}
                </span>
              ))}
              <b className="tnum ms-auto">{so[side]}</b>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
