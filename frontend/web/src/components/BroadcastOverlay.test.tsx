import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BroadcastOverlay } from "./BroadcastOverlay";
import { match } from "../test/fixtures";

const colours = { home: "#ffffff", away: "#75aadb" };
const goal = (id: string, side: "home" | "away", label: string) => ({ minute: 21, side, label, event_id: id });

describe("BroadcastOverlay", () => {
  it("shows the score bug, a banner for a goal scored while watching, and the full-time card with every goal", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<BroadcastOverlay match={match} score={{ home: 0, away: 0 }} clockLabel="20'" goals={[]} ended={false} colours={colours} />);
    expect(container.querySelector(".bc-bug")).toHaveTextContent("ENG0–0ARG20'");
    rerender(<BroadcastOverlay match={match} score={{ home: 0, away: 1 }} clockLabel="21'" goals={[goal("g1", "away", "21' Lionel Messi")]} ended={false} colours={colours} />);
    expect(container.querySelector(".bc-goal")).toHaveTextContent("GOALArgentina21' Messi0–1");
    act(() => vi.advanceTimersByTime(5000));
    expect(container.querySelector(".bc-goal")).toBeNull();
    rerender(<BroadcastOverlay match={match} score={{ home: 0, away: 1 }} clockLabel="90+4'" goals={[goal("g1", "away", "21' Lionel Messi")]} ended colours={colours} />);
    expect(container.querySelector(".bc-ft")).toHaveTextContent("FULL-TIME");
    expect(container.querySelector(".bc-ft")).toHaveTextContent("21' Messi");
    expect(container.querySelector(".bc-ft")).toHaveTextContent("Real result · synthetic animation");
    expect(container.querySelector(".bc-bug")).toHaveTextContent("FT");
    vi.useRealTimers();
  });
});
