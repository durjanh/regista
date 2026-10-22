import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Studio } from "./Studio";
import { HERO, drillCaught, event, insight, match, moment, narrative, snapshot, studioItem, truthReport } from "../test/fixtures";
import { FakeEventSource, HEALTH, mockApi, renderWithPrefs } from "../test/utils";

const PROFILES = [
  { id: "global-en", name: "Global (English)", languages: ["en"], tone: "neutral", brand: { primary: "#000", secondary: "#fff" }, auto_approve_threshold: null },
  { id: "uk-multi", name: "UK + Europe (EN / FR / ES)", languages: ["en", "fr", "es"], tone: "warm, expert", brand: { primary: "#111", secondary: "#f2a900" }, auto_approve_threshold: 85 },
];
const AUDIT = [{ at: "2026-10-21T10:00:05Z", item_id: "si-1", action: "on_air", by: "producer", title: "Win probability swing" }];

let fetch: ReturnType<typeof mockApi>;
let settings = { profile_id: "global-en", auto_approve_threshold: null as number | null };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  settings = { profile_id: "global-en", auto_approve_threshold: null };
  fetch = mockApi([
    HEALTH,
    { match: new RegExp(`/api/matches/${HERO}$`), reply: match },
    { match: /\/studio\/profiles$/, reply: PROFILES },
    { match: /\/settings$/, reply: () => settings },
    { method: "POST", match: /\/settings$/, reply: (_u: string, init?: RequestInit) => (settings = { ...settings, ...JSON.parse(String(init?.body)) }) },
    { match: /\/queue/, reply: [studioItem({ id: "si-wp", title: "Win probability swing", status: "proposed", kind: "stat_card", minute: 55, data: { rows: [{ label: "ENG", value: "41% → 63%" }] } })] },
    { match: /\/audit$/, reply: AUDIT },
    { match: /\/truth\?/, reply: truthReport() },
    { method: "POST", match: /\/items\/si-wp$/, reply: (_u: string, init?: RequestInit) => {
      const { action } = JSON.parse(String(init?.body));
      if (action === "on_air") return { detail: "never" };
      return studioItem({ id: "si-wp", title: "Win probability swing", status: action === "approve" ? "approved" : "rejected" });
    } },
    { match: /\/events\?types=kick_off/, reply: [event({ type: "kick_off", period: 2, t: 2880, minute: 46 })] },
  ]);
});

const renderStudio = () =>
  renderWithPrefs(
    <Routes>
      <Route path="/studio/:id" element={<Studio />} />
    </Routes>,
    { route: `/studio/${HERO}` },
  );

