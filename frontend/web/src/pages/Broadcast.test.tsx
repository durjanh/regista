import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BroadcastStatus } from "../api/types";
import { Matchday } from "./Matchday";
import { Overlay } from "./Overlay";
import { Studio } from "./Studio";
import { HERO, analysis, event, match, moment, studioItem, truthReport } from "../test/fixtures";
import { FakeEventSource, FakeWebSocket, HEALTH, mockApi, renderWithPrefs } from "../test/utils";

const NEG = { enabled: true, url: "wss://wps.example/client/hubs/regista?access_token=t", hub: "regista",
  groups: [`match.${HERO}`, `match.${HERO}.en`, `overlay.${HERO}`] };
const status = (over: Partial<BroadcastStatus> = {}): BroadcastStatus => ({
  match_id: HERO, live: true, source: "replay", speed: 1, t: 3600, minute: 58, started_at: "2026-10-21T18:00:00Z",
  ticks_published: 42, bytes_published: 52_000, languages: ["en"], viewers: 0, viewers_more: false, ...over,
});
const tick = (over: Record<string, unknown> = {}) => ({
  type: "tick", match_id: HERO, seq: 1, sent_at: Date.now(), t: 30, minute: 1, score: { home: 0, away: 0 }, events: [],
  snapshot: { momentum: 0.1, win_prob: { home: 0.5, draw: 0.3, away: 0.2 }, control_chaos: 0.4 }, moments: [], insights: [], ...over,
});

