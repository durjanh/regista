import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CasualView, ClubFocusView, EventTicker, KeyBattle, PlayerFocusView, SingleMetricView, ViewSwitch, isKeyMoment, useMatchdayView,
  type Metric,
} from "./FanViews";
import { analysis, event, insight, liveState, match, moment, snapshot } from "../test/fixtures";
import { HEALTH, mockApi, renderWithPrefs } from "../test/utils";

const colors = { home: "#ffffff", away: "#75aadb" };

const PLAYERS = [{
  player_id: "england-09", name: "Harry Kane", team_id: "england", shirt: 9, position: "ST", minutes: 72, touches: 41, passes: 22,
  pass_completion: 0.82, xt: 0.3, xg: 0.64, shots: 4, goals: 1, assists: 0, key_passes: 2, tackles: 0, interceptions: 1, rating: 7.9,
}];
const PHYSICAL = { players: [{ player_id: "england-09", name: "Harry Kane", team_id: "england", position: "ST", minutes: 72, distance_km: 8.4, sprints: 17, top_speed_kmh: 31.2, by_15: [1.6, 1.5, 1.4, 1.5, 1.2] }] };

beforeEach(() => {
  mockApi([HEALTH, { match: /\/players/, reply: PLAYERS }, { match: /\/physical/, reply: PHYSICAL }, { match: /\/analysis/, reply: analysis() }]);
});
afterEach(() => {
  vi.useRealTimers();
});

function Harness() {
  const { view, setView, params, setParam } = useMatchdayView();
  const loc = useLocation();
  return (
    <div>
      <ViewSwitch view={view} onChange={setView} />
      <output aria-label="view">{view}</output>
      <output aria-label="search">{loc.search}</output>
      <button onClick={() => setParam("player", null)}>clear player</button>
      <span>{params.get("player")}</span>
    </div>
  );
}

describe("view switching", () => {
  it("defaults to Analyst, switches views, writes ?view= and remembers the choice", async () => {
    renderWithPrefs(<Harness />);
    expect(screen.getByLabelText("view")).toHaveTextContent("analyst");
    const group = screen.getByRole("group", { name: "View" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(
      ["📊 Analyst", "🍿 Casual", "👟 Player focus", "🏳 Team focus", "① Single metric"],
    );
    for (const [label, mode] of [["Casual", "casual"], ["Player focus", "player"], ["Team focus", "club"], ["Single metric", "metric"]]) {
      await userEvent.click(within(group).getByRole("button", { name: new RegExp(label) }));
      expect(screen.getByLabelText("view")).toHaveTextContent(mode);
      expect(screen.getByLabelText("search")).toHaveTextContent(`view=${mode}`);
      expect(within(group).getByRole("button", { name: new RegExp(label) })).toHaveAttribute("aria-pressed", "true");
    }
    expect(localStorage.getItem("regista.matchdayView")).toBe("metric");
  });

  it("lets ?view= win over the stored view, and ignores unknown values", () => {
    localStorage.setItem("regista.matchdayView", "club");
    renderWithPrefs(<Harness />, { route: "/match/x?view=casual&player=england-09" });
    expect(screen.getByLabelText("view")).toHaveTextContent("casual");
    document.body.innerHTML = "";
    renderWithPrefs(<Harness />, { route: "/match/x?view=bogus" });
    expect(screen.getByLabelText("view")).toHaveTextContent("club");
  });

  it("keeps working when localStorage throws, and can remove a URL parameter", async () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, clear: () => undefined };
    vi.stubGlobal("localStorage", broken);
    renderWithPrefs(<Harness />, { route: "/match/x?player=england-09" });
    expect(screen.getByLabelText("view")).toHaveTextContent("analyst");
    await userEvent.click(screen.getByRole("button", { name: /Player focus/ }));
    expect(screen.getByLabelText("view")).toHaveTextContent("player");
    await userEvent.click(screen.getByRole("button", { name: "clear player" }));
    expect(screen.getByLabelText("search")).not.toHaveTextContent("player=");
  });
});

