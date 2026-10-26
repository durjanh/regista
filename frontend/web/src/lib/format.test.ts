import { describe, expect, it } from "vitest";
import {
  clock, clockFromT, cx, describeEvent, duration, durationS, distinctAway, importanceTier, median, num, pct, percentile, readableOn, sourceUrl, svgY,
  teamColor, toHomeFrame,
} from "./format";
import { event, match } from "../test/fixtures";

describe("format helpers", () => {
  it("formats football clocks and stream clocks", () => {
    expect(clock(63)).toBe("63'");
    expect(clock(45, 2)).toBe("45+2'");
    expect(clockFromT(3914.4)).toBe("65:14");
    expect(clockFromT(5)).toBe("00:05");
  });

  it("formats durations in their two largest units", () => {
    expect(duration(0)).toBe("0 ms");
    expect(duration(812.4)).toBe("812 ms");
    expect(duration(1022)).toBe("1s 22ms");
    expect(duration(1000)).toBe("1s");
    expect(duration(23838)).toBe("23s 838ms");
    expect(duration(98360)).toBe("1m 38s");
    expect(duration(120000)).toBe("2m");
    expect(duration(3_900_000)).toBe("1h 5m");
    expect(duration(null)).toBe("–");
    expect(duration(Number.NaN)).toBe("–");
    expect(durationS(286)).toBe("4m 46s");
    expect(durationS(null)).toBe("–");
  });

  it("formats percentages and numbers, with a dash for non-finite values", () => {
    expect(pct(0.826)).toBe("83%");
    expect(pct(0.5, 1)).toBe("50.0%");
    expect(num(1.234)).toBe("1.23");
    expect(num(Number.NaN)).toBe("–");
  });

  it("maps away coordinates into the home frame and flips SVG y", () => {
    expect(toHomeFrame(10, 20, true)).toEqual([10, 20]);
    expect(toHomeFrame(10, 20, false)).toEqual([95, 48]);
    expect(svgY(0)).toBe(68);
  });

  it("picks readable text and distinct team colours", () => {
    expect(readableOn("#ffffff")).toBe("#0b1020");
    expect(readableOn("#000000")).toBe("#ffffff");
    expect(readableOn("#fff")).toBe("#fff");
    expect(teamColor(undefined)).toBe("#7c8aa5");
    expect(teamColor(match.home)).toBe("#ffffff");
    const red = { ...match.home, colors: { primary: "#e00000", secondary: "#111111", text: "#fff" } };
    const red2 = { ...match.away, colors: { primary: "#e00010", secondary: "#222222", text: "#fff" } };
    expect(distinctAway(red, red2)).toBe("#222222");
    expect(distinctAway(match.home, match.away)).toBe("#75aadb");
  });

  it("describes events in plain words", () => {
    expect(describeEvent(event({ type: "shot", shot_outcome: "off_target", xg: 0.12 }))).toBe("Harry Kane shoots, off target (xG 0.12)");
    expect(describeEvent(event({ type: "pass", pass_type: "through_ball", outcome: "fail" }))).toBe("Harry Kane through ball (misplaced)");
    expect(describeEvent(event({ type: "pass" }))).toBe("Harry Kane pass");
    expect(describeEvent(event({ type: "carry" }))).toBe("Harry Kane carries");
    expect(describeEvent(event({ type: "dribble", outcome: "fail" }))).toBe("Harry Kane takes on (dispossessed)");
    expect(describeEvent(event({ type: "card", card: "red" }))).toBe("Harry Kane, red card");
    expect(describeEvent(event({ type: "card", card: "yellow" }))).toBe("Harry Kane, yellow card");
    expect(describeEvent(event({ type: "substitution" }))).toBe("Substitution");
    expect(describeEvent(event({ type: "goal_kick", player_name: undefined }))).toBe("goal kick");
  });

  it("computes median, percentile and importance tiers", () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(percentile([], 95)).toBe(0);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(importanceTier({ importance: 80 })).toBe("high");
    expect(importanceTier({ importance: 50 })).toBe("mid");
    expect(importanceTier({ importance: 10 })).toBe("low");
  });

  it("joins class names and resolves dataset source links", () => {
    expect(cx("a", false, null, "b", undefined)).toBe("a b");
    expect(sourceUrl("see https://example.org/data).")).toBe("https://example.org/data");
    expect(sourceUrl("github.com/martj42/international_results (Kaggle)")).toBe("https://github.com/martj42/international_results");
    expect(sourceUrl("unknown")).toBe("https://github.com/martj42/international_results");
  });
});
