import { defineConfig, devices } from "@playwright/test";

const port = process.env.SYMPHONY_AGENT_E2E_PORT ?? "4217";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "agent-lifecycle.spec.ts",
  outputDir: "test-results/agent-lifecycle",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  globalSetup: "./e2e/fixtures/agent-e2e-harness.ts",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/agent-lifecycle" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
