import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Lineups } from "./Lineups";
import { event, match } from "../test/fixtures";
import { renderWithPrefs } from "../test/utils";

describe("Lineups", () => {
  it("shows the formation, the XI with substitutes in place, the bench, and switches team", async () => {
    const sub = event({ type: "substitution", team_id: "england", sub_in: "england-20", sub_out: "england-09", minute: 59 });
    renderWithPrefs(<Lineups match={match} events={[sub]} />);
    expect(screen.getByRole("img", { name: "England line-up, 4-3-3" })).toBeInTheDocument();
    const pitch = screen.getByRole("img", { name: /England line-up/ });
    expect(within(pitch).getByText("Player")).toBeInTheDocument();           // Bench Player came on
    expect(within(pitch).getByText("↑59'")).toBeInTheDocument();
    expect(screen.getByText("↓59'")).toBeInTheDocument();                       // Kane went off, now on the bench
    await userEvent.click(screen.getByRole("button", { name: "ARG" }));
    expect(screen.getByRole("img", { name: "Argentina line-up, 4-3-3" })).toBeInTheDocument();
    expect(screen.getByText("Messi")).toBeInTheDocument();
  });
});
