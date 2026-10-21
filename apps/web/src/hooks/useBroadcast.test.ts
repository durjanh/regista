import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BroadcastTick } from "../api/types";
import { HERO, event, insight, moment, studioItem } from "../test/fixtures";
import { FakeWebSocket, mockApi } from "../test/utils";
import { useBroadcast } from "./useBroadcast";

const NEG = { enabled: true, url: "wss://wps.example/client/hubs/regista?access_token=t", hub: "regista",
  groups: [`match.${HERO}`, `match.${HERO}.en`, `overlay.${HERO}`] };

const tick = (over: Partial<BroadcastTick> = {}): BroadcastTick => ({
  type: "tick", match_id: HERO, seq: 1, sent_at: Date.now() - 40, t: 30, minute: 1, score: { home: 0, away: 0 },
  events: [], snapshot: { momentum: 0.1, win_prob: { home: 0.5, draw: 0.3, away: 0.2 }, control_chaos: 0.4 }, moments: [], insights: [],
  ...over,
});
const narr = (ref_type: "moment" | "insight", ref_id: string, language = "en") => ({
  type: "narrative", match_id: HERO, ref_type, ref_id, language, text: `line for ${ref_id}`, citations: [],
  fact_check: { passed: true, checked_claims: 1, issues: [], bias_flags: [] },
});

let fetch: ReturnType<typeof mockApi>;
beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  fetch = mockApi([
    { match: /\/realtime\/negotiate/, reply: NEG },
    { match: /\/events\?/, reply: [event({ id: "old-1", t: 10, minute: 1 }), event({ id: "dup", t: 20, minute: 1 })] },
  ]);
});
afterEach(() => vi.unstubAllGlobals());

async function joined(hook = () => useBroadcast(HERO, { language: "en", homeId: "england", awayId: "argentina" })) {
  const r = renderHook(hook);
  await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
  await act(async () => {
    FakeWebSocket.last.open();
    FakeWebSocket.last.ackJoins();
  });
  return r;
}
const send = async (group: string, data: unknown) => act(async () => FakeWebSocket.last.group(group, data));

describe("useBroadcast", () => {
  it("negotiates for the match and language, then joins the three groups", async () => {
    const r = await joined();
    expect(String(fetch.mock.calls[0][0])).toContain(`/api/realtime/negotiate?match_id=${HERO}&language=en`);
    expect(FakeWebSocket.last.sent.map((f) => f.group)).toEqual(NEG.groups);
    expect(r.result.current.connection).toBe("live");
    expect(r.result.current.available).toBe(true);
  });

  it("reduces ticks into the replay's LiveState: events, snapshots with client-side stats, score, latency", async () => {
    const r = await joined();
    const shot = event({ id: "s1", type: "shot", team_id: "england", shot_outcome: "goal", xg: 0.3, t: 25, minute: 1, score: { home: 1, away: 0 } });
    await send(`match.${HERO}`, tick({ events: [shot, shot], score: { home: 1, away: 0 } }));
    const s = r.result.current.state;
    expect(s.status).toBe("live");
    expect(s.events.map((e) => e.id)).toEqual(["s1"]);
    expect(s.score).toEqual({ home: 1, away: 0 });
    expect(s.latest?.stats.home).toMatchObject({ goals: 1, xg: 0.3, shots: 1 });
    expect(s.latest?.win_prob.home).toBe(0.5);
    expect(r.result.current.latencyMs).toBeGreaterThanOrEqual(0);
    await send(`match.${HERO}`, tick({ seq: 2, t: 90, minute: 2 }));
    expect(r.result.current.state.snapshots.map((x) => x.t)).toEqual([30, 90]);
  });

  it("attaches narratives to moments and insights whichever arrives first, in the viewer's language only", async () => {
    const r = await joined();
    await send(`match.${HERO}.en`, narr("moment", "m-goal-55"));          // narrative before its moment
    await send(`match.${HERO}`, tick({ moments: [moment()], insights: [insight()] }));
    await send(`match.${HERO}.en`, narr("insight", insight().id));          // narrative after its insight
    await send(`match.${HERO}.en`, narr("moment", "unknown"));
    await send(`match.${HERO}.en`, narr("insight", "unknown"));
    await send(`match.${HERO}.es`, narr("moment", "m-goal-55", "es"));
    const s = r.result.current.state;
    expect(s.moments[0].narrative?.text).toBe("line for m-goal-55");
    expect(s.moments[0].narrative?.language).toBe("en");
    expect(s.insights[0].narrative).toMatchObject({ scope: "insight", text: `line for ${insight().id}` });
  });

  it("applies overlay cues and the end of the broadcast", async () => {
    const onCue = vi.fn();
    const r = await joined(() => useBroadcast(HERO, { language: "en", onCue }));
    const item = studioItem({ id: "si-1", status: "approved" });
    await send(`overlay.${HERO}`, { type: "cue", match_id: HERO, action: "on_air", item });
    expect(r.result.current.state.studio[0].status).toBe("on_air");
    await send(`overlay.${HERO}`, { type: "cue", match_id: HERO, action: "kill", item: { id: "si-1" } });
    await send(`overlay.${HERO}`, { type: "cue", match_id: HERO, action: "kill", item: { id: "missing" } });
    expect(r.result.current.state.studio[0].status).toBe("killed");
    expect(onCue).toHaveBeenCalledTimes(3);
    await send(`match.${HERO}`, { type: "end", match_id: HERO, t: 5700 });
    expect(r.result.current.state.status).toBe("ended");
    await send(`match.${HERO}`, { type: "tick", match_id: "another-match", t: 1 });
    await send(`match.${HERO}`, null);
    expect(r.result.current.state.status).toBe("ended");
  });

  it("catches up on the events so far once when joining mid-match", async () => {
    const r = await joined();
    await send(`match.${HERO}`, tick({ t: 3600, minute: 58, events: [event({ id: "dup", t: 20 })] }));
    await waitFor(() => expect(r.result.current.state.events.map((e) => e.id)).toEqual(["old-1", "dup"]));
    await send(`match.${HERO}`, tick({ seq: 2, t: 3660, minute: 59 }));
    expect(fetch.mock.calls.filter((c) => String(c[0]).includes("/events?"))).toHaveLength(1);
  });

  it("reports unavailable when the deployment has no Web PubSub, and does nothing while inactive", async () => {
    mockApi([{ match: /\/realtime\/negotiate/, reply: { enabled: false } }]);
    const r = renderHook(() => useBroadcast(HERO, { language: "en" }));
    await waitFor(() => expect(r.result.current.available).toBe(false));
    expect(r.result.current.connection).toBe("disabled");
    expect(FakeWebSocket.instances).toHaveLength(0);

    const idle = renderHook(() => useBroadcast(HERO, { language: "en", active: false }));
    expect(idle.result.current.connection).toBe("idle");
  });

  it("reconnects on demand with a fresh negotiation", async () => {
    const r = await joined();
    await act(async () => r.result.current.reconnect());
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(2));
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
  });
});