describe("CasualView", () => {
  it("classifies key moments: goals always, big moments only when important", () => {
    expect(isKeyMoment({ type: "goal", importance: 10 })).toBe(true);
    expect(isKeyMoment({ type: "big_chance", importance: 75 })).toBe(true);
    expect(isKeyMoment({ type: "big_chance", importance: 40 })).toBe(false);
    expect(isKeyMoment({ type: "substitution", importance: 99 })).toBe(false);
  });

  it("shows the win bar and an empty state before anything big happens", () => {
    renderWithPrefs(<CasualView match={match} state={liveState({ latest: snapshot(10) })} colors={colors} narratives={{}} />);
    expect(screen.getByRole("img", { name: /Chance to win: ENG 55%, Draw 25%, ARG 20%/ })).toBeInTheDocument();
    expect(screen.getByText(/The big moments land here/)).toBeInTheDocument();
  });

  it("holds each big moment on screen before moving on, never trailing by more than two", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const moments = [
      moment({ id: "a", t: 600, minute: 10, title: "GOAL: A 10'" }),
      moment({ id: "sub", t: 700, minute: 12, type: "substitution", title: "Sub" }),
      moment({ id: "b", t: 1200, minute: 20, type: "big_chance", importance: 80, title: "Big chance B" }),
    ];
    const narratives = { a: { text: "A scores [f1] from close range." } } as never;
    const { rerender } = renderWithPrefs(<CasualView match={match} state={liveState({ moments })} colors={colors} narratives={narratives} />);
    const now = () => screen.getByRole("heading", { name: "Now" }).closest("section")!;
    expect(within(now()).getByText("GOAL: A 10'")).toBeInTheDocument();
    expect(within(now()).getByText("A scores from close range.")).toBeInTheDocument(); // citation markers hidden
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8100);
    });
    expect(within(now()).getByText("Big chance B")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Earlier" }).closest("section")).toHaveTextContent("GOAL: A 10'");
    expect(screen.queryByText("Sub")).toBeNull();

    const many = Array.from({ length: 6 }, (_, i) => moment({ id: `g${i}`, t: 100 * (i + 1), minute: i + 1, title: `Goal ${i}` }));
    rerender(<CasualView match={match} state={liveState({ moments: many })} colors={colors} narratives={{}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(within(now()).getByText("Goal 3")).toBeInTheDocument();
  });
});

