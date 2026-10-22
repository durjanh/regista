import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityIndicator } from "./ActivityIndicator";
import { Skeleton, SkeletonCard } from "./States";
import { beginActivity, getActivity } from "../lib/activity";
import { HEALTH, mockApi, renderWithPrefs } from "../test/utils";

describe("ActivityIndicator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
  });

  it("appears for slow calls, explains a cold start, and goes away when the call ends", async () => {
    mockApi([HEALTH]);   // the preferences provider checks /api/health on mount
    const { container } = renderWithPrefs(<ActivityIndicator />);
    await act(async () => {
      await vi.waitFor(() => expect(getActivity().busy).toBe(false));
    });
    act(() => vi.advanceTimersByTime(1000));
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
