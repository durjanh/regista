import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";
import { beginActivity, noteAnswer } from "../../lib/activity";
import { ApiError } from "./ApiError";
import type { HttpClient } from "./HttpClient";

// The SPA is served by Azure Static Web Apps and calls the API directly (CORS), so the API's origin is baked in at
// build time. Empty in local development: Vite proxies /api to localhost:8000.
export const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

/** Model calls (recaps, briefs) and a cold start after scale-to-zero can each take tens of seconds. */
const TIMEOUT_MS = 120_000;

/** The API's error body is `{"detail": "..."}` (or a validation list); anything else falls back to the status text. */
function toApiError(err: unknown): unknown {
  if (!(err instanceof AxiosError) || !err.response) return err;   // network failure, timeout: the caller decides
  const { status, statusText, data } = err.response;
  let detail = statusText;
  if (data && typeof data === "object" && !(data instanceof Blob)) {
    const body = data as { detail?: unknown };
    detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
  }
  return new ApiError(status, detail || `HTTP ${status}`);
}

/**
 * The HttpClient the app uses: axios underneath, the global loading indicator on every call, and API errors as
 * ApiError. Server-sent events (live replays, the overlay) can't go over axios; they take their URLs from `url()`, so
 * every address still comes from here.
 */
export class AxiosHttpClient implements HttpClient {
  readonly baseURL: string;
  private readonly http: AxiosInstance;

  constructor(origin: string = API_ORIGIN) {
    this.baseURL = `${origin}/api`;
    this.http = axios.create({ baseURL: this.baseURL, timeout: TIMEOUT_MS, headers: { Accept: "application/json" } });
  }

  get<T>(path: string): Promise<T> {
    return this.send<T>({ method: "GET", url: path });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.send<T>(this.jsonPost(path, body));
  }

  async postBlob(path: string, body: unknown): Promise<Blob | null> {
    try {
      return await this.send<Blob>({ ...this.jsonPost(path, body), responseType: "blob" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 501) return null;
      throw err;
    }
  }

  url(path: string): string {
    return `${this.baseURL}${path}`;
  }

  private jsonPost(path: string, body: unknown): AxiosRequestConfig {
    return { method: "POST", url: path, data: body ?? {}, headers: { "Content-Type": "application/json" } };
  }

  private send<T>(config: AxiosRequestConfig): Promise<T> {
    const done = beginActivity();   // synchronous, so `quietly(...)` around the call is honoured
    return this.http
      .request<T>(config)
      .then((res) => {
        noteAnswer();
        return res.data;
      })
      .catch((err: unknown) => {
        if (err instanceof AxiosError && err.response) noteAnswer();   // an HTTP error is still an answer from a running API
        throw toApiError(err);
      })
      .finally(done);
  }
}

