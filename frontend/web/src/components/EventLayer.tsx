import type { FreezeFramePlayer, MatchEvent } from "../api/types";
import { readableOn } from "../lib/format";
import { SHOT_COLORS } from "../lib/palette";
import { eventDetailText } from "./ChaosMeter";
import { PlayerDot, project } from "./Pitch";

type Props = {
  events: MatchEvent[];
  homeId: string;
  homeColor: string;
  awayColor: string;
  freezeFrame?: FreezeFramePlayer[] | null;
  /** Team whose attacking frame the freeze frame uses (the acting team of the event it belongs to). */
  freezeFrameTeam?: string;
  shirts?: Map<string, number>;
  names?: Map<string, string>;
  activeId?: string;
};

/** Draws passes, carries, shots and a freeze frame of all players on top of <Pitch>. */
export function EventLayer({ events, homeId, homeColor, awayColor, freezeFrame, freezeFrameTeam, shirts, names, activeId }: Props) {
  const colorOf = (team: string) => (team === homeId ? homeColor : awayColor);
  const n = events.length;

  return (
    <g>
      {freezeFrame?.length ? (
        <g>
          {freezeFrame.map((p) => {
            const [x, y] = project(p.x, p.y, (freezeFrameTeam ?? p.team_id) === homeId);
            const col = colorOf(p.team_id);
            return (
              <PlayerDot
                key={p.player_id}
                x={x}
                y={y}
                r={1.55}
                color={col}
                ink={readableOn(col)}
                label={shirts?.get(p.player_id)}
                ring={p.actor ? "#ffffff" : undefined}
                title={names?.get(p.player_id)}
                opacity={0.95}
              />
            );
          })}
        </g>
      ) : null}

      {events.map((e, i) => {
        const isHome = e.team_id === homeId;
        const [x1, y1] = project(e.x, e.y, isHome);
        const col = colorOf(e.team_id);
        const age = n - 1 - i;
        const opacity = activeId ? (e.id === activeId ? 1 : 0.35) : Math.max(0.25, 1 - age * 0.09);
        const failed = e.outcome === "fail";

        if (e.type === "shot") {
          const [gx, gy] = project(e.end_x ?? 105, e.end_y ?? 34, isHome);
          const sc = SHOT_COLORS[e.shot_outcome ?? "off_target"] ?? SHOT_COLORS.off_target;
          const r = 0.9 + Math.sqrt(e.xg ?? 0.05) * 3.2;
          return (
            <g key={e.id} opacity={opacity}>
              <title>{`${e.player_name ?? ""} shot · xG ${(e.xg ?? 0).toFixed(2)} · ${e.shot_outcome ?? ""}${eventDetailText(e)}`}</title>
              <line x1={x1} y1={y1} x2={gx} y2={gy} stroke={sc} strokeWidth={0.5} strokeDasharray={e.shot_outcome === "goal" ? undefined : "1 0.8"} />
              <circle cx={x1} cy={y1} r={r} fill={sc} fillOpacity={0.35} stroke={sc} strokeWidth={0.4} />
              {e.shot_outcome === "goal" ? <circle cx={gx} cy={gy} r={0.9} fill={sc} /> : null}
            </g>
          );
        }
        if ((e.type === "pass" || e.type === "carry" || e.type === "dribble") && e.end_x !== undefined && e.end_y !== undefined) {
          const [x2, y2] = project(e.end_x, e.end_y, isHome);
          return (
            <g key={e.id} opacity={opacity}>
              <title>{`${e.player_name ?? ""} ${e.type}${failed ? " (failed)" : ""}${eventDetailText(e)}`}</title>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={failed ? SHOT_COLORS.off_target : col}
                strokeWidth={e.type === "pass" ? 0.45 : 0.35}
                strokeDasharray={e.type === "pass" ? undefined : "0.9 0.7"}
                strokeLinecap="round"
              />
              <circle cx={x2} cy={y2} r={0.55} fill={failed ? SHOT_COLORS.off_target : col} />
              <circle cx={x1} cy={y1} r={0.75} fill={col} stroke="rgba(0,0,0,0.5)" strokeWidth={0.2} />
            </g>
          );
        }
        return (
          <g key={e.id} opacity={opacity}>
            <title>{`${e.player_name ?? ""} ${e.type.replace("_", " ")}`}</title>
            <circle cx={x1} cy={y1} r={0.9} fill="none" stroke={col} strokeWidth={0.45} />
          </g>
        );
      })}

      {/* the ball: end of the most recent event */}
      {n > 0
        ? (() => {
            const e = events[n - 1];
            const isHome = e.team_id === homeId;
            const [bx, by] = project(
              e.type === "shot" ? e.x : e.end_x ?? e.x,
              e.type === "shot" ? e.y : e.end_y ?? e.y,
              isHome,
            );
            return (
              <g>
                <circle cx={bx} cy={by} r={1.6} fill="#fff" opacity={0.18}>
                  <animate attributeName="r" values="1.2;2.4;1.2" dur="1.6s" repeatCount="indefinite" />
                </circle>
                <circle cx={bx} cy={by} r={0.7} fill="#fff" stroke="#000" strokeWidth={0.15} />
              </g>
            );
          })()
        : null}
    </g>
  );
}
