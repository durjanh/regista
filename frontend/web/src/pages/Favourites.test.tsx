import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { MatchSummary, ScoutingPlayer } from "../api/types";
import { Favourites } from "./Favourites";
import { HEALTH, mockApi, renderWithPrefs } from "../test/utils";

const colors = { primary: "#111111", secondary: "#ffffff", text: "#ffffff" };
const ref = (team_id: string, name: string) => ({ team_id, name, short: name.slice(0, 3).toUpperCase(), colors });
const mbappe: ScoutingPlayer = {
  player_key: "france:kylian-mbappe", name: "Kylian Mbappé", team_id: "france", team_name: "France", position: "ST", matches: 22, rating: 8.1, name_source: "dataset",
};
const summary = (match_id: string, home: string, away: string) =>
  ({ match_id, home: ref(home, home[0].toUpperCase() + home.slice(1)), away: ref(away, away[0].toUpperCase() + away.slice(1)),
     final_score: { home: 1, away: 0 }, kickoff: "2026-07-15T19:00:00Z", competition: "World tournament", venue: "Neutral" }) as unknown as MatchSummary;

function api() {
  mockApi([
    HEALTH,
    { match: /\/forge\/teams$/, reply: [ref("argentina", "Argentina"), ref("france", "France")] },
    { match: /\/scouting\/players/, reply: [mbappe] },
    { match: /\/matches$/, reply: [summary("m1", "england", "argentina"), summary("m2", "france", "spain"), summary("m3", "japan", "brazil")] },
  ]);
}

describe("Favourites", () => {
  beforeEach(() => localStorage.clear());

  it("explains how to save a favourite when nothing is saved", async () => {
    api();
    renderWithPrefs(<Favourites />);
    expect(await screen.findByText(/Nothing saved yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Scouting/ })).toHaveAttribute("href", "/scouting");
  });

  it("lists saved teams and players with their matches, and removes one", async () => {
    localStorage.setItem("regista.favClubs", JSON.stringify(["argentina"]));
    localStorage.setItem("regista.favPlayers", JSON.stringify(["france:kylian-mbappe"]));
    api();
    renderWithPrefs(<Favourites />);

    const teams = (await screen.findByRole("heading", { name: "Teams" })).closest("section")!;
    expect(within(teams).getByText("Argentina")).toBeInTheDocument();
    const players = screen.getByRole("heading", { name: "Players" }).closest("section")!;
    expect(within(players).getByText("Kylian Mbappé")).toBeInTheDocument();
    expect(within(players).getByRole("link", { name: /Player focus/ })).toHaveAttribute("href", "/match/m2?view=player");

    // Argentina's match and France's (Mbappé's team), not Japan v Brazil.
    expect(screen.getByText("2 matches")).toBeInTheDocument();

    await userEvent.click(within(teams).getByRole("button", { name: /Favourite/ }));
    expect(within(teams).getByText(/No teams saved/)).toBeInTheDocument();
  });
});
