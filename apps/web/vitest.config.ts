import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/api/types.ts", "src/test/**", "src/**/*.test.{ts,tsx}"],
      reporter: ["text-summary", "text", "json-summary"],
      // Floor a couple of points under what the suite achieves (57.9 / 48.0 / 50.3 / 60.5); raise it as pages gain tests.
      thresholds: { statements: 55, branches: 46, functions: 48, lines: 58 },
    },
  },
});
