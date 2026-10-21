import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveControls } from "./LiveControls";
import { liveState } from "../test/fixtures";
import { HEALTH, mockApi, renderWithPrefs } from "../test/utils";
import type { LiveState } from "../hooks/useLiveMatch";

beforeEach(() => {
  mockApi([HEALTH]);
});
afterEach(() => vi.unstubAllGlobals());

const handlers = () => ({ play: vi.fn(), pause: vi.fn(), restart: vi.fn(), setSpeed: vi.fn(), jumpToEnd: vi.fn(), seekMinute: vi.fn() });

function setup(state: Partial<LiveState>, speed = 30, withSeek = true) {
  const h = handlers();
  renderWithPrefs(<LiveControls state={liveState(state)} speed={speed} {...h} seekMinute={withSeek ? h.seekMinute : undefined} />);
  return h;
}

describe("LiveControls", () => {
  it("pauses while live and shows the live status", async () => {
    const h = setup({ status: "live", t: 2850 });
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(h.pause).toHaveBeenCalled();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("plays when paused, restarts when ended and resumes after an error", async () => {
    let h = setup({ status: "paused" });
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(h.play).toHaveBeenCalled();
    document.body.innerHTML = "";

    h = setup({ status: "ended", t: 5700 });
    await userEvent.click(screen.getAllByRole("button", { name: "Restart" })[0]);
    expect(h.restart).toHaveBeenCalled();
    expect(h.play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Skip to full time/ })).toBeDisabled();
    document.body.innerHTML = "";

    h = setup({ status: "error" });
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(h.play).toHaveBeenCalled();
  });

  it("offers four speeds and marks the current one", async () => {
    const h = setup({ status: "live" }, 60);
    const speeds = screen.getByRole("group", { name: "Speed" });
    expect([...speeds.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["10×", "30×", "60×", "120×"]);
    expect(screen.getByRole("button", { name: "60×" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "10×" }));
    expect(h.setSpeed).toHaveBeenCalledWith(10);
  });

  it("jumps to match minutes including 58:00 before the showcase press", async () => {
    const h = setup({ status: "live" });
    const jump = screen.getByRole("combobox", { name: "Jump to" });
    expect([...jump.querySelectorAll("option")].map((o) => o.textContent)).toEqual(
      ["⤼ Jump to", "Kick-off", "30:00", "Second half", "58:00", "70:00", "80:00"],
    );
    await userEvent.selectOptions(jump, "58");
    expect(h.seekMinute).toHaveBeenCalledWith(58);
    await userEvent.selectOptions(jump, "46");
    expect(h.seekMinute).toHaveBeenCalledWith(46);
  });

  it("hides the jump menu when seeking is unavailable and skips to full time", async () => {
    const h = setup({ status: "live" }, 30, false);
    expect(screen.queryByRole("combobox", { name: "Jump to" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Skip to full time/ }));
    expect(h.jumpToEnd).toHaveBeenCalled();
  });
});
