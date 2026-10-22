import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DETECTION_WINDOW_S, mechanismIcon, mechanismLabel, plantStatus, usePoll, useTruthMode, useVerifierDrill } from "./truth";
import { plant } from "../test/fixtures";

describe("mechanism labels", () => {
  it("labels known mechanisms and degrades gracefully for unknown ones", () => {
    expect(mechanismLabel("press_switch")).toBe("Press switch");
    expect(mechanismLabel("new_thing_here")).toBe("new thing here");
    expect(mechanismIcon("tiring_fullback")).toBe("🔋");
    expect(mechanismIcon("unknown")).toBe("◆");
  });
});

describe("plantStatus", () => {
  const p = plant({ t: 3900 });
  it("is detected as soon as the Grader says so", () => {
    expect(plantStatus(p, { plant_id: p.id, mechanism: p.mechanism, team_id: p.team_id, difficulty: "obvious", detected: true }, 100, false)).toBe("detected");
  });
  it("is pending before the plant, waiting inside the window, missed after it or at full time", () => {
    expect(plantStatus(p, undefined, 3000, false)).toBe("pending");
    expect(plantStatus(p, undefined, 3900 + 60, false)).toBe("waiting");
    expect(plantStatus(p, undefined, 3900 + DETECTION_WINDOW_S + 1, false)).toBe("missed");
    expect(plantStatus(p, undefined, 3000, true)).toBe("missed");
  });
});

describe("persisted flags", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("truth mode and the Verifier drill start off and persist", () => {
    const truth = renderHook(() => useTruthMode());
    expect(truth.result.current[0]).toBe(false);
    act(() => truth.result.current[1](true));
    expect(truth.result.current[0]).toBe(true);
    expect(localStorage.getItem("regista.truthMode")).toBe("1");
    expect(renderHook(() => useTruthMode()).result.current[0]).toBe(true);

    const drill = renderHook(() => useVerifierDrill());
    act(() => drill.result.current[1](true));
    expect(localStorage.getItem("regista.verifierDrill")).toBe("1");
    act(() => drill.result.current[1](false));
    expect(localStorage.getItem("regista.verifierDrill")).toBe("0");
  });

  it("still toggles when storage throws (private mode)", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, clear: () => undefined };
    vi.stubGlobal("localStorage", broken);
    const { result } = renderHook(() => useTruthMode());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });
});

describe("usePoll", () => {
  it("polls while active, keeps the last data on failure and stops when inactive", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new Error("boom");
      return n;
    });
    const { result, rerender } = renderHook(({ active }) => usePoll(fn, 1000, active), { initialProps: { active: true } });
    await waitFor(() => expect(result.current.data).toBe(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.data).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await waitFor(() => expect(result.current.data).toBe(3));
    expect(result.current.error).toBeNull();
    rerender({ active: false });
    const calls = fn.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fn.mock.calls.length).toBe(calls);
    vi.useRealTimers();
  });
});
