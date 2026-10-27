import { describe, expect, it } from "vitest";
import type { MatchEvent } from "../api/types";
import { goalsFromEvents } from "./match";

const ev = (id: string, type: string, minute: number, player: string, home: number, away: number) =>
  ({ id, type, minute, t: minute * 60, player_name: player, score: { home, away } }) as unknown as MatchEvent;

describe("goalsFromEvents", () => {
  it("credits the shot that scored, never a pass made after a jump past the goal", () => {
    // A stream joined at 58': the 55' goal isn't in it, and the first event is already 1-0.
    expect(goalsFromEvents([ev("e1", "pass", 58, "Enzo Fernández", 1, 0), ev("e2", "pass", 59, "Harry Kane", 1, 0)])).toEqual([]);
    const goals = goalsFromEvents([
      ev("k", "kick_off", 1, "Harry Kane", 0, 0),
      ev("g1", "shot", 55, "Anthony Gordon", 1, 0),
      ev("p", "pass", 56, "Enzo Fernández", 1, 0),
      ev("g2", "shot", 85, "Enzo Fernández", 1, 1),
    ]);
    expect(goals.map((g) => [g.side, g.label])).toEqual([["home", "55' Anthony Gordon"], ["away", "85' Enzo Fernández"]]);
  });
});
