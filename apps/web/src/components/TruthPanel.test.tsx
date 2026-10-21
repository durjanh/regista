import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TruthPanel } from "./TruthPanel";
import { HERO, insight, plant, truthReport } from "../test/fixtures";
import { HEALTH, mockApi, renderWithPrefs } from "../test/utils";

const teams = { england: { short: "ENG", color: "#fff" }, argentina: { short: "ARG", color: "#75aadb" } };
const CF = {
  plant: plant(), metric: { name: "high_regains", label: "Regains in England's half", unit: "per match" }, runs: 16,
  with_change: { median: 12.5, p10: 8, p90: 18 }, without_change: { median: 7, p10: 4, p90: 10 }, effect: { median: 5.5, p10: 1, p90: 11 },
  explanation: "Across 16 paired re-runs of this match, the press produced more regains.",
};

afterEach(() => vi.unstubAllGlobals());

describe("TruthPanel", () => {
  it("shows a skeleton while loading and the error when the truth call fails", () => {
    mockApi([HEALTH]);
    const { rerender, container } = renderWithPrefs(<TruthPanel matchId={HERO} report={null} t={0} ended={false} teams={teams} />);
    expect(container.querySelector(".skeleton, [class*=skel]")).not.toBeNull();
    rerender(<TruthPanel matchId={HERO} report={null} t={0} ended={false} teams={teams} error="HTTP 500" />);
    expect(screen.getByText("HTTP 500")).toBeInTheDocument();
  });

  it("scores the agents and lists detected and pending plants", () => {
    mockApi([HEALTH]);
    renderWithPrefs(<TruthPanel matchId={HERO} report={truthReport()} t={4200} ended={false} teams={teams} />);
    const score = screen.getByLabelText("Truth score");
    expect(within(score).getAllByText("100%")).toHaveLength(2);
    expect(within(score).getByText("286s")).toBeInTheDocument();
    expect(screen.getByText(/ARG · Press switch/)).toBeInTheDocument();
    expect(screen.getByText(/Detected/)).toHaveTextContent("in 286s");
    expect(screen.getByText(/explanation correct/)).toBeInTheDocument();
    expect(screen.getByText(/Not yet reached/)).toBeInTheDocument(); // full-back planted at 4290, clock at 4200
  });

  it("moves an unseen plant from watching to missed, and flags a wrong explanation", () => {
    mockApi([HEALTH]);
    const rep = truthReport();
    rep.grades[0].explanation_correct = false;
    const { rerender } = renderWithPrefs(<TruthPanel matchId={HERO} report={rep} t={4400} ended={false} teams={teams} />);
    expect(screen.getByText(/Watching/)).toBeInTheDocument();
    expect(screen.getByText(/got a detail wrong/)).toBeInTheDocument();
    rerender(<TruthPanel matchId={HERO} report={rep} t={4400} ended teams={teams} />);
    expect(screen.getByText(/Missed/)).toBeInTheDocument();
  });

  it("shows nulls as dashes, unplanted matches and false alarms", () => {
    mockApi([HEALTH]);
    const rep = truthReport({
      plants: [], grades: [], false_alarms: [insight({ id: "fa-1", title: "Spain pressing higher", team_id: "spain" })],
      score: { recall: null, false_alarms: 1, median_seconds_to_detect: null, explanation_accuracy: null },
    });
    renderWithPrefs(<TruthPanel matchId={HERO} report={rep} t={5000} ended teams={teams} />);
    expect(within(screen.getByLabelText("Truth score")).getAllByText("–")).toHaveLength(3);
    expect(screen.getByText(/Nothing was planted in this match/)).toBeInTheDocument();
    expect(screen.getByText("Spain pressing higher")).toBeInTheDocument();
    expect(screen.getByText(/67' · spain · Press switch/)).toBeInTheDocument();
  });

  it("runs the counterfactual for a detected plant and shows the measured effect", async () => {
    const fetch = mockApi([HEALTH, { method: "POST", match: /counterfactual$/, reply: () => CF }]);
    renderWithPrefs(<TruthPanel matchId={HERO} report={truthReport()} t={4200} ended={false} teams={teams} />);
    await userEvent.click(screen.getByRole("button", { name: /What did it change/ }));
    expect(await screen.findByText("16 paired re-runs · p10–p90")).toBeInTheDocument();
    expect(screen.getByText("+5.50 per match")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /With change: median 12.50, range 8.00 to 18.00/ })).toBeInTheDocument();
    const call = fetch.mock.calls.find(([u]) => String(u).endsWith("/counterfactual"));
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ plant_id: "eng-arg-press" });
  });

  it("shows a counterfactual failure next to the button", async () => {
    mockApi([HEALTH, { method: "POST", match: /counterfactual$/, status: 500, reply: { detail: "replay failed" } }]);
    renderWithPrefs(<TruthPanel matchId={HERO} report={truthReport()} t={4200} ended={false} teams={teams} />);
    await userEvent.click(screen.getByRole("button", { name: /What did it change/ }));
    expect(await screen.findByText("replay failed")).toBeInTheDocument();
  });

  it("pulses a plant row the moment it flips to detected", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi([HEALTH]);
    const before = truthReport();
    before.grades[0].detected = false;
    const { rerender, container } = renderWithPrefs(<TruthPanel matchId={HERO} report={before} t={4000} ended={false} teams={teams} />);
    expect(container.querySelector(".just-detected")).toBeNull();
    rerender(<TruthPanel matchId={HERO} report={truthReport()} t={4200} ended={false} teams={teams} />);
    expect(container.querySelector(".just-detected")).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(container.querySelector(".just-detected")).toBeNull();
    vi.useRealTimers();
  });
});
