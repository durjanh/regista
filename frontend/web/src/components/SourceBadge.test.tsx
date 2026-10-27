import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MatchSource } from "../api/types";
import { SourceBadge } from "./SourceBadge";

const dataset = { name: "intl", source: "github.com/martj42/international_results", licence: "CC0-1.0" };

describe("SourceBadge", () => {
  it("links the match reports the scorers come from", () => {
    const source: MatchSource = {
      kind: "real_result", disclosure: "Scorers from published match reports.", dataset,
      scorers_sources: ["https://www.espn.com/soccer/match/1", "https://bolavip.com/en/soccer/2"],
    };
    render(<SourceBadge source={source} />);
    expect(screen.getByRole("link", { name: "espn.com" })).toHaveAttribute("href", "https://www.espn.com/soccer/match/1");
    expect(screen.getByRole("link", { name: "bolavip.com" })).toBeInTheDocument();
  });

  it("labels modelled goals and shows no report links", () => {
    render(<SourceBadge source={{ kind: "real_result", goals_modelled: true, disclosure: "Modelled.", dataset }} />);
    expect(screen.getByText("Real score · Goals modelled", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText(/Scorers:/)).not.toBeInTheDocument();
  });
});
