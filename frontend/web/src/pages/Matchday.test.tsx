import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Matchday } from "./Matchday";
import { HERO, analysis, event, insight, match, moment, narrative, snapshot, truthReport } from "../test/fixtures";
import { FakeEventSource, HEALTH, mockApi, renderWithPrefs } from "../test/utils";

let fetch: ReturnType<typeof mockApi>;

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  fetch = mockApi([
    HEALTH,
    { match: /\/truth\?/, reply: truthReport() },
    { match: /\/analysis/, reply: analysis() },
    { match: /\/players/, reply: [] },
    { match: /\/physical/, reply: { players: [] } },
    { method: "POST", match: /\/api\/narrate$/, reply: narrative({ text: "Gordon scores on the break [f1]." }) },
  ]);
});

const renderMatchday = (search = "") =>
  renderWithPrefs(
    <Routes>
      <Route path="/match/:id" element={<Outlet context={{ match }} />}>
        <Route index element={<Matchday />} />
      </Route>
    </Routes>,
    { route: `/match/${HERO}${search}` },
  );

const push = async (name: string, data: unknown) => {
  await act(async () => {
    FakeEventSource.last.emit(name, data);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
};

async function feed() {
  await push("event", event({ minute: 55, t: 3300, score: { home: 1, away: 0 }, player_name: "Anthony Gordon", possession_id: 9 }));
  await push("snapshot", snapshot(55));
  await push("moment", moment());
  await push("insight", insight());
}

describe("Matchday page", () => {
  it("starts in the dense Analyst layout with the live pulse, moments, stats and insights", async () => {
    renderMatchday();
    expect(FakeEventSource.last.url).toContain("persona=casual");
    await feed();
    expect(screen.getByRole("heading", { name: "Detected changes" })).toBeInTheDocument();
    expect(screen.getByText("GOAL: Gordon 55'")).toBeInTheDocument();
    expect(screen.getByText("Argentina pressing higher from 64'")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Event feed" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Key battle/ })).toBeInTheDocument();
    expect(screen.getByText("Anthony Gordon pass", { selector: ".pitch-caption" , exact: false })).toBeTruthy();
  });

  it("switches to Casual and Single metric: different layout, same live data", async () => {
    renderMatchday();
    await feed();
    await userEvent.click(screen.getByRole("button", { name: /Casual/ }));
    expect(screen.queryByRole("heading", { name: "Detected changes" })).toBeNull();
    const now = screen.getByRole("heading", { name: "Now" }).closest("section")!;
    expect(within(now).getByText("GOAL: Gordon 55'")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Single metric/ }));
    expect(screen.getByRole("img", { name: /Chance to win: ENG 55%/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Expected goals/ }));
    expect(document.querySelector(".metric-stage")).toHaveTextContent("0.85");
  });

  it("opens Player focus and Team focus from the URL", async () => {
    renderMatchday("?view=club&side=away");
    await feed();
    expect(screen.getByText("Argentina", { selector: ".pf-name" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Player focus/ }));
    expect(screen.getByRole("combobox", { name: "Player" })).toHaveValue("england-09");
  });

  it("truth mode adds the truth panel and marks the matching insight", async () => {
    renderMatchday();
    await feed();
    await userEvent.click(screen.getByRole("checkbox", { name: /Truth mode/ }));
    expect(await screen.findByRole("heading", { name: /Truth panel/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTitle("Matches a planted change")).toBeInTheDocument());
    expect(fetch.mock.calls.some(([u]) => String(u).includes("/truth?upto_t="))).toBe(true);
  });

  it("asks for a narrative on demand and announces it for screen readers without citation markers", async () => {
    renderMatchday();
    await feed();
    await userEvent.click(screen.getByRole("button", { name: /Narrate/ }));
    expect(await screen.findByText(/Gordon scores on the break/, { selector: ".feed *" })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".sr-only")).toHaveTextContent(/^55'\. Gordon scores on the break\.$/));
    const body = JSON.parse(String((fetch.mock.calls.find(([u]) => String(u) === "/api/narrate")![1] as RequestInit).body));
    expect(body).toMatchObject({ scope: "moment", moment_id: "m-goal-55", persona: "casual", upto_t: 3300 });
  });

  it("switches the accessible mode and audio toggles", async () => {
    renderMatchday();
    await userEvent.click(screen.getByRole("checkbox", { name: /Accessible mode/ }));
    expect(document.documentElement.dataset.a11y).toBe("on");
    await userEvent.click(screen.getByRole("checkbox", { name: /Auto-play audio/ }));
    expect(JSON.parse(localStorage.getItem("regista.autoplayAudio")!)).toBe(true);
  });
});
