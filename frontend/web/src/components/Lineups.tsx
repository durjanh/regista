import { useMemo, useState } from "react";
import type { MatchEvent, MatchMeta, Player, Team } from "../api/types";
import { kitFor, matchKits, type Kit } from "../lib/kits";
import { currentXI } from "../lib/pitchShape";
import { usePrefs } from "../lib/prefs";
import { cx } from "../lib/format";

/** Shirt outline in a 10 × 10 box: sleeves, collar, body. */
const SHIRT = "M3.2 0.6 L1 1.6 L0 4 L1.7 4.6 L2.2 3.6 L2.2 9.6 L7.8 9.6 L7.8 3.6 L8.3 4.6 L10 4 L9 1.6 L6.8 0.6 Q5 2 3.2 0.6 Z";
const POSITION: Record<string, string> = {
  GK: "Goalkeeper", RB: "Right back", CB: "Centre back", LB: "Left back", RWB: "Right wing-back", LWB: "Left wing-back",
  DM: "Defensive midfielder", CM: "Central midfielder", AM: "Attacking midfielder", RW: "Right winger", LW: "Left winger", ST: "Striker",
};

/** "England No. 5" stays as "No. 5": names are never invented. Otherwise the surname. */
const shortName = (p: Player) => (p.name_source === "placeholder" ? `No. ${p.shirt}` : p.name.split(" ").slice(-1)[0]);

function Shirt({ kit, number, x, y, id }: { kit: Kit; number: number; x: number; y: number; id: string }) {
  return (
    <g transform={`translate(${x - 3.4} ${y - 3.6}) scale(0.68)`}>
      {kit.stripe ? (
        <defs>
          <pattern id={id} width="2" height="10" patternUnits="userSpaceOnUse">
            <rect width="1" height="10" fill={kit.shirt} />
            <rect x="1" width="1" height="10" fill={kit.stripe} />
          </pattern>
        </defs>
      ) : null}
      <path d={SHIRT} fill={kit.stripe ? `url(#${id})` : kit.shirt} stroke="rgba(0,0,0,0.35)" strokeWidth="0.25" />
      <text x="5" y="6.9" textAnchor="middle" fontSize="3.6" fontWeight="800" fill={kit.number} paintOrder="stroke"
        stroke={kit.stripe ? kit.shirt : "transparent"} strokeWidth="0.5">{number}</text>
    </g>
  );
}

/**
 * Each team's line-up: its formation on a pitch (the XI as it stands now, substitutes in the place of the player they
 * replaced) and the bench. Kits match the 3D pitch.
 */
export function Lineups({ match, events }: { match: MatchMeta; events: MatchEvent[] }) {
  const { favClubs } = usePrefs();
  const [side, setSide] = useState<"home" | "away">(
    favClubs.includes(match.away.team_id) && !favClubs.includes(match.home.team_id) ? "away" : "home");
  const team: Team = match[side];
  const subs = useMemo(() => events.filter((e) => e.type === "substitution" && e.team_id === team.team_id), [events, team.team_id]);
  const slots = useMemo(() => currentXI(team, subs), [team, subs]);
  const onIds = new Set(slots.map((s) => s.player.player_id));
  const off = new Map(slots.filter((s) => s.replaced).map((s) => [s.replaced!.player_id, s.on]));
  const bench = team.players.filter((p) => !onIds.has(p.player_id));
  const keeper = side === "home" ? "home" : "away";

  // Portrait pitch, attacking upwards: the team's left touchline (y = 68) on the left, its own goal at the bottom.
  const sx = (y: number) => 68 - y;
  const sy = (x: number) => 92 - x;

  return (
    <div className="lineups">
      <div className="row gap-8 mb-10">
        <div className="seg" role="group" aria-label="Team">
          {(["home", "away"] as const).map((s) => (
            <button key={s} className={cx(side === s && "on")} aria-pressed={side === s} onClick={() => setSide(s)}>
              {match[s].short}
            </button>
          ))}
        </div>
        <span className="small"><b>{team.name}</b> · <span className="tnum">{team.formation}</span></span>
      </div>
      <svg className="lineup-pitch" viewBox="-2 -2 72 96" role="img" aria-label={`${team.name} line-up, ${team.formation}`}>
        <rect x="-2" y="-2" width="72" height="96" fill="var(--pitch)" />
        <g fill="none" stroke="var(--pitch-line)" strokeWidth="0.35">
          <rect x="0" y="0" width="68" height="92" />
          <line x1="0" y1={sy(52.5)} x2="68" y2={sy(52.5)} />
          <circle cx="34" cy={sy(52.5)} r="9.15" />
          <rect x={34 - 20.16} y={sy(16.5)} width="40.32" height="16.5" />
          <rect x={34 - 9.16} y={sy(5.5)} width="18.32" height="5.5" />
        </g>
        {slots.map(({ player: p, spot, on }) => {
          const kit = p.position === "GK" ? kitFor(team, keeper) : matchKits(match.home, match.away)[side];
          const x = sx(spot[1]);
          const y = sy(spot[0]);
          return (
            <g key={p.player_id}>
              <title>{`${p.name} · ${POSITION[p.position] ?? p.position} · No. ${p.shirt}${on ? ` · on ${on}'` : ""}`}</title>
              <Shirt kit={kit} number={p.shirt} x={x} y={y} id={`kit-${team.team_id}-${p.player_id}`} />
              <text x={x} y={y + 6.6} textAnchor="middle" className="lineup-name">{shortName(p)}</text>
              {on ? <text x={x + 4.4} y={y - 2.6} className="lineup-sub">↑{on}'</text> : null}
            </g>
          );
        })}
      </svg>
      <div className="lineup-bench">
        <div className="xs muted mb-6">Bench</div>
        <ul>
          {bench.map((p) => (
            <li key={p.player_id} className={cx(off.has(p.player_id) && "faint")}>
              <span className="tnum lineup-no">{p.shirt}</span> {p.name_source === "placeholder" ? `No. ${p.shirt}` : p.name}
              <span className="pill py-0 px-7 ms-6">{p.position}</span>
              {off.has(p.player_id) ? <span className="xs muted ms-6">↓{off.get(p.player_id)}'</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
