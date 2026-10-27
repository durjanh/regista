import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // Restore stubbed globals (fetch, EventSource, ...) before each test, not in afterEach: an afterEach hook runs before
    // React Testing Library unmounts the page, so a late effect could call a global that was already removed.
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // Pitch3D draws with WebGL, which jsdom doesn't have: the Playwright suite exercises it in a real browser.
      exclude: ["src/main.tsx", "src/api/types.ts", "src/test/**", "src/**/*.test.{ts,tsx}", "src/components/Pitch3D.tsx"],
      reporter: ["text-summary", "text", "json-summary"],
      // Floor a few points under what the suite achieves (65.6 / 54.2 / 58.3 / 68.3); raise it as pages gain tests.
      thresholds: { statements: 62, branches: 51, functions: 55, lines: 65 },
    },
  },
});
