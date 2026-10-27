import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutoEvent } from "./AutoEvent";
import { HERO, match } from "../test/fixtures";
import { FakeEventSource, HEALTH, mockApi, renderWithPrefs } from "../test/utils";

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:clip" }));
  mockApi([HEALTH, { match: /\/events/, reply: [] }]);
});

const renderPage = () =>
  renderWithPrefs(
    <Routes>
      <Route path="/match/:id" element={<Outlet context={{ match }} />}>
        <Route path="video" element={<AutoEvent />} />
      </Route>
    </Routes>,
    { route: `/match/${HERO}/video` },
  );

describe("Auto-eventing page", () => {
  it("explains the method, shows the scorecard, and falls back to uploads without WebGL", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Auto-eventing from the broadcast feed" })).toBeInTheDocument();
    expect(screen.getByText(/never sees the event data/)).toBeInTheDocument();
    expect(screen.getByText("Found (recall)")).toBeInTheDocument();
    expect(screen.getByText(/no WebGL/)).toBeInTheDocument();                         // jsdom has no WebGL
  });

  it("plays an uploaded clip through the same detector, graded when its name gives the match", async () => {
    renderPage();
    const file = new File(["x"], `regista-feed_${HERO}_t3720.webm`, { type: "video/webm" });
    await userEvent.upload(screen.getByLabelText(/Upload clip/), file);
    expect(await screen.findByLabelText(`Uploaded clip regista-feed_${HERO}_t3720.webm`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uploaded clip" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Play the clip/)).toBeInTheDocument();
  });
});
