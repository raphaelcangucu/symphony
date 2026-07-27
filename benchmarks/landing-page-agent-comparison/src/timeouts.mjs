const MINUTE_MS = 60 * 1000;

// The longest observed canonical run took 56m09s. Session and orchestrator
// paths share one settlement budget, while each outer boundary reserves
// explicit headroom to persist results and terminate process groups.
export const AGENT_SETTLEMENT_TIMEOUT_MS = 70 * MINUTE_MS;
export const PLAYWRIGHT_TEST_TIMEOUT_MS =
  AGENT_SETTLEMENT_TIMEOUT_MS + 5 * MINUTE_MS;
export const PLAYWRIGHT_PROCESS_TIMEOUT_MS =
  PLAYWRIGHT_TEST_TIMEOUT_MS + 5 * MINUTE_MS;
export const MATRIX_CELL_TIMEOUT_MS =
  PLAYWRIGHT_PROCESS_TIMEOUT_MS + 5 * MINUTE_MS;
