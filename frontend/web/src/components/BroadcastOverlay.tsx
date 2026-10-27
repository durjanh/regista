import { useEffect, useRef, useState } from "react";
import type { MatchMeta, Score } from "../api/types";
import type { Goal } from "../lib/match";

/**
 * Broadcast graphics drawn over the 3D pitch, as a TV picture carries them: a score bug with the clock, a banner
 * when a goal goes in, and a full-time card with every goal minute (and extra time or penalties where there were).
 * HTML over the canvas, so the text stays sharp.
 */
type Props = {
  match: MatchMeta;
  score: Score;
  clockLabel: string;
  goals: Goal[];
  ended: boolean;
  colours: { home: string; away: string };
};

/** "21' Lionel Messi" → "21' Messi"; "21' Pakistan No. 10" stays as "21' No. 10" (no name in the dataset). */
function shortGoal(label: string): string {
  const m = label.match(/^(\S+)\s+(.*)$/);
  if (!m) return label;
  const [, minute, name] = m;
  const unnamed = name.match(/No\. \d+$/);
  return `${minute} ${unnamed ? unnamed[0] : name.split(" ").slice(-1)[0]}`.trim();
}

export function BroadcastOverlay({ match, score, clockLabel, goals, ended, colours }: Props) {
  // A banner for goals that go in while watching, not for those already scored when the view opened or seeked.
  const seen = useRef<Set<string> | null>(null);
  const [banner, setBanner] = useState<Goal | null>(null);
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(goals.map((g) => g.event_id));
      return;
    }
    const fresh = goals.filter((g) => !seen.current!.has(g.event_id));
    fresh.forEach((g) => seen.current!.add(g.event_id));
    if (!fresh.length) return;
    setBanner(fresh[fresh.length - 1]);
    const id = window.setTimeout(() => setBanner(null), 4500);
    return () => window.clearTimeout(id);
  }, [goals]);

  const so = match.shootout;
  const real = match.source?.kind === "real_result";
  const sideRow = (side: "home" | "away") => (
    <div className="bc-ft-row">
      <span className="bc-swatch lg" style={{ background: colours[side] }} />
      <div className="bc-ft-team">
        <b>{match[side].name}</b>
        <span className="bc-ft-goals">{goals.filter((g) => g.side === side).map((g) => shortGoal(g.label)).join(" · ") || " "}</span>
      </div>
      <span className="bc-ft-score tnum">{score[side]}</span>
    </div>
  );

  return (
    // Decorative: the page's score bug and shoot-out panel carry the same information for screen readers.
    <div className="bc-overlay" aria-hidden="true">
      <div className="bc-bug">
        <span className="bc-swatch" style={{ background: colours.home }} />
        <span>{match.home.short}</span>
        <span className="bc-score tnum">{score.home}–{score.away}</span>
        <span>{match.away.short}</span>
        <span className="bc-swatch" style={{ background: colours.away }} />
        <span className="bc-clock tnum">{ended ? "FT" : clockLabel}</span>
      </div>

      {banner && !ended ? (
        <div className="bc-goal">
          <span className="bc-goal-tag">GOAL</span>
          <span className="bc-swatch" style={{ background: colours[banner.side] }} />
          <b>{match[banner.side].name}</b>
          <span>{shortGoal(banner.label)}</span>
          <span className="bc-score tnum">{score.home}–{score.away}</span>
        </div>
      ) : null}

      {ended ? (
        <div className="bc-ft">
          <div className="bc-ft-title">{so || match.extra_time ? "FULL-TIME · AFTER EXTRA TIME" : "FULL-TIME"}</div>
          {sideRow("home")}
          <div className="bc-ft-rule" />
          {sideRow("away")}
          {so ? <div className="bc-ft-note">{match[so.winner].name} win {Math.max(so.home, so.away)}–{Math.min(so.home, so.away)} on penalties</div> : null}
          <div className="bc-ft-foot">
            {real ? (match.source?.goals_modelled ? "Real score · goals modelled · synthetic animation" : "Real result · synthetic animation") : "What-if · synthetic animation"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
