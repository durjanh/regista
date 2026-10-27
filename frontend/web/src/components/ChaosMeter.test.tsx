import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventDetail, RhythmChart, distanceMilestones, eventDetailText } from "./ChaosMeter";
import { event } from "../test/fixtures";

describe("EventDetail", () => {
  it("shows a distance milestone when a player passes it", () => {
    const e = event({ tags: ["sprint", "km:10"] });
    expect(distanceMilestones(e)).toEqual([10]);
    render(<EventDetail e={e} />);
    expect(screen.getByText("⚡ sprint")).toBeInTheDocument();
    expect(screen.getByTitle("Distance milestone: 10 km covered (MODEL)")).toHaveTextContent("🏃 10 km");
    expect(eventDetailText(e)).toContain("🏃 10 km covered");
  });

  it("renders nothing for an event without details", () => {
    const { container } = render(<EventDetail e={event({ tags: [] })} />);
    expect(container).toBeEmptyDOMElement();
    expect(distanceMilestones(event({ tags: undefined }))).toEqual([]);
  });
});

describe("RhythmChart", () => {
  it("draws one bar per window and marks fast and slow spells against the match average", () => {
    const windows = [
      { from: 0, to: 15, passes_per_min: 10.7, passes_per_possession: 5.8 },
      { from: 45, to: 60, passes_per_min: 12.8, passes_per_possession: 7.4 },
      { from: 60, to: 75, passes_per_min: 7.3, passes_per_possession: 3.6 },
    ];
    const { container } = render(<RhythmChart windows={windows} />);
    expect(container.querySelectorAll(".rhythm-col")).toHaveLength(3);
    expect(container.querySelector(".rhythm-bar.fast")).not.toBeNull();
    expect(container.querySelector(".rhythm-bar.slow")).not.toBeNull();
    expect(screen.getByText("3.6 / poss.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /60-75' 7.3 passes a minute, 3.6 per possession/ })).toBeInTheDocument();
  });

  it("needs at least two windows", () => {
    const { container } = render(<RhythmChart windows={[{ from: 0, to: 15, passes_per_min: 9, passes_per_possession: 5 }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
