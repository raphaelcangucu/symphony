import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

import { PLAYWRIGHT_TEST_TIMEOUT_MS } from "./src/timeouts.mjs";

const artifactRoot = resolve(process.env.SYMPHONY_BENCH_ARTIFACT_ROOT ?? "test-results/manual");

export default defineConfig({
  testDir: "./e2e",
  timeout: PLAYWRIGHT_TEST_TIMEOUT_MS,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: `${artifactRoot}/raw`,
  reporter: [["line"], ["json", { outputFile: `${artifactRoot}/playwright-report.json` }]],
  use: {
    baseURL: process.env.SYMPHONY_BENCH_URL,
    locale: "en-US",
    colorScheme: "dark",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 960 },
    screenshot: "on",
    trace: "off",
    video: "on",
  },
});
