import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityIndicator } from "./ActivityIndicator";
import { Skeleton, SkeletonCard } from "./States";
import { WARM_FOR_MS, beginActivity, getActivity, noteAnswer } from "../lib/activity";
import { HEALTH, mockApi, renderWithPrefs } from "../test/utils";

describe("ActivityIndicator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
  });

  const renderIdle = async () => {
    mockApi([HEALTH]);   // the preferences provider checks /api/health on mount
    const view = renderWithPrefs(<ActivityIndicator />);
    await act(async () => {
      await vi.waitFor(() => expect(getActivity().busy).toBe(false));
    });
    return view;
  };

  it("appears for slow calls, explains a cold start when the API hasn't answered lately, and goes away", async () => {
    const { container } = await renderIdle();
    vi.setSystemTime(Date.now() + WARM_FOR_MS + 1000);   // quiet long enough to scale to zero (no timers, so no health poll)
    expect(container.querySelector(".activity-bar")).toBeNull();

    let done: () => void = () => undefined;
    act(() => {
      done = beginActivity();
    });
    expect(container.querySelector(".activity-bar")).toBeNull();   // quick calls don't flicker
    act(() => vi.advanceTimersByTime(300));
    expect(container.querySelector(".activity-bar")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");

    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole("status")).toHaveTextContent(/Waking up the server/);

    act(() => done());
    expect(container.querySelector(".activity-bar")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("says the work is still running, not waking up, when the API answered recently (a long AI call)", async () => {
    await renderIdle();
    act(() => noteAnswer());
    let done: () => void = () => undefined;
    act(() => {
      done = beginActivity();
    });
    act(() => vi.advanceTimersByTime(5300));
    expect(screen.getByRole("status")).toHaveTextContent(/Still working… AI agents can take up to a minute/);
    expect(screen.getByRole("status")).not.toHaveTextContent(/Waking up/);
    act(() => done());
  });
});

describe("loading placeholders", () => {
  it("put a spinner in tall areas and a labelled spinner in cards", () => {
    const { container } = renderWithPrefs(
      <>
        <Skeleton h={12} />
        <Skeleton h={200} />
        <SkeletonCard />
      </>,
    );
    const blocks = container.querySelectorAll(".skeleton");
    expect(blocks[0].querySelector(".spinner")).toBeNull();
    expect(blocks[1].querySelector(".spinner")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });
});
