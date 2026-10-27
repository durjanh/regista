import { describe, expect, it } from "vitest";
import type { VideoRead } from "../api/types";
import { sampleTimes, tally, teamLabel, unusableBatch } from "./videoRead";

const teams = { a: { kit: "white shirts", name: "England" }, b: { kit: "sky-blue stripes", name: null } };
const read = (part: Partial<VideoRead>): VideoRead => ({ teams, frames: [], events: [], summary: "", ...part });

describe("video read", () => {
  it("samples about a frame a second, and spreads a long clip over at most 90", () => {
    expect(sampleTimes(5)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5]);
    const long = sampleTimes(600);
    expect(long).toHaveLength(90);
    expect(long[89]).toBeLessThan(600);
    expect(sampleTimes(Number.NaN)).toEqual([]);
  });

  it("adds batches up: possession from live frames, events counted once across a batch edge, goals as shots", () => {
    const sum = tally([
      read({
        frames: [
          { t: 0.5, view: "live", possession: "a", zone: "attacking_third", scoreboard: "ENG 0-0 ARG 12:01" },
          { t: 1.5, view: "live", possession: "a", zone: "middle_third", scoreboard: null },
          { t: 2.5, view: "replay", possession: null, zone: null, scoreboard: null },
        ],
        events: [{ t: 1.5, type: "pass", team: "a", description: "Short pass" }],
        summary: "England keep the ball.",
      }),
      read({
        frames: [{ t: 3.5, view: "live", possession: "b", zone: "attacking_third", scoreboard: "ENG 0-1 ARG 12:04" }],
        events: [
          { t: 2.5, type: "pass", team: "a", description: "Same pass seen again" },
          { t: 3.5, type: "goal", team: "b", description: "Low finish" },
        ],
        summary: "Argentina score on the break.",
      }),
    ]);
    expect(sum.frames).toBe(4);
    expect(sum.live).toBe(3);
    expect(sum.possession!.a).toBeCloseTo(2 / 3);
    expect(sum.counts.a.pass).toBe(1);
    expect(sum.counts.b).toEqual({ goal: 1, shot: 1 });
    expect(sum.scoreboard).toEqual({ t: 3.5, text: "ENG 0-1 ARG 12:04" });
    expect(sum.zones.a).toEqual({ defensive_third: 0, middle_third: 1, attacking_third: 1 });
    expect(sum.summaries.map((s) => s.text)).toEqual(["England keep the ball.", "Argentina score on the break."]);
  });

  it("names a team only when the model saw its name", () => {
    expect(teamLabel(teams, "a")).toBe("England (white shirts)");
    expect(teamLabel(teams, "b")).toBe("Sky-blue stripes");
    expect(teamLabel({}, "b")).toBe("Team B");
  });

  it("refuses a batch of blank or frozen frames rather than sending it to the model", () => {
    const big = (k: string) => `data:image/jpeg;base64,${"A".repeat(4000)}${k}`;
    expect(unusableBatch([big("1"), big("2")])).toBeNull();
    expect(unusableBatch(["data:image/jpeg;base64,AA", "data:image/jpeg;base64,AB"])).toMatch(/blank/);
    expect(unusableBatch([big("1"), big("1"), big("1")])).toMatch(/same frame/);
  });
});
