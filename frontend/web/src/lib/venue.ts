import type { MatchMeta } from "../api/types";

/**
 * How the 3D stadium looks for a match's venue. Regista knows each real venue's city, country and altitude, not its
 * stadium, so the ground is generated from those: the same city always gets the same stadium (size, tiers, roof, seat
 * colours, mowing pattern, sky), seats take the host nation's colours when it is playing, the boards carry the
 * city's name, and a high-altitude city (Mexico City, La Paz, Quito) has mountains on the horizon.
 */
export type VenueStyle = {
  city: string;
  label: string;
  tiers: 1 | 2 | 3;
  roof: "open" | "cantilever" | "bowl";
  seats: [string, string];
  mowing: "stripes" | "checks" | "wide";
  sky: string;
  mountains: boolean;
  altitude?: number;
};

/** Seat colour pairs for a host nation that isn't one of the two teams. */
const SEATS: [string, string][] = [["#1e3a8a", "#e5e7eb"], ["#991b1b", "#f3f4f6"], ["#166534", "#facc15"], ["#0f172a", "#38bdf8"], ["#7c2d12", "#fde68a"], ["#334155", "#cbd5e1"]];
const SKIES = ["#070b14", "#0b1226", "#131a33", "#0a0f1c"];

/** A small stable hash, so a city always gets the same stadium. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function venueStyle(match: Pick<MatchMeta, "venue" | "venue_info" | "home" | "away" | "source">): VenueStyle {
  const real = match.source?.real;
  const city = match.venue_info?.city ?? real?.city ?? match.venue.split(",")[0].trim();
  const country = real?.country ?? match.venue.split(",").slice(1).join(",").trim();
  const h = hash(`${city}|${country}`);
  const host = [match.home, match.away].find((t) => t.name === country);
  const altitude = match.venue_info?.altitude_m;
  return {
    city,
    label: [city, country].filter(Boolean).join(", "),
    tiers: ((h % 3) + 1) as 1 | 2 | 3,
    roof: (["open", "cantilever", "bowl"] as const)[(h >>> 3) % 3],
    seats: host ? [host.colors.primary, host.colors.secondary] : SEATS[(h >>> 6) % SEATS.length],
    mowing: (["stripes", "checks", "wide"] as const)[(h >>> 9) % 3],
    sky: SKIES[(h >>> 12) % SKIES.length],
    mountains: (altitude ?? 0) >= 1500,
    altitude,
  };
}
