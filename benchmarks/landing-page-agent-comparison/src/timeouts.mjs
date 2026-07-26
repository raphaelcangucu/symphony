const MINUTE_MS = 60 * 1000;

// The longest observed canonical run took 56m09s. Keep one shared settlement
// budget for both session and orchestrator paths, then reserve explicit cleanup
// headroom at every outer process boundary.
export const AGENT_SETTLEMENT_TIMEOUT_MS = 70 * MINUTE_MS;
export const PLAYWRIGHT_TEST_TIMEOUT_MS = AGENT_SETTLEMENT_TIMEOUT_MS + 5 * MINUTE_MS;
export const PLAYWRIGHT_PROCESS_TIMEOUT_MS = PLAYWRIGHT_TEST_TIMEOUT_MS + 5 * MINUTE_MS;
export const MATRIX_CELL_TIMEOUT_MS = PLAYWRIGHT_PROCESS_TIMEOUT_MS + 5 * MINUTE_MS;

export const ORCHESTRATOR_CLEANUP_TIMEOUT_MS = 30 * 1000;
export const ORCHESTRATOR_POLL_INTERVAL_MS = 2 * 1000;
