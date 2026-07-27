import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AGENT_SETTLEMENT_TIMEOUT_MS,
  MATRIX_CELL_TIMEOUT_MS,
  PLAYWRIGHT_PROCESS_TIMEOUT_MS,
  PLAYWRIGHT_TEST_TIMEOUT_MS,
} from "../src/timeouts.mjs";

const minute = 60 * 1000;

test("one canonical settlement budget covers long Claude runs", () => {
  assert.equal(AGENT_SETTLEMENT_TIMEOUT_MS, 70 * minute);
  assert.ok(AGENT_SETTLEMENT_TIMEOUT_MS > 56 * minute);
});

test("outer benchmark deadlines leave deterministic cleanup headroom", () => {
  assert.ok(
    PLAYWRIGHT_TEST_TIMEOUT_MS - AGENT_SETTLEMENT_TIMEOUT_MS >= 5 * minute,
  );
  assert.ok(
    PLAYWRIGHT_PROCESS_TIMEOUT_MS - PLAYWRIGHT_TEST_TIMEOUT_MS >= 5 * minute,
  );
  assert.ok(
    MATRIX_CELL_TIMEOUT_MS - PLAYWRIGHT_PROCESS_TIMEOUT_MS >= 5 * minute,
  );
});

test("every real execution boundary consumes the shared timeout contract", async () => {
  const [flow, playwright, runCell, runMatrix] = await Promise.all([
    readFile(new URL("../e2e/symphony-flow.spec.mjs", import.meta.url), "utf8"),
    readFile(new URL("../playwright.config.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/run-cell.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/run-matrix.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(flow, /timeout: AGENT_SETTLEMENT_TIMEOUT_MS/);
  assert.match(
    flow,
    /run\.issue_identifier,\s+AGENT_SETTLEMENT_TIMEOUT_MS,/,
  );
  assert.doesNotMatch(flow, /timeout: 25 \* 60 \* 1000/);
  assert.match(playwright, /timeout: PLAYWRIGHT_TEST_TIMEOUT_MS/);
  assert.match(runCell, /timeout: PLAYWRIGHT_PROCESS_TIMEOUT_MS/);
  assert.match(runMatrix, /timeout: MATRIX_CELL_TIMEOUT_MS/);
});
