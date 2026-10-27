import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithPrefs } from "../test/utils";
import { VideoReader } from "./VideoReader";

vi.mock("../lib/videoRead", async (actual) => ({
  ...(await actual<typeof import("../lib/videoRead")>()),
  grabFrame: vi.fn(async () => "data:image/jpeg;base64,AAAA"),
}));

const answer = {
  teams: { a: { kit: "white shirts", name: "England" }, b: { kit: "sky-blue stripes", name: null } },
  frames: [{ t: 0.5, view: "live", possession: "a", zone: "attacking_third", scoreboard: "ENG 1-0 ARG 23:14" }],
  events: [{ t: 0.5, type: "shot", team: "a", description: "Shot from the edge of the box" }],
  summary: "England attack down the right.",
  model: "reasoning",
};

describe("VideoReader", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 4 });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 3 });
  });
  afterEach(() => {
    delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).readyState;
    delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).duration;
  });

  it("reads the clip with the model and shows what it saw", async () => {
    const fetch = mockApi([{ method: "POST", match: /\/api\/video\/read$/, reply: answer }]);
    renderWithPrefs(<VideoReader src="blob:clip" name="clip.mp4" />);
    await userEvent.click(screen.getByRole("button", { name: /Read with AI/ }));

    expect(await screen.findByText("England attack down the right.")).toBeInTheDocument();
    expect(screen.getByText("ENG 1-0 ARG 23:14")).toBeInTheDocument();
    expect(screen.getByText("Shot from the edge of the box")).toBeInTheDocument();
    expect(screen.getAllByText("England (white shirts)").length).toBeGreaterThan(0);
    expect(screen.getByText(/3\/3 frames/)).toBeInTheDocument();
    const call = fetch.mock.calls.find(([url, init]) => String(url).endsWith("/api/video/read") && init?.body);
    const body = JSON.parse(String(call![1]!.body));
    expect(body.frames.map((f: { t: number }) => f.t)).toEqual([0.5, 1.5, 2.5]);
  });

  it("offers to resume when a batch fails", async () => {
    mockApi([{ method: "POST", match: /\/api\/video\/read$/, reply: { detail: "The model couldn't read these frames" }, status: 502 }]);
    renderWithPrefs(<VideoReader src="blob:clip" name="clip.mp4" />);
    await userEvent.click(screen.getByRole("button", { name: /Read with AI/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
