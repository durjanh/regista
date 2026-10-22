import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HalftimePack, queuedId } from "./HalftimePack";
import { analysis, event, match, narrative, studioItem } from "../test/fixtures";
import { HEALTH, mockApi, renderWithPrefs } from "../test/utils";
import type { StudioItem } from "../api/types";

const HT_EVENT = event({ type: "half_end", period: 1, t: 2881.2, minute: 45, added_minute: 3 });
const HT_NARRATIVE = narrative({
  scope: "halftime", text: "England lead 1-0 at the break [f1]. Argentina have 0.40 xG from four shots. Watch the left flank.",
});

function routes(extra: Parameters<typeof mockApi>[0] = []) {
  return mockApi([
    HEALTH,
    { method: "POST", match: /\/api\/narrate$/, reply: HT_NARRATIVE },
    { match: /\/analysis\?upto_t=/, reply: analysis() },
    { match: /\/events\?types=half_end/, reply: [HT_EVENT] },
    ...extra,
  ]);
}

function setup(over: { minute?: number; ended?: boolean; events?: typeof HT_EVENT[]; queue?: Map<string, StudioItem> } = {}) {
  const onQueued = vi.fn();
  const utils = renderWithPrefs(
    <HalftimePack match={match} events={over.events ?? []} minute={over.minute ?? 46} ended={over.ended ?? false}
      queue={over.queue ?? new Map()} onQueued={onQueued} />,
  );
  return { onQueued, ...utils };
}

describe("HalftimePack", () => {
  it("stays locked during the first half", () => {
    routes();
    setup({ minute: 30 });
    expect(screen.getByRole("button", { name: "Build half-time pack" })).toBeDisabled();
    expect(screen.getByText("Available from half time")).toBeInTheDocument();
  });

  it("builds talking points and three graphics from first-half data only", async () => {
    const fetch = routes();
    setup({ events: [HT_EVENT] });
    await userEvent.click(screen.getByRole("button", { name: "Build half-time pack" }));
    const points = await screen.findAllByRole("listitem");
    expect(points.map((p) => p.textContent)).toEqual([
      "England lead 1-0 at the break f1After 64': 0.82.", "Argentina have 0.40 xG from four shots.", "Watch the left flank.",
    ]);
    expect(screen.getByText("Half time: ENG 1-0 ARG")).toBeInTheDocument();
    expect(screen.getByText("Who's in control")).toBeInTheDocument();
    expect(screen.getByText("Moment of the half: Big chance for Kane")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "0.85" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "12.1" })).toBeInTheDocument();
    // narrate and analysis are both cut at the half_end event, so no second-half data leaks in
    const urls = fetch.mock.calls.map(([u]) => String(u));
    expect(urls).toContain("/api/matches/2026-07-15-england-argentina/analysis?upto_t=2881.2");
    const narrate = fetch.mock.calls.find(([u]) => String(u) === "/api/narrate")!;
    expect(JSON.parse(String((narrate[1] as RequestInit).body))).toMatchObject({ scope: "halftime", persona: "broadcaster", upto_t: 2881.2 });
  });

  it("finds the half-time whistle itself when the replay jumped past it", async () => {
    const fetch = routes();
    setup({ minute: 60, events: [] });
    await userEvent.click(screen.getByRole("button", { name: "Build half-time pack" }));
    await screen.findByText("Who's in control");
    expect(fetch.mock.calls.some(([u]) => String(u).includes("/events?types=half_end"))).toBe(true);
  });

  it("adds a graphic to the approval queue with a stable key, stamped at 45'", async () => {
    let body: Record<string, unknown> = {};
    const fetch = routes([{ method: "POST", match: /\/studio\/.+\/items$/, reply: (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return studioItem({ id: queuedId(String(body.key)) });
    } }]);
    const { onQueued } = setup({ events: [HT_EVENT] });
    await userEvent.click(screen.getByRole("button", { name: "Build half-time pack" }));
    await screen.findByText("Who's in control");
    const addButtons = screen.getAllByRole("button", { name: /Add to queue/ });
    expect(addButtons).toHaveLength(3);
    await userEvent.click(addButtons[0]);
    await waitFor(() => expect(onQueued).toHaveBeenCalledWith(expect.objectContaining({ id: "si-pr-ht-xg" })));
    expect(body).toMatchObject({ key: "ht-xg", kind: "stat_card", template: "halftime_xg", duration_s: 12, priority: 70, t: 2879 });
    expect((body.data as { rows: unknown[] }).rows).toHaveLength(3);
    expect(fetch.mock.calls.filter(([u]) => String(u).endsWith("/items"))).toHaveLength(1);
  });

  it("shows queued status, studio decisions and failed editorial checks from the queue", async () => {
    routes();
    const queue = new Map<string, StudioItem>([
      ["si-pr-ht-xg", studioItem()],
      ["si-pr-ht-control", studioItem({ id: "si-pr-ht-control", status: "killed" })],
      ["si-pr-ht-moment", studioItem({ id: "si-pr-ht-moment", editorial: { passed: false, issues: ["betting language: odds"] } })],
    ]);
    setup({ events: [HT_EVENT], queue });
    await userEvent.click(screen.getByRole("button", { name: "Build half-time pack" }));
    await screen.findByText("Who's in control");
    expect(screen.getAllByText("✓ Queued for approval")).toHaveLength(2);
    expect(screen.getByText("✓ killed")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Editorial check failed: betting language: odds");
    expect(screen.queryByRole("button", { name: /Add to queue/ })).toBeNull();
    // the server's own cue (with the item id) replaces the local preview
    expect(screen.getAllByText(/si-pr-ht-xg/).length).toBeGreaterThan(0);
  });

  it("copies the cue, and explains when the clipboard is unavailable", async () => {
    routes();
    const writeText = vi.fn(async (_text: string) => undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup({ events: [HT_EVENT] });
    await user.click(screen.getByRole("button", { name: "Build half-time pack" }));
    await screen.findByText("Who's in control");
    await user.click(screen.getAllByRole("button", { name: /Copy cue/ })[0]);
    expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({ version: "1.0", template: "halftime_xg", timecode: "00:48:01" });
    expect(await screen.findByText(/Copied/)).toBeInTheDocument();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("denied"); }) }, configurable: true });
    await user.click(screen.getAllByRole("button", { name: /Copy cue/ })[1]);
    expect(await screen.findByText(/Clipboard unavailable/)).toBeInTheDocument();
  });

  it("reports API failures for building and adding", async () => {
    mockApi([HEALTH, { method: "POST", match: /\/api\/narrate$/, status: 503, reply: { detail: "narrator offline" } }, { match: /\/analysis/, reply: analysis() }]);
    setup({ events: [HT_EVENT] });
    await userEvent.click(screen.getByRole("button", { name: "Build half-time pack" }));
    expect(await screen.findByText("narrator offline")).toBeInTheDocument();
  });

  it("reports a failed add without marking it queued", async () => {
    routes([{ method: "POST", match: /\/items$/, status: 409, reply: { detail: "queue closed" } }]);
    const { onQueued } = setup({ ended: true, events: [HT_EVENT] });
    await userEvent.click(screen.getByRole("button", { name: "Build half-time pack" }));
    await screen.findByText("Who's in control");
    await userEvent.click(screen.getAllByRole("button", { name: /Add to queue/ })[1]);
    expect(await screen.findByText("queue closed")).toBeInTheDocument();
    expect(onQueued).not.toHaveBeenCalled();
    expect(within(screen.getByText("Who's in control").closest(".gfx") as HTMLElement).getByRole("button", { name: /Add to queue/ })).toBeEnabled();
  });
});
