import type { MatchEvent, Team } from "../api/types";
import { readableOn, toHomeFrame } from "../lib/format";
import { ballPath, currentXI, possessionTeam, shiftedSpot, withPlayer } from "../lib/pitchShape";
import { PlayerDot, project } from "./Pitch";

/**
 * Every player on the 2D pitch, as on the 3D one: each team's XI in its formation, shifted with the ball (MODEL; events
 * record only the player on the ball). Drawn faded under the current move, whose players EventLayer draws on top.
 */
export function ShapeLayer({ events, home, away, homeColor, awayColor }: {
  events: MatchEvent[]; home: Team; away: Team; homeColor: string; awayColor: string;
}) {
  const last = events[events.length - 1];
  if (!last) return null;
  const ball = ballPath(last, home.team_id).to;                                   // where the ball is now, home frame
  const poss = possessionTeam(events.slice(-12));
  const inMove = new Set(events.slice(-12).filter((e) => e.possession_id === last.possession_id)
    .flatMap((e) => [e.player_id, e.recipient_id]).filter(Boolean));
  const sides = [{ team: home, isHome: true, colour: homeColor }, { team: away, isHome: false, colour: awayColor }];

  return (
    <g aria-hidden="true">
      {sides.flatMap(({ team, isHome, colour }) => {
        let slots = currentXI(team, events);
        if (last.team_id === team.team_id) slots = withPlayer(withPlayer(slots, team.players, last.player_id), team.players, last.recipient_id);
        const ballOwn = toHomeFrame(ball[0], ball[1], isHome);
        return slots
          .filter((s) => !inMove.has(s.player.player_id))
          .map((s) => {
            const own = shiftedSpot(s.spot, ballOwn, poss === team.team_id, s.player.position === "GK");
            const [x, y] = project(own[0], own[1], isHome);
            return (
              <PlayerDot key={s.player.player_id} x={x} y={y} r={1.35} color={colour} ink={readableOn(colour)} label={s.player.shirt}
                opacity={0.5} title={`${s.player.name} · estimated position (MODEL)`} />
            );
          });
      })}
    </g>
  );
}
