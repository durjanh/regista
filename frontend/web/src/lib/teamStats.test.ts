import { describe, expect, it } from "vitest";
import { event } from "../test/fixtures";
import { teamStats } from "./teamStats";

describe("teamStats (client-side mirror of the API's team_stats)", () => {
  it("counts shots, xG, passing, possession, discipline and pressing from the shared timeline", () => {
    const evs = [
      event({ type: "shot", team_id: "england", shot_outcome: "goal", xg: 0.4, tags: ["big_chance"] }),
      event({ type: "shot", team_id: "england", shot_outcome: "saved", xg: 0.1 }),
      event({ type: "shot", team_id: "england", shot_outcome: "off_target", xg: 0.05 }),
      event({ type: "pass", team_id: "england", outcome: "success", x: 50, y: 34, end_x: 80, end_y: 34, xt_added: 0.2 }),
      event({ type: "pass", team_id: "england", outcome: "fail", x: 75, y: 30 }),
      event({ type: "pass", team_id: "argentina", outcome: "success", x: 30, y: 30 }),
      event({ type: "tackle", team_id: "england", x: 60 }),
      event({ type: "corner", team_id: "england" }),
      event({ type: "foul", team_id: "england", card: "yellow", x: 50 }),
      event({ type: "offside", team_id: "england" }),
      event({ type: "interception", team_id: "england", x: 30 }),
    ];
    const s = teamStats(evs, "england", "argentina");
    expect(s).toMatchObject({
      team_id: "england", goals: 1, xg: 0.55, shots: 3, shots_on_target: 2, big_chances: 1, passes: 2, pass_completion: 0.5,
      possession: 0.667, progressive_passes: 1, final_third_entries: 1, xt: 0.2, corners: 1, fouls: 1, yellow: 1, red: 0,
      offsides: 1, tackles: 1, interceptions: 1, ppda: 0.5, field_tilt: 1,
    });
    const other = teamStats(evs, "argentina", "england");
    expect(other).toMatchObject({ passes: 1, possession: 0.333, ppda: 0, field_tilt: 0 });
  });

  it("has neutral defaults with no events", () => {
    expect(teamStats([], "a", "b")).toMatchObject({ possession: 0.5, field_tilt: 0.5, pass_completion: 0, ppda: 0, xg: 0 });
  });
});
