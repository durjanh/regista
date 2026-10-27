import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { event, match } from "../test/fixtures";
import { ShapeLayer } from "./ShapeLayer";

describe("ShapeLayer", () => {
  it("places every starter not in the current move, faded and marked as estimated", () => {
    const starters = [...match.home.players, ...match.away.players].filter((p) => p.starter);
    const onBall = match.home.players.find((p) => p.starter)!;
    const evs = [event({ team_id: match.home.team_id, player_id: onBall.player_id, possession_id: 7, x: 60, y: 30 })];
    const { container } = render(
      <svg><ShapeLayer events={evs} home={match.home} away={match.away} homeColor="#ffffff" awayColor="#75aadb" /></svg>,
    );
    const dots = container.querySelectorAll("title");
    expect(dots.length).toBe(starters.length - 1);                                  // the player on the ball is drawn by EventLayer
    expect(dots[0].textContent).toMatch(/estimated position \(MODEL\)/);
  });

  it("draws nothing before the first event", () => {
    const { container } = render(<svg><ShapeLayer events={[]} home={match.home} away={match.away} homeColor="#fff" awayColor="#000" /></svg>);
    expect(container.querySelectorAll("circle").length).toBe(0);
  });
});
