import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 4 locally: the first load of the 8 MB quikdown chunk times out under
  // heavier contention; CI stays single-worker.
  workers: process.env.CI ? 1 : 4,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:1421",
    trace: "on-first-retry",
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