const stream = () => FakeEventSource.last;
const push = async (name: string, data: unknown) => {
  await act(async () => {
    stream().emit(name, data);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
};

describe("Studio control room", () => {
  it("connects the live stream in the analyst register and renders the match, queue and governance", async () => {
    renderStudio();
    expect((await screen.findAllByText(/England/i)).length).toBeGreaterThan(0);
    expect(stream().url).toBe(`/api/matches/${HERO}/live?speed=30&start_t=0&persona=analyst&language=en`);
    expect(await screen.findByText("Win probability swing", { selector: ".gfx div" })).toBeInTheDocument();
    expect(screen.getByText("41% → 63%")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "UK + Europe (EN / FR / ES)" })).toBeInTheDocument();
    expect(await screen.findByText("Win probability swing", { selector: ".audit-row .muted" })).toBeInTheDocument();
    expect(screen.getByTitle(/OBS \/ vMix/)).toHaveAttribute("href", `/overlay/${HERO}`);
  });

  it("streams moments, whispers and insights with their Verifier strip", async () => {
    renderStudio();
    await screen.findByText("Win probability swing", { selector: ".gfx div" });
    await push("meta", { match_id: HERO, speed: 30, start_t: 0, duration_s: 5700 });
    await push("event", event({ minute: 67, t: 4200, score: { home: 1, away: 0 } }));
    await push("snapshot", snapshot(67));
    await push("moment", moment({ narrative: narrative({ text: "Gordon finishes it [f1].", latency_ms: 840 }) }));
    await push("insight", { ...insight(), narrative: narrative({ verification: drillCaught }) });
    expect(screen.getByText("67'")).toBeInTheDocument();
    expect(screen.getByText("GOAL: Gordon 55'")).toBeInTheDocument();
    expect(document.querySelector(".whisper-line")).toHaveTextContent(/^55' Gordon finishes it\.$/);
    expect(screen.getAllByText("840")).toHaveLength(2); // p50 and p95 of one narrative
    expect(screen.getByRole("group", { name: /Verifier drill/ })).toBeInTheDocument();
    expect(screen.getByLabelText("flagged: 1.76")).toBeInTheDocument();
    // the half-time pack appears in the second half
    expect(screen.getByRole("button", { name: "Build half-time pack" })).toBeEnabled();
  });

  it("truth mode reveals the panel and the drill reconnects at the current clock with drill=true", async () => {
    renderStudio();
    await screen.findByText("Win probability swing", { selector: ".gfx div" });
    await push("event", event({ minute: 67, t: 4200 }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Truth mode/ }));
    expect(await screen.findByLabelText("Truth score")).toHaveTextContent("286s");
    expect(localStorage.getItem("regista.truthMode")).toBe("1");
    expect(fetch.mock.calls.some(([u]) => String(u).includes("/truth?upto_t="))).toBe(true);

    const before = FakeEventSource.instances.length;
    await userEvent.click(screen.getByRole("checkbox", { name: /Verifier drill/ }));
    expect(FakeEventSource.instances.length).toBe(before + 1);
    expect(stream().url).toContain("start_t=4200");
    expect(stream().url).toContain("drill=true");
    expect(FakeEventSource.instances[before - 1].closed).toBe(true);
    expect(screen.getByText(/Plants one overstated number/)).toBeInTheDocument();
  });

  it("approves a graphic, and shows the API's reason when going on air is blocked", async () => {
    renderStudio();
    const card = (await screen.findByText("Win probability swing", { selector: ".gfx div" })).closest(".gfx") as HTMLElement;
    await userEvent.click(within(card).getByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(within(screen.getByRole("tab", { name: /Approved/ })).getByText("1")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("tab", { name: /Approved/ }));
    const approved = screen.getByText("Win probability swing", { selector: ".gfx div" }).closest(".gfx") as HTMLElement;
    expect(within(approved).getByText("approved")).toBeInTheDocument();

    fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ detail: "Editorial rules block this item from going on air" }), { status: 409 }));
    await userEvent.click(within(approved).getByRole("button", { name: /Put on air/ }));
    expect(await screen.findByText(/Editorial rules block this item/)).toBeInTheDocument();
  });

  it("edits a graphic in place", async () => {
    renderStudio();
    const card = (await screen.findByText("Win probability swing", { selector: ".gfx div" })).closest(".gfx") as HTMLElement;
    await userEvent.click(within(card).getByRole("button", { name: /Edit/ }));
    const title = within(card).getByRole("textbox", { name: "Graphic title" });
    await userEvent.clear(title);
    await userEvent.type(title, "New title");
    await userEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(within(card).queryByRole("textbox", { name: "Graphic title" })).toBeNull();
  });

  it("changes the broadcaster profile and the auto-approve threshold", async () => {
    renderStudio();
    const select = await screen.findByRole("combobox", { name: "Broadcaster" });
    await waitFor(() => expect(select).toBeEnabled());
    await userEvent.selectOptions(select, "uk-multi");
    await waitFor(() => expect(settings.profile_id).toBe("uk-multi"));
    expect(await screen.findByText(/English · Français · Español · warm, expert/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Auto-approve/ }));
    expect(screen.getByText("≥85")).toBeInTheDocument();
    await waitFor(() => expect(settings.auto_approve_threshold).toBe(85), { timeout: 2000 });
  });

  it("pauses, resumes and jumps to 58:00 on the real second-half clock", async () => {
    renderStudio();
    await screen.findByText("Win probability swing", { selector: ".gfx div" });
    await act(async () => stream().onopen?.());
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(stream().closed).toBe(true);
    expect(screen.getAllByText("Paused").length).toBeGreaterThan(0);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Jump to" }), "58");
    await waitFor(() => expect(stream().url).toContain("start_t=3600"));
    await userEvent.click(screen.getByRole("button", { name: "60×" }));
    expect(stream().url).toContain("speed=60");
    await push("end", { t: 5700 });
    expect(screen.getAllByText(/Full time/).length).toBeGreaterThan(0);
  });

  it("stops and offers to resume when the stream drops", async () => {
    renderStudio();
    await screen.findByText("Win probability swing", { selector: ".gfx div" });
    await act(async () => stream().onerror?.());
    expect(stream().closed).toBe(true);
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("shows an error with retry when the match does not load", async () => {
    mockApi([HEALTH, { match: /\/api\/matches\//, status: 404, reply: { detail: "Unknown match" } }]);
    renderStudio();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown match");
  });
});
