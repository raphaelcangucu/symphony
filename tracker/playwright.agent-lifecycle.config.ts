import { defineConfig, devices } from "@playwright/test";
import { randomInt } from "node:crypto";
import { createServer } from "node:net";

const allocatedPorts = new Set<number>();

async function availablePort(): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = randomInt(20_000, 30_000);
    if (allocatedPorts.has(candidate)) continue;

    const available = await new Promise<boolean>((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") resolve(false);
        else reject(error);
      });
      server.listen(candidate, "127.0.0.1", () => {
        server.close((error) => {
          if (error) reject(error);
          else resolve(true);
        });
      });
    });

    if (available) {
      allocatedPorts.add(candidate);
      return String(candidate);
    }
  }

  throw new Error(
    "failed to allocate a loopback port outside the ephemeral range",
  );
}

const serverPort = await availablePort();
const fixturePort = await availablePort();
const controlPort = await availablePort();
const port = process.env.SYMPHONY_AGENT_E2E_PORT ?? serverPort;
process.env.SYMPHONY_AGENT_E2E_PORT = port;
process.env.SYMPHONY_AGENT_FIXTURE_PORT ??= fixturePort;
process.env.SYMPHONY_AGENT_E2E_CONTROL_PORT ??= controlPort;

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
