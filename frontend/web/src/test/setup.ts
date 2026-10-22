import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import axios, { AxiosError, AxiosHeaders, type AxiosAdapter } from "axios";
import { afterEach } from "vitest";

/**
 * Tests stub `fetch` (mockApi, vi.stubGlobal). In the browser ApiService uses axios's XHR adapter; here every axios
 * instance created after this file runs (axios.create merges the defaults) sends its request through the stubbed
 * fetch as fetch(url, { method, headers, body }), so the mocks and request-shape assertions see exactly what the app sent.
 */
const fetchBridge: AxiosAdapter = async (config) => {
  const url = axios.getUri(config);
  const headers = AxiosHeaders.from(config.headers).normalize(true).toJSON() as Record<string, string>;
  const body = config.data === undefined ? undefined : typeof config.data === "string" ? config.data : JSON.stringify(config.data);
  const res = await fetch(url, { method: (config.method ?? "get").toUpperCase(), headers, body });
  let data: unknown;
  if (config.responseType === "blob") data = await res.blob();
  else {
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : text;
    } catch {
      data = text;
    }
  }
  const response = { data, status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers), config };
  if (res.status >= 200 && res.status < 300) return response;
  throw new AxiosError(`Request failed with status code ${res.status}`, AxiosError.ERR_BAD_RESPONSE, config, null, response);
};
axios.defaults.adapter = fetchBridge;

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* storage may be stubbed by a test */
  }
});
