import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { RealResult } from "../api/types";
import { ReplayFinder } from "./ReplayFinder";
import { HEALTH, mockApi, renderWithPrefs } from "../test/utils";

const colors = { primary: "#75AADB", secondary: "#FFFFFF", text: "#0B1F3A" };
const result = (over: Partial<RealResult>): RealResult => ({
  match_id: "1986-06-22-argentina-england", date: "1986-06-22", home_team: "Argentina", away_team: "England", home_id: "argentina",
  away_id: "england", home_score: 2, away_score: 1, tournament: "World tournament", city: "Mexico City", country: "Mexico", neutral: true,
  shootout_winner: null, replayable: true, reason: null, ...over,
});

describe("ReplayFinder", () => {
  it("lists a team's real results, says why one can't be replayed, and replays another", async () => {
    const fetch = mockApi([
      HEALTH,
      { match: /\/reference\/teams\?limit=400$/, reply: [
        { team_id: "england", name: "England", elo: 2100, rank: 3, played: 1000, colors },
        { team_id: "argentina", name: "Argentina", elo: 2200, rank: 2, played: 1000, colors },
      ] },
      { match: /\/forge\/real\?team=argentina/, reply: [
        result({ match_id: "2026-07-19-spain-argentina", date: "2026-07-19", home_team: "Spain", away_team: "Argentina", home_score: 1, away_score: 0,
                 replayable: false, reason: "Extra-time matches are not supported yet" }),
        result({}),
      ] },
      { method: "POST", match: /\/forge\/real$/, reply: { match_id: "1986-06-22-argentina-england" } },
    ]);
    renderWithPrefs(
      <Routes>
        <Route path="/" element={<ReplayFinder />} />
        <Route path="/match/:id" element={<p>match page</p>} />
      </Routes>,
    );

    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Team" }), "argentina");
    expect(await screen.findByText("Extra-time matches are not supported yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Play/ }));
    expect(await screen.findByText("match page")).toBeInTheDocument();
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ match_id: "1986-06-22-argentina-england" });
  });
});
