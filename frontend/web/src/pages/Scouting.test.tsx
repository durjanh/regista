import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ScoutingPlayer } from "../api/types";
import { Scouting } from "./Scouting";
import { HEALTH, mockApi, renderWithPrefs } from "../test/utils";

const player = (team_id: string, team_name: string, name: string): ScoutingPlayer => ({
  player_key: `${team_id}:${name}`, name, team_id, team_name, position: "CM", matches: 2, rating: 7, name_source: "dataset",
});
const team = (team_id: string, name: string) => ({
  team_id, name, short: name.slice(0, 3).toUpperCase(), colors: { primary: "#111111", secondary: "#ffffff", text: "#ffffff" },
  city: "", manager: "Not recorded", formation: "4-3-3", style: { label: "Balanced", possession: 0.5, directness: 0.5, press: 0.5, width: 0.5 }, players: [],
});

describe("Scouting", () => {
  it("offers a scouting report for every team with scouted players, not only the featured fixtures", async () => {
    mockApi([
      HEALTH,
      { match: /\/scouting\/players/, reply: [player("england", "England", "Harry Kane"), player("switzerland", "Switzerland", "Granit Xhaka")] },
      // Every team the engine knows; only the ones with scouted players get a report chip.
      { match: /\/forge\/teams$/, reply: [team("switzerland", "Switzerland"), team("england", "England"), team("italy", "Italy")] },
    ]);
    renderWithPrefs(<Scouting />);

    const reports = (await screen.findByRole("heading", { name: "Scouting report" })).closest("section")!;
    const chips = await within(reports).findAllByRole("link");
    expect(chips.map((a) => a.textContent?.trim())).toEqual(["England", "Switzerland"]);
    expect(chips[1]).toHaveAttribute("href", "/scouting/team/switzerland");

    // Picking a team in the player filter offers that team's report too.
    expect(screen.queryByRole("link", { name: /Scouting report →/ })).toBeNull();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Team" }), "switzerland");
    expect(screen.getByRole("link", { name: /Scouting report →/ })).toHaveAttribute("href", "/scouting/team/switzerland");
  });
});