describe("PlayerFocusView", () => {
  it("shows the chosen player's live card with MODEL physical numbers and sprint tags", async () => {
    const events = [
      event({ player_id: "england-09", type: "carry", tags: ["sprint"], minute: 70 }),
      event({ player_id: "england-09", type: "shot", shot_outcome: "saved", xg: 0.2, minute: 71 }),
      event({ player_id: "argentina-10", player_name: "Lionel Messi" }),
    ];
    const onPlayer = vi.fn();
    renderWithPrefs(<PlayerFocusView match={match} state={liveState({ events })} colors={colors} playerId={null} onPlayer={onPlayer} />);
    await waitFor(() => expect(screen.getByText("8.4")).toBeInTheDocument());
    expect(screen.getByText("ST · England · ⚽ 1")).toBeInTheDocument();
    expect(screen.getByText("31.2")).toBeInTheDocument();
    expect(screen.getByText(/1 ⚡ ≥25 km\/h · MODEL/)).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText(/Harry Kane shoots, saved/)).toBeInTheDocument();
    expect(screen.queryByText(/Lionel Messi pass/)).toBeNull();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Player" }), "argentina-10");
    expect(onPlayer).toHaveBeenCalledWith("argentina-10");
  });

  it("falls back to the home striker for an unknown player id, and shows an empty feed", () => {
    renderWithPrefs(<PlayerFocusView match={match} state={liveState({ t: 0 })} colors={colors} playerId="nobody" onPlayer={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Player" })).toHaveValue("england-09");
    expect(screen.getByText("No actions yet for this player.")).toBeInTheDocument();
  });
});

describe("ClubFocusView", () => {
  it("tells one side's story: their win probability, numbers against the opponent, their moments and changes", async () => {
    const onSide = vi.fn();
    const state = liveState({
      latest: snapshot(72), snapshots: [snapshot(60), snapshot(72)],
      moments: [moment({ id: "eng", team_id: "england", title: "England goal" }), moment({ id: "argc", team_id: "argentina", type: "big_chance", title: "Argentina chance" }),
        moment({ id: "argg", team_id: "argentina", type: "goal", title: "Argentina goal", t: 4000 })],
      insights: [insight(), insight({ id: "eng-ins", team_id: "england", title: "England tiring", mechanism: "tiring_fullback" })],
    });
    renderWithPrefs(<ClubFocusView match={match} state={state} colors={colors} side="home" onSide={onSide} narratives={{}} />);
    expect(screen.getByText("England", { selector: ".pf-name" })).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument();
    expect(screen.getByText("v 0.40")).toBeInTheDocument();
    expect(screen.getByText("England goal")).toBeInTheDocument();
    expect(screen.getByText("Argentina goal")).toBeInTheDocument(); // goals conceded count too
    expect(screen.queryByText("Argentina chance")).toBeNull();
    const titles = [...document.querySelectorAll(".insight-title")].map((n) => n.textContent);
    expect(titles[0]).toBe("England tiring"); // their changes first
    await userEvent.click(screen.getByRole("button", { name: "ARG" }));
    expect(onSide).toHaveBeenCalledWith("away");
  });

  it("shows placeholders before the first snapshot", () => {
    renderWithPrefs(<ClubFocusView match={match} state={liveState()} colors={colors} side="away" onSide={vi.fn()} narratives={{}} />);
    expect(screen.getAllByText("–").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("button", { name: "ARG" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("SingleMetricView", () => {
  it.each<[Metric, RegExp]>([["winprob", /Chance to win: ENG 55%/], ["xg", /0\.85/], ["chaos", /Control/]])("renders %s big", (metric, expected) => {
    const onMetric = vi.fn();
    renderWithPrefs(<SingleMetricView match={match} state={liveState({ latest: snapshot(70) })} colors={colors} metric={metric} onMetric={onMetric} />);
    expect(screen.getByRole("button", { name: { winprob: "Win probability", xg: "Expected goals (xG)", chaos: "Control vs chaos" }[metric] }))
      .toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".metric-stage")!.innerHTML).toMatch(expected);
  });

  it("switches metrics and shows a skeleton for xG before data", async () => {
    const onMetric = vi.fn();
    renderWithPrefs(<SingleMetricView match={match} state={liveState()} colors={colors} metric="xg" onMetric={onMetric} />);
    expect(document.querySelector(".skeleton")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Control vs chaos" }));
    expect(onMetric).toHaveBeenCalledWith("chaos");
    expect(screen.getByText(/MODEL · from synthetic match events/)).toBeInTheDocument();
  });
});

describe("Analyst extras", () => {
  it("finds the key battle on the busiest flank once analysis arrives", async () => {
    const events = [event({ player_id: "argentina-04", player_name: "Gonzalo Montiel", team_id: "argentina", type: "tackle" })];
    renderWithPrefs(<KeyBattle match={match} state={liveState({ events, t: 3000 })} colors={colors} />);
    expect(await screen.findByText("Harry Kane")).toBeInTheDocument();
    expect(screen.getByText("Gonzalo Montiel")).toBeInTheDocument();
    expect(screen.getByText("1 tackles + interceptions")).toBeInTheDocument();
    expect(screen.getByText("53%")).toBeInTheDocument();
  });

  it("says so when no flank stands out", async () => {
    const flat = analysis();
    flat.tactics.home.channels = { left: 3, center: 4, right: 3 };
    mockApi([HEALTH, { match: /\/analysis/, reply: flat }]);
    renderWithPrefs(<KeyBattle match={match} state={liveState({ t: 3000 })} colors={colors} />);
    expect(await screen.findByText(/one flank is clearly busier/)).toBeInTheDocument();
  });

  it("lists the latest events with their brief features", () => {
    const events = [event({ type: "pass", pass_length: 31.5, difficulty: 0.62, ball_speed_kmh: 64, minute: 70 })];
    renderWithPrefs(<EventTicker match={match} state={liveState({ events })} />);
    expect(screen.getByText(/Harry Kane pass/)).toBeInTheDocument();
    document.body.innerHTML = "";
    renderWithPrefs(<EventTicker match={match} state={liveState()} />);
    expect(screen.getByRole("heading", { name: "Event feed" })).toBeInTheDocument();
  });
});
