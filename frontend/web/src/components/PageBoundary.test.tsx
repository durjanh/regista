import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { lazy } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageBoundary } from "./PageBoundary";
import { lazyPage } from "../lib/lazyPage";
import { renderWithPrefs as render } from "../test/utils";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("PageBoundary", () => {
  it("shows a spinner while a page's code loads", () => {
    const Never = lazy(() => new Promise<{ default: () => null }>(() => {}));
    render(<PageBoundary><Never /></PageBoundary>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading page…");
  });

  it("offers a reload instead of a blank screen when a page fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = () => { throw new Error("boom"); };
    render(<PageBoundary><Broken /></PageBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("This page didn't load");
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reloads once when a page's code is gone after a deploy, then shows the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const Gone = lazyPage(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));
    render(<PageBoundary><Gone /></PageBoundary>);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    const GoneAgain = lazyPage(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));
    render(<PageBoundary><GoneAgain /></PageBoundary>);
    expect(await screen.findByText(/This page didn't load/)).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);                                  // no reload loop
    vi.unstubAllGlobals();
  });
});
