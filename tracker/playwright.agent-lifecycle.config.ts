import { defineConfig, devices } from "@playwright/test";

const port = process.env.SYMPHONY_AGENT_E2E_PORT ?? "4217";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "agent-lifecycle.spec.ts",
  outputDir: "../.symphony/evidence/agent-cli-lifecycle/results",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  globalSetup: "./e2e/fixtures/agent-e2e-harness.ts",
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: "../.symphony/evidence/agent-cli-lifecycle/report",
      },
    ],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on",
    screenshot: "only-on-failure",
    video: "on",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
