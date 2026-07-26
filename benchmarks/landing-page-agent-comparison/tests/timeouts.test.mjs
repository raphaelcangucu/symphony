import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_SETTLEMENT_TIMEOUT_MS,
  MATRIX_CELL_TIMEOUT_MS,
  PLAYWRIGHT_PROCESS_TIMEOUT_MS,
  PLAYWRIGHT_TEST_TIMEOUT_MS,
} from "../src/timeouts.mjs";

const minute = 60 * 1000;

test("one canonical settlement budget covers the observed long Claude run", () => {
  assert.equal(AGENT_SETTLEMENT_TIMEOUT_MS, 70 * minute);
  assert.ok(AGENT_SETTLEMENT_TIMEOUT_MS > 56 * minute);
});

test("outer benchmark deadlines leave deterministic cleanup headroom", () => {
  assert.ok(PLAYWRIGHT_TEST_TIMEOUT_MS - AGENT_SETTLEMENT_TIMEOUT_MS >= 5 * minute);
  assert.ok(PLAYWRIGHT_PROCESS_TIMEOUT_MS - PLAYWRIGHT_TEST_TIMEOUT_MS >= 5 * minute);
  assert.ok(MATRIX_CELL_TIMEOUT_MS - PLAYWRIGHT_PROCESS_TIMEOUT_MS >= 5 * minute);
});
