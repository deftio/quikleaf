import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry everywhere: under heavy host load the first navigation of the
  // 8 MB quikdown chunk can exceed the timeout; a retry separates that from a
  // real regression (the 2026-10-31 release run failed 13 tests this way).
  retries: 1,
  // 4 locally: the first load of the 8 MB quikdown chunk times out under
  // heavier contention; CI stays single-worker.
  workers: process.env.CI ? 1 : 4,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:1421",
    trace: "on-first-retry",
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev:e2e",
    port: 1421,
    reuseExistingServer: !process.env.CI,
  },
});
