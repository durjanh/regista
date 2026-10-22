import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./ApiError";
import { AxiosHttpClient } from "./AxiosHttpClient";
import { getActivity, quietly } from "../../lib/activity";
import { mockApi } from "../../test/utils";

afterEach(() => vi.unstubAllGlobals());

describe("AxiosHttpClient", () => {
  it("sends GETs without a body or Content-Type and POSTs JSON, under the API base path", async () => {
    const fetch = mockApi([{ match: /\/api\/ping$/, reply: { ok: true } }, { method: "POST", match: /\/api\/echo$/, reply: { ok: 1 } }]);
    const svc = new AxiosHttpClient("https://api.example.net");
    expect(await svc.get("/ping")).toEqual({ ok: true });
    let [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.net/api/ping");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(await svc.post("/echo", { a: 1 })).toEqual({ ok: 1 });
    [url, init] = fetch.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ a: 1 });
    expect(svc.url("/matches/m1/live")).toBe("https://api.example.net/api/matches/m1/live");
  });

  it("shows the loading indicator for the length of a call, but not for a background refresh", async () => {
    let release: () => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      release = () => resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    })));
    const svc = new AxiosHttpClient("");
    const call = svc.get("/slow");
    expect(getActivity().busy).toBe(true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    release();
    await call;
    expect(getActivity().busy).toBe(false);

    const bg = quietly(() => svc.get("/slow"));
    expect(getActivity().busy).toBe(false);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    release();
    await bg;
  });

  it("turns validation errors into ApiError and leaves network failures as they are", async () => {
    mockApi([{ match: /bad$/, status: 422, reply: { detail: [{ loc: ["query", "upto_t"], msg: "not a number" }] } }]);
    const svc = new AxiosHttpClient("");
    const err = await svc.get("/bad").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, message: expect.stringContaining("upto_t") });
    expect(getActivity().busy).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(svc.get("/down")).rejects.toThrow("Failed to fetch");
    expect(getActivity().busy).toBe(false);
  });

  it("returns audio as a Blob and null when the feature answers 501", async () => {
    const svc = new AxiosHttpClient("");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["mp3"]), { status: 200 })));
    expect(await svc.postBlob("/speech", { text: "hi" })).toBeInstanceOf(Blob);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 501 })));
    expect(await svc.postBlob("/speech", { text: "hi" })).toBeNull();
  });
});
