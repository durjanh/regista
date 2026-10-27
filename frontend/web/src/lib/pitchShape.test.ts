import { describe, expect, it } from "vitest";
import { ballPath, currentXI, formationSpots, possessionTeam, shiftedSpot, withPlayer } from "./pitchShape";
import { event, match } from "../test/fixtures";

describe("pitch shape (3D pitch and line-ups)", () => {
  it("places each role in its formation spot, spreading players who share a role", () => {
    const cbs = [{ ...match.home.players[0], player_id: "a", position: "CB" as const }, { ...match.home.players[0], player_id: "b", position: "CB" as const }];
    const spots = formationSpots(cbs);
    expect(spots.get("a")![0]).toBe(spots.get("b")![0]);
    expect(Math.abs(spots.get("a")![1] - spots.get("b")![1])).toBe(15);
  });

  it("slides the block towards the ball, pushing up in possession; keepers stay near goal", () => {
    const [xIn] = shiftedSpot([46, 34], [80, 34], true, false);
    const [xOut] = shiftedSpot([46, 34], [80, 34], false, false);
    expect(xIn).toBeGreaterThan(46);
    expect(xIn).toBeGreaterThan(xOut);
    expect(shiftedSpot([5, 34], [100, 60], true, true)[0]).toBeLessThanOrEqual(16);
  });

  it("follows substitutions: the substitute takes the spot of the player he replaced", () => {
    const sub = event({ type: "substitution", team_id: "england", sub_in: "england-20", sub_out: "england-09", minute: 59 });
    const before = currentXI(match.home, []);
    const after = currentXI(match.home, [sub]);
    const kaneSpot = before.find((s) => s.player.player_id === "england-09")!.spot;
    const slot = after.find((s) => s.player.player_id === "england-20")!;
    expect(slot.spot).toEqual(kaneSpot);
    expect(slot.on).toBe(59);
    expect(slot.replaced?.name).toBe("Harry Kane");
  });

  it("brings a player seen in an event onto the pitch", () => {
    const xi = withPlayer(currentXI(match.home, []), match.home.players, "england-20");
    expect(xi.some((s) => s.player.player_id === "england-20")).toBe(true);
    expect(xi).toHaveLength(3);
  });

  it("knows who has the ball and where it travels, in the home frame", () => {
    expect(possessionTeam([event({ type: "pass", team_id: "argentina" }), event({ type: "pressure", team_id: "england" })])).toBe("argentina");
    const away = ballPath(event({ team_id: "argentina", x: 100, y: 10, end_x: 90, end_y: 20 }), "england");
    expect(away.from).toEqual([5, 58]);
    expect(away.to).toEqual([15, 48]);
  });
});