beforeEach(() => {
  FakeEventSource.instances = [];
  FakeWebSocket.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

const joinLive = async () => {
  await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
  await act(async () => {
    FakeWebSocket.last.open();
    FakeWebSocket.last.ackJoins();
  });
};

describe("Matchday: live broadcast vs replay", () => {
  const renderMatchday = () =>
    renderWithPrefs(
      <Routes>
        <Route path="/match/:id" element={<Outlet context={{ match }} />}>
          <Route index element={<Matchday />} />
        </Route>
      </Routes>,
      { route: `/match/${HERO}` },
    );
  const routes = (negotiate: unknown) => [
    HEALTH,
    { match: /\/broadcast\/status$/, reply: [status()] },
    { match: /\/realtime\/negotiate/, reply: negotiate },
    { match: /\/events\?/, reply: [] },
    { match: /\/truth\?/, reply: truthReport() },
    { match: /\/analysis/, reply: analysis() },
  ];

  it("defaults to the shared broadcast when the match is on air, and renders its ticks", async () => {
    const fetch = mockApi(routes(NEG));
    renderMatchday();
    await joinLive();
    expect(screen.getByRole("button", { name: /Live broadcast/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(/Live/);
    expect(screen.queryByRole("toolbar", { name: "Replay controls" })).toBeNull();
    await act(async () => FakeWebSocket.last.group(`match.${HERO}`, tick({ t: 3300, minute: 55, moments: [moment()],
      events: [event({ id: "g1", t: 3300, minute: 55, type: "shot", shot_outcome: "goal", score: { home: 1, away: 0 } })], score: { home: 1, away: 0 } })));
    expect(screen.getByText("GOAL: Gordon 55'")).toBeInTheDocument();
    expect(String(fetch.mock.calls.find((c) => String(c[0]).includes("/realtime/negotiate"))?.[0])).not.toContain("monitor");   // viewers count
    expect(FakeEventSource.last.closed).toBe(true);   // the personal replay stream was paused
  });

  it("switches to the viewer's own replay and back", async () => {
    mockApi(routes(NEG));
    renderMatchday();
    await joinLive();
    const before = FakeEventSource.instances.length;
    await userEvent.click(screen.getByRole("button", { name: /Replay/ }));
    expect(screen.getByRole("toolbar", { name: "Replay controls" })).toBeInTheDocument();
    expect(FakeEventSource.instances.length).toBe(before + 1);
    expect(FakeWebSocket.last.readyState).toBe(FakeWebSocket.CLOSED);
    await userEvent.click(screen.getByRole("button", { name: /Live broadcast/ }));
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(2));
  });

  it("falls back to the replay when the deployment has no Web PubSub", async () => {
    mockApi(routes({ enabled: false }));
    renderMatchday();
    await waitFor(() => expect(screen.getAllByText(/Live broadcast unavailable/).length).toBeGreaterThan(0));
    expect(screen.getByRole("toolbar", { name: "Replay controls" })).toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

describe("Studio: go live to all viewers", () => {
  it("starts and stops the shared broadcast with the profile's languages", async () => {
    let current = status({ live: false, ticks_published: 0, bytes_published: 0, started_at: null });
    const fetch = mockApi([
      HEALTH,
      { match: new RegExp(`/api/matches/${HERO}$`), reply: match },
      { match: /\/studio\/profiles$/, reply: [{ id: "uk-multi", name: "UK", languages: ["en", "fr", "es"], tone: "warm", brand: { primary: "#111", secondary: "#222" }, auto_approve_threshold: 85 }] },
      { match: /\/settings$/, reply: { profile_id: "uk-multi", auto_approve_threshold: 85 } },
      { match: /\/queue/, reply: [] },
      { match: /\/audit$/, reply: [] },
      { match: /\/events\?/, reply: [] },
      { match: /\/broadcast\/status$/, reply: () => [current] },
      { match: /\/realtime\/negotiate/, reply: { enabled: false } },
      { method: "POST", match: /\/broadcast\/.+\/start$/, reply: () => (current = status({ speed: 10, viewers: 10000, viewers_more: true })) },
      { method: "POST", match: /\/broadcast\/.+\/stop$/, reply: () => (current = status({ live: false })) },
    ]);
    renderWithPrefs(<Routes><Route path="/studio/:id" element={<Studio />} /></Routes>, { route: `/studio/${HERO}` });
    const panel = (await screen.findByRole("heading", { name: /Go live to all viewers/ })).closest("section")!;
    expect(panel).toHaveTextContent("Off air");
    await waitFor(() => expect(panel).toHaveTextContent("en · fr · es"));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Speed" }), "10");
    await userEvent.click(screen.getByRole("button", { name: /Start broadcast/ }));
    const start = fetch.mock.calls.find((c) => String(c[0]).endsWith(`/broadcast/${HERO}/start`))!;
    expect(JSON.parse(String((start[1] as RequestInit).body))).toEqual({ speed: 10, start_t: 0, languages: ["en", "fr", "es"] });
    await waitFor(() => expect(panel).toHaveTextContent("On air"));
    expect(panel).toHaveTextContent("50.8 KB");
    expect(panel).toHaveTextContent("10,000+ viewers");   // the Web PubSub count, capped
    // The producer's own connection is a monitor, so it never inflates that count.
    await waitFor(() => expect(fetch.mock.calls.some((c) => /\/realtime\/negotiate\?.*monitor=true/.test(String(c[0])))).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: /Stop broadcast/ }));
    await waitFor(() => expect(panel).toHaveTextContent("Off air"));
  });

  it("shows the API's error when the broadcast can't start", async () => {
    mockApi([
      HEALTH,
      { match: new RegExp(`/api/matches/${HERO}$`), reply: match },
      { match: /\/studio\/profiles$/, reply: [] },
      { match: /\/settings$/, reply: { profile_id: "x", auto_approve_threshold: null } },
      { match: /\/queue/, reply: [] },
      { match: /\/audit$/, reply: [] },
      { match: /\/broadcast\/status$/, reply: [] },
      { method: "POST", match: /\/broadcast\/.+\/start$/, reply: { detail: "Web PubSub not configured" }, status: 409 },
    ]);
    renderWithPrefs(<Routes><Route path="/studio/:id" element={<Studio />} /></Routes>, { route: `/studio/${HERO}` });
    await userEvent.click(await screen.findByRole("button", { name: /Start broadcast/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Web PubSub not configured");
  });
});

describe("Overlay: cues over Web PubSub", () => {
  const renderOverlay = () => renderWithPrefs(<Routes><Route path="/overlay/:id" element={<Overlay />} /></Routes>, { route: `/overlay/${HERO}` });

  it("joins only overlay.{id} and shows / kills cues from it", async () => {
    mockApi([{ match: /\/realtime\/negotiate/, reply: NEG }]);
    renderOverlay();
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    await act(async () => FakeWebSocket.last.open());
    expect(FakeWebSocket.last.sent).toEqual([{ type: "joinGroup", group: `overlay.${HERO}`, ackId: 1 }]);
    await act(async () => FakeWebSocket.last.ackJoins());
    const item = studioItem({ id: "si-live", title: "Win probability swing", kind: "lower_third", status: "on_air", duration_s: 30 });
    await act(async () => FakeWebSocket.last.group(`overlay.${HERO}`, { type: "cue", match_id: HERO, action: "on_air", item }));
    expect(screen.getByText("Win probability swing")).toBeInTheDocument();
    await act(async () => FakeWebSocket.last.group(`overlay.${HERO}`, { type: "cue", match_id: HERO, action: "kill", item: { id: "si-live" } }));
    expect(screen.queryByText("Win probability swing")).toBeNull();
    await act(async () => FakeWebSocket.last.group(`overlay.${HERO}`, { type: "tick", match_id: HERO }));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("falls back to the SSE overlay stream without Web PubSub", async () => {
    mockApi([{ match: /\/realtime\/negotiate/, reply: { enabled: false } }]);
    renderOverlay();
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    expect(FakeEventSource.last.url).toContain(`/api/studio/${HERO}/overlay`);
    await act(async () => FakeEventSource.last.emit("on_air", studioItem({ id: "si-sse", title: "From SSE", kind: "lower_third", duration_s: 30 })));
    expect(screen.getByText("From SSE")).toBeInTheDocument();
  });

  it("preview mode says it is waiting for graphics; the OBS URL stays fully transparent", async () => {
    mockApi([{ match: /\/realtime\/negotiate/, reply: { enabled: false } }]);
    const { unmount } = renderOverlay();
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    expect(screen.queryByText(/waiting for graphics/)).not.toBeInTheDocument();
    unmount();

    renderWithPrefs(<Routes><Route path="/overlay/:id" element={<Overlay />} /></Routes>, { route: `/overlay/${HERO}?preview=1` });
    expect(await screen.findByText(/waiting for graphics/)).toBeInTheDocument();
    await act(async () => FakeEventSource.last.emit("on_air", studioItem({ id: "si-p", title: "Goal", kind: "lower_third", duration_s: 30 })));
    expect(screen.getByText("Goal")).toBeInTheDocument();
    expect(screen.queryByText(/waiting for graphics/)).not.toBeInTheDocument();   // the note gives way to the graphic
  });
});
