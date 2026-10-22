import { defineConfig, devices } from "@playwright/test";

// End-to-end tests: real browser, real API (offline engine), real Vite dev server.
//   npm run e2e                       (CI: npx playwright install --with-deps chromium first)
//   PW_CHANNEL=chrome npm run e2e     (locally: use the installed Google Chrome, no browser download)
// Ports default away from the usual dev servers (5173/5174/8000) and can be overridden.
const API_PORT = Number(process.env.E2E_API_PORT ?? 8765);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5180);
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // the API keeps live state (studio queue, broadcasts) in memory; one worker keeps tests independent
  retries: CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    channel: process.env.PW_CHANNEL || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    viewport: { width: 1440, height: 1000 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL || undefined } }],
  webServer: [
    {
      command: `.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: "../../backend/api",
      env: { REGISTA_OFFLINE: "1" },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: !CI,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      env: { VITE_API_PROXY: `http://127.0.0.1:${API_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: !CI,
    },
  ],
});
