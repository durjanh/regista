import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { PrefsProvider } from "../lib/prefs";

type Route = { method?: string; match: RegExp; reply: unknown | ((url: string, init?: RequestInit) => unknown); status?: number };

/**
 * Replace global fetch with a tiny router over the /api paths. Unmatched requests fail loudly (HTTP 404) so a test
 * notices calls it did not expect. Returns the spy so tests can assert request shapes.
 */
export function mockApi(routes: Route[]) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const route = routes.find((r) => (r.method ?? "GET") === method && r.match.test(url));
    if (!route) return new Response(JSON.stringify({ detail: `no mock for ${method} ${url}` }), { status: 404, statusText: "Not Found" });
    const body = typeof route.reply === "function" ? (route.reply as (u: string, i?: RequestInit) => unknown)(url, init) : route.reply;
    return new Response(JSON.stringify(body), { status: route.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export const HEALTH = { match: /\/api\/health$/, reply: { status: "ok", mode: "offline", version: "test", services: {} } };

export function renderWithPrefs(ui: ReactElement, { route = "/", ...opts }: { route?: string } & RenderOptions = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>
      <PrefsProvider>{children}</PrefsProvider>
    </MemoryRouter>
  );
  return render(ui, { wrapper: Wrapper, ...opts });
}

/** Minimal EventSource stand-in: records every instance so tests can push named SSE messages. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, cb: (e: MessageEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), cb]);
  }
  emit(name: string, data: unknown) {
    const e = new MessageEvent(name, { data: typeof data === "string" ? data : JSON.stringify(data) });
    this.listeners.get(name)?.forEach((cb) => cb(e));
  }
  close() {
    this.closed = true;
  }
  static get last() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }
}
