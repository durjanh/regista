import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWebSocket } from "../test/utils";
import { SUBPROTOCOL, connectRealtime, type RealtimeStatus } from "./webpubsub";

const ENABLED = { enabled: true as const, url: "wss://wps.example/client/hubs/regista?access_token=t", hub: "regista",
  groups: ["match.m1", "match.m1.en", "overlay.m1"] };

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connectRealtime (Azure Web PubSub client)", () => {
  it("reports disabled when the deployment has no Web PubSub, so callers fall back to SSE", async () => {
    const statuses: RealtimeStatus[] = [];
    connectRealtime({ negotiate: async () => ({ enabled: false }), onMessage: () => undefined, onStatus: (s) => statuses.push(s) });
    await flush();
    expect(statuses).toEqual(["connecting", "disabled"]);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("joins each negotiated group with an ackId, goes live on the acks and delivers group messages", async () => {
    const statuses: RealtimeStatus[] = [];
    const got: [string, unknown][] = [];
    connectRealtime({ negotiate: async () => ENABLED, onMessage: (g, d) => got.push([g, d]), onStatus: (s) => statuses.push(s) });
    await flush();
    const ws = FakeWebSocket.last;
    expect(ws.url).toBe(ENABLED.url);
    expect(ws.protocol).toBe(SUBPROTOCOL);
    ws.open();
    expect(ws.sent).toEqual(ENABLED.groups.map((group, i) => ({ type: "joinGroup", group, ackId: i + 1 })));
    expect(statuses.at(-1)).toBe("connecting");
    ws.ackJoins();
    expect(statuses.at(-1)).toBe("live");
    ws.group("match.m1", { type: "tick", t: 1 });
    ws.receive({ type: "message", from: "group", group: "match.m1.en", dataType: "text", data: "plain" });
    ws.receive({ type: "message", from: "group", group: "overlay.m1", dataType: "json", data: '{"type":"cue"}' });
    ws.receive({ type: "message", from: "server", data: { ignored: true } });
    ws.receive({ type: "system", event: "connected" });
    ws.receive("not json");
    expect(got).toEqual([["match.m1", { type: "tick", t: 1 }], ["match.m1.en", "plain"], ["overlay.m1", { type: "cue" }]]);
  });

  it("joins only the groups the caller asks for (an overlay needs overlay.{id})", async () => {
    connectRealtime({ negotiate: async () => ENABLED, groups: (g) => g.startsWith("overlay."), onMessage: () => undefined });
    await flush();
    FakeWebSocket.last.open();
    expect(FakeWebSocket.last.sent).toEqual([{ type: "joinGroup", group: "overlay.m1", ackId: 1 }]);
  });

  it("treats a Duplicate join as success and a Forbidden join as an error", async () => {
    const statuses: RealtimeStatus[] = [];
    connectRealtime({ negotiate: async () => ({ ...ENABLED, groups: ["match.m1"] }), onMessage: () => undefined, onStatus: (s) => statuses.push(s) });
    await flush();
    FakeWebSocket.last.open();
    FakeWebSocket.last.ackJoins(false, "Duplicate");
    expect(statuses.at(-1)).toBe("live");

    const s2: RealtimeStatus[] = [];
    connectRealtime({ negotiate: async () => ({ ...ENABLED, groups: ["match.m1"] }), onMessage: () => undefined, onStatus: (s) => s2.push(s) });
    await flush();
    FakeWebSocket.last.open();
    FakeWebSocket.last.ackJoins(false, "Forbidden");
    expect(s2.at(-1)).toBe("error");
  });

  it("re-negotiates with exponential backoff when the connection drops, and stops after close()", async () => {
    vi.useFakeTimers();
    const negotiate = vi.fn(async () => ENABLED);
    const statuses: RealtimeStatus[] = [];
    const conn = connectRealtime({ negotiate, onMessage: () => undefined, onStatus: (s) => statuses.push(s), baseDelayMs: 100, maxDelayMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.last.open();
    FakeWebSocket.last.drop();
    expect(statuses.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(99);
    expect(negotiate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(negotiate).toHaveBeenCalledTimes(2);
    FakeWebSocket.last.drop();
    await vi.advanceTimersByTimeAsync(200);   // second retry waits twice as long
    expect(negotiate).toHaveBeenCalledTimes(3);
    conn.close();
    expect(FakeWebSocket.last.readyState).toBe(FakeWebSocket.CLOSED);
    await vi.advanceTimersByTimeAsync(5000);
    expect(negotiate).toHaveBeenCalledTimes(3);
  });

  it("retries when negotiation fails", async () => {
    vi.useFakeTimers();
    const negotiate = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(ENABLED);
    const statuses: RealtimeStatus[] = [];
    const conn = connectRealtime({ negotiate, onMessage: () => undefined, onStatus: (s) => statuses.push(s), baseDelayMs: 50 });
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toContain("error");
    await vi.advanceTimersByTimeAsync(50);
    expect(negotiate).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
    conn.close();
  });

  it("goes live straight away when there is nothing to join", async () => {
    const statuses: RealtimeStatus[] = [];
    connectRealtime({ negotiate: async () => ENABLED, groups: () => false, onMessage: () => undefined, onStatus: (s) => statuses.push(s) });
    await flush();
    FakeWebSocket.last.open();
    expect(statuses.at(-1)).toBe("live");
  });
});
