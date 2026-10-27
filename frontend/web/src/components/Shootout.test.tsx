import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShootoutPanel } from "./Shootout";
import { match } from "../test/fixtures";

describe("ShootoutPanel", () => {
  it("says after extra time and shows the shoot-out kick by kick, marked as modelled", () => {
    const kicks = [
      { side: "home" as const, player_id: "a", shirt: 10, outcome: "scored" as const, placement: "left" },
      { side: "away" as const, player_id: "b", shirt: 7, outcome: "saved" as const, placement: "right" },
    ];
    render(<ShootoutPanel match={{ ...match, extra_time: true, shootout: { winner: "home", home: 4, away: 2, first: "home", kicks, modelled: true } }} />);
    expect(screen.getByText("After extra time")).toBeInTheDocument();
    expect(screen.getByText("England win 4–2 on penalties")).toBeInTheDocument();
    expect(screen.getByTitle("No. 7: saved, right")).toHaveClass("saved");
  });

  it("shows nothing for a match settled in normal time", () => {
    const { container } = render(<ShootoutPanel match={match} />);
    expect(container).toBeEmptyDOMElement();
  });
});
