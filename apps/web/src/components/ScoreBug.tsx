import { useEffect, useRef, useState } from "react";
import type { Score, TeamRef } from "../api/types";
import { cx } from "../lib/format";
import { TeamSwatch } from "./TeamSwatch";

type Props = {
  home: TeamRef;
  away: TeamRef;
  score: Score;
  clockLabel: string;
  live?: boolean;
  statusLabel?: string;
};

export function ScoreBug({ home, away, score, clockLabel, live, statusLabel }: Props) {
  const [flash, setFlash] = useState(false);
  const prev = useRef(`${score.home}-${score.away}`);
  useEffect(() => {
    const key = `${score.home}-${score.away}`;
    if (key !== prev.current) {
      prev.current = key;
      setFlash(true);
      const id = window.setTimeout(() => setFlash(false), 1300);
      return () => window.clearTimeout(id);
    }
  }, [score.home, score.away]);

  return (
    <div className="scorebug" role="group" aria-label={`${home.name} ${score.home}, ${away.name} ${score.away}, ${clockLabel}`}>
      <div className="sb-team" style={{ borderTop: `4px solid ${home.colors.primary}` }}>
        <TeamSwatch team={home} size="lg" />
        <span className="name">{home.name}</span>
        <span className="short">{home.short}</span>
      </div>
      <div className="sb-center">
        <div className={cx("sb-score tnum", flash && "score-flash")} aria-live="polite">
          <span>{score.home}</span>
          <span className="sep">–</span>
          <span>{score.away}</span>
        </div>
        <div className={cx("sb-clock tnum", live && "live")}>
          {live ? <span className="dot live" aria-hidden="true" /> : null}
          <span>{clockLabel}</span>
          {statusLabel ? <span className="faint">· {statusLabel}</span> : null}
        </div>
      </div>
      <div className="sb-team away" style={{ borderTop: `4px solid ${away.colors.primary}` }}>
        <TeamSwatch team={away} size="lg" />
        <span className="name">{away.name}</span>
        <span className="short">{away.short}</span>
      </div>
    </div>
  );
}
