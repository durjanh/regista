import { describe, expect, it } from "vitest";
import { venueStyle } from "./venue";
import { match } from "../test/fixtures";

const at = (city: string, country: string, altitude?: number) =>
  venueStyle({ ...match, venue: `${city}, ${country}`, venue_info: { city, altitude_m: altitude },
    source: { ...match.source!, real: { date: "2026-07-05", tournament: "World tournament", city, country, neutral: false, goals: [] } } });

describe("venue style", () => {
  it("gives each city its own stable ground, labelled with the real venue", () => {
    const a = at("Atlanta", "United States");
    expect(at("Atlanta", "United States")).toEqual(a);
    expect(a.label).toBe("Atlanta, United States");
    const others = ["Berlin", "Dortmund", "Lusail", "Arlington", "Miami Gardens"].map((c) => at(c, "Somewhere"));
    expect(new Set(others.map((o) => `${o.tiers}${o.roof}${o.mowing}${o.seats}`)).size).toBeGreaterThan(1);
  });

  it("seats the host nation's colours when it is playing, and puts mountains behind a high-altitude city", () => {
    expect(at("London", "England").seats).toEqual([match.home.colors.primary, match.home.colors.secondary]);
    expect(at("Mexico City", "Mexico", 2240).mountains).toBe(true);
    expect(at("Atlanta", "United States", 320).mountains).toBe(false);
  });
});
