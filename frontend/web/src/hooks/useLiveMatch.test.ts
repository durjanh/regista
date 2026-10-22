import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveMatch } from "./useLiveMatch";
import { HERO, event, insight, moment, narrative, snapshot, studioItem } from "../test/fixtures";
import { FakeEventSource, mockApi } from "../test/utils";

const frame = () => act(async () => {
  await new Promise((r) => requestAnimationFrame(() => r(null)));
});

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

describe("useLiveMatch", () => {
  it("does nothing without a match id, and autoplay can be turned off", () => {
    renderHook(() => useLiveMatch(undefined, { persona: "casual", language: "en" }));
    renderHook(() => useLiveMatch(HERO, { persona: "casual", language: "en", autoplay: false }));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("buffers SSE messages per frame: dedupes events, upserts moments and insights, ignores bad JSON", async () => {
    const { result } = renderHook(() => useLiveMatch(HERO, { persona: "casual", language: "en" }));
    const es = FakeEventSource.last;
    expect(result.current.state.status).toBe("connecting");
    const e1 = event({ t: 600, minute: 11, score: { home: 1, away: 0 } });
    act(() => {
      es.emit("meta", { match_id: HERO, speed: 30, start_t: 0, duration_s: 5700 });
      es.emit("event", e1);
      es.emit("event", e1);
      es.emit("event", "{not json");
      es.emit("snapshot", snapshot(10));
      es.emit("moment", moment({ id: "m1" }));
      es.emit("insight", insight());
      es.emit("studio", studioItem({ id: "s1", t: 600 }));
    });
    await frame();
    let s = result.current.state;
    expect(s.status).toBe("live");
    expect(s.meta?.duration_s).toBe(5700);
    expect(s.events).toHaveLength(1);
    expect(s.score).toEqual({ home: 1, away: 0 });
    expect(s.minute).toBe(11);
    expect(s.t).toBe(600);
    expect(s.studio.map((x) => x.id)).toEqual(["s1"]);
    expect(s.insights[0].narrative).toBeUndefined();

    act(() => {
      es.emit("insight", { ...insight(), narrative: narrative() });
      es.emit("moment", moment({ id: "m1", narrative: narrative({ text: "now narrated" }) }));
      es.emit("snapshot", snapshot(5)); // an earlier snapshot after a seek replaces the later ones
      es.emit("studio", studioItem({ id: "s1", t: 600, status: "approved" }));
    });
    await frame();
    s = result.current.state;
    expect(s.insights).toHaveLength(1);
    expect(s.insights[0].narrative?.text).toMatch(/pressing higher/);
    expect(s.moments[0].narrative?.text).toBe("now narrated");
    expect(s.snapshots.map((x) => x.minute)).toEqual([5]);
    expect(s.studio[0].status).toBe("approved");
  });

  it("ends cleanly: closes the stream and ignores the error that follows", async () => {
    const { result } = renderHook(() => useLiveMatch(HERO, { persona: "casual", language: "en" }));
    const es = FakeEventSource.last;
    act(() => es.emit("end", { t: 5700 }));
    await frame();
    expect(result.current.state.status).toBe("ended");
    expect(es.closed).toBe(true);
    act(() => es.onerror?.());
    expect(result.current.state.status).toBe("ended");
    act(() => result.current.play());
    expect(FakeEventSource.instances).toHaveLength(1); // play does nothing at full time
    act(() => result.current.pause());
    expect(result.current.state.status).toBe("ended");
  });

  it("reconnects at the current clock when persona, language or drill change, and restarts from zero", async () => {
    const { result, rerender } = renderHook((p: { persona: string; drill: boolean }) => useLiveMatch(HERO, { persona: p.persona, language: "en", drill: p.drill }), {
      initialProps: { persona: "casual", drill: false },
    });
    act(() => FakeEventSource.last.emit("event", event({ t: 1234 })));
    await frame();
    rerender({ persona: "analyst", drill: false });
    expect(FakeEventSource.last.url).toContain("start_t=1234");
    expect(FakeEventSource.last.url).toContain("persona=analyst");
    rerender({ persona: "analyst", drill: true });
    expect(FakeEventSource.last.url).toContain("drill=true");
    act(() => result.current.setSpeed(120));
    expect(FakeEventSource.last.url).toContain("speed=120");
    act(() => result.current.jumpToEnd());
    expect(result.current.speed).toBe(600);
    expect(FakeEventSource.last.url).toContain("speed=600");
    act(() => result.current.restart());
    expect(FakeEventSource.last.url).toContain("start_t=0");
    expect(result.current.state.events).toHaveLength(0);
  });

  it("maps match minutes onto the stream clock using the real second-half kick-off", async () => {
    const fetch = mockApi([{ match: /types=kick_off/, reply: [event({ type: "kick_off", period: 1, t: 0 }), event({ type: "kick_off", period: 2, t: 2940, minute: 46 })] }]);
    const { result } = renderHook(() => useLiveMatch(HERO, { persona: "casual", language: "en" }));
    await act(async () => result.current.seekMinute(58));
    expect(FakeEventSource.last.url).toContain(`start_t=${2940 + 12 * 60}`);
    expect(result.current.state.minute).toBe(58);
    await act(async () => result.current.seekMinute(30));
    expect(FakeEventSource.last.url).toContain("start_t=1740");
    expect(fetch).toHaveBeenCalledTimes(1); // the kick-off lookup is cached per match
  });

  it("falls back to 45:00 when the kick-off lookup fails, and stops on a dropped stream", async () => {
    mockApi([]);
    const { result } = renderHook(() => useLiveMatch(HERO, { persona: "casual", language: "en" }));
    await act(async () => result.current.seekMinute(46));
    expect(FakeEventSource.last.url).toContain("start_t=2700");
    act(() => FakeEventSource.last.onerror?.());
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error).toBe("Live stream interrupted");
    act(() => result.current.play());
    expect(FakeEventSource.last.closed).toBe(false);
  });
});
