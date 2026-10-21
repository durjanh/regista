import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, liveUrl, overlayUrl, synthesize } from "./client";
import { mockApi } from "../test/utils";

const lastCall = (fn: ReturnType<typeof vi.fn>) => {
  const [url, init] = fn.mock.calls[fn.mock.calls.length - 1] as [string, RequestInit | undefined];
  return { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
};

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds GET paths with encoded ids and only the query params that are set", async () => {
    const fetch = mockApi([{ match: /./, reply: [] }]);
    await api.events("a/b", { types: ["pass", "shot"], from_t: 0 });
    expect(lastCall(fetch).url).toBe("/api/matches/a%2Fb/events?from_t=0&types=pass%2Cshot");
    await api.analysis("m1");
    expect(lastCall(fetch).url).toBe("/api/matches/m1/analysis");
    await api.truth("m1", 4300.7);
    expect(lastCall(fetch).url).toBe("/api/matches/m1/truth?upto_t=4300");
    await api.insights("m1", 61.9);
    expect(lastCall(fetch).url).toBe("/api/matches/m1/insights?upto_t=61");
    await api.dugout("m1", "away", 4300.5);
    expect(lastCall(fetch).url).toBe("/api/matches/m1/dugout?side=away&upto_t=4300");
    await api.scoutingPlayers({ team_id: "england", q: "" });
    expect(lastCall(fetch).url).toBe("/api/scouting/players?team_id=england");
    await api.h2h("england", "argentina");
    expect(lastCall(fetch).url).toBe("/api/reference/h2h?a=england&b=argentina");
    await api.calibration();
    expect(lastCall(fetch).url).toBe("/api/forge/calibration");
  });

  it("POSTs JSON bodies for the truth loop and the studio", async () => {
    const fetch = mockApi([{ method: "POST", match: /./, reply: {} }]);
    await api.narrateInsight("m1", "in-1", { persona: "analyst", language: "en", drill: true });
    expect(lastCall(fetch)).toEqual({ url: "/api/matches/m1/insights/in-1/narrate", method: "POST", body: { persona: "analyst", language: "en", drill: true } });
    await api.counterfactual("m1", "p1");
    expect(lastCall(fetch).body).toEqual({ plant_id: "p1" });
    await api.counterfactual("m1", "p1", 8);
    expect(lastCall(fetch).body).toEqual({ plant_id: "p1", runs: 8 });
    await api.studioAdd("m1", { kind: "stat_card", title: "HT", key: "ht-xg" });
    expect(lastCall(fetch)).toMatchObject({ url: "/api/studio/m1/items", body: { kind: "stat_card", key: "ht-xg" } });
    await api.studioAction("m1", "si-1", { action: "kill" });
    expect(lastCall(fetch)).toMatchObject({ url: "/api/studio/m1/items/si-1", body: { action: "kill" } });
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("maps every endpoint onto the documented path and method", async () => {
    const fetch = mockApi([{ match: /./, reply: {} }, { method: "POST", match: /./, reply: {} }]);
    const cases: [() => Promise<unknown>, string, string][] = [
      [() => api.health(), "GET", "/api/health"],
      [() => api.matches(), "GET", "/api/matches"],
      [() => api.match("m1"), "GET", "/api/matches/m1"],
      [() => api.moment("m1", "g1"), "GET", "/api/matches/m1/moments/g1"],
      [() => api.players("m1", 60), "GET", "/api/matches/m1/players?upto_t=60"],
      [() => api.narrate({ match_id: "m1", scope: "halftime", persona: "broadcaster", language: "en", upto_t: 2881 }), "POST", "/api/narrate"],
      [() => api.recap({ match_id: "m1", persona: "casual", language: "en" }), "POST", "/api/recap"],
      [() => api.ask({ match_id: "m1", question: "why?", persona: "casual", language: "en" }), "POST", "/api/ask"],
      [() => api.translate(["hi"], "fr"), "POST", "/api/translate"],
      [() => api.studioQueue("m1", 100), "GET", "/api/studio/m1/queue?upto_t=100"],
      [() => api.studioProfiles(), "GET", "/api/studio/profiles"],
      [() => api.studioSettings("m1"), "GET", "/api/studio/m1/settings"],
      [() => api.saveStudioSettings("m1", { profile_id: "uk-multi" }), "POST", "/api/studio/m1/settings"],
      [() => api.studioAudit("m1"), "GET", "/api/studio/m1/audit"],
      [() => api.forgeTeams(), "GET", "/api/forge/teams"],
      [() => api.forgeScenario("late comeback"), "POST", "/api/forge/scenario"],
      [() => api.forgeGenerate({} as never), "POST", "/api/forge/generate"],
      [() => api.calibration(100), "GET", "/api/forge/calibration?n=100"],
      [() => api.referenceSummary(), "GET", "/api/reference/summary"],
      [() => api.referenceTeams(), "GET", "/api/reference/teams"],
      [() => api.referenceTeam("england"), "GET", "/api/reference/teams/england"],
      [() => api.playerDNA("england:harry-kane"), "GET", "/api/scouting/players/england%3Aharry-kane"],
      [() => api.teamReport("argentina"), "GET", "/api/scouting/teams/argentina"],
      [() => api.dugoutBrief({ match_id: "m1", side: "home", language: "en" }), "POST", "/api/dugout/brief"],
      [() => api.physical("m1"), "GET", "/api/matches/m1/physical"],
      [() => api.truthScore(), "GET", "/api/truth/score"],
      [() => api.ops(), "GET", "/api/ops"],
    ];
    for (const [call, method, url] of cases) {
      await call();
      expect(lastCall(fetch), url).toMatchObject({ method, url });
    }
  });

  it("raises ApiError with the API's detail message", async () => {
    mockApi([
      { method: "POST", match: /items\/blocked/, status: 409, reply: { detail: "Editorial rules block this item from going on air" } },
      { match: /analysis/, status: 422, reply: { detail: [{ loc: ["upto_t"], msg: "bad" }] } },
    ]);
    const err = await api.studioAction("m1", "blocked", { action: "on_air" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/Editorial rules/);
    const err2 = await api.analysis("m1").catch((e) => e);
    expect(err2.status).toBe(422);
    expect(err2.message).toContain("upto_t");
  });

  it("falls back to the status text when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 502, statusText: "Bad Gateway" })));
    await expect(api.health()).rejects.toMatchObject({ status: 502, message: "Bad Gateway" });
  });

  it("builds live and overlay URLs, with drill only when on", () => {
    expect(liveUrl("m1", { speed: 30, start_t: 0, persona: "analyst", language: "en" })).toBe(
      "/api/matches/m1/live?speed=30&start_t=0&persona=analyst&language=en",
    );
    expect(liveUrl("m1", { speed: 60, start_t: 3600, persona: "analyst", language: "en", drill: true })).toContain("&drill=true");
    expect(overlayUrl("m 1")).toBe("/api/studio/m%201/overlay");
  });

  it("synthesize returns audio, null when Speech is off, and throws on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["abc"]), { status: 200 })));
    expect(await synthesize("hi", "en")).toBeInstanceOf(Blob);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 501 })));
    expect(await synthesize("hi", "en")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500, statusText: "Server Error" })));
    await expect(synthesize("hi", "en")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("api base URL (Azure Static Web Apps build)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("calls the API's own origin when VITE_API_BASE_URL is set, for fetch and SSE alike", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://regista-api.example.net/");
    vi.resetModules();
    const fresh = await import("./client");
    expect(fresh.API_ORIGIN).toBe("https://regista-api.example.net");
    expect(fresh.liveUrl("m1", { speed: 30, start_t: 0, persona: "casual", language: "en" }))
      .toMatch(/^https:\/\/regista-api\.example\.net\/api\/matches\/m1\/live\?/);
    expect(fresh.overlayUrl("m1")).toBe("https://regista-api.example.net/api/studio/m1/overlay");
    const fetch = mockApi([{ match: /./, reply: [] }]);
    await fresh.api.analysis("m1");
    expect(lastCall(fetch).url).toBe("https://regista-api.example.net/api/matches/m1/analysis");
  });
});
