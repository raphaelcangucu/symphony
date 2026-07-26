import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const realHostJourney = readFileSync(
  fileURLToPath(new URL("../../../e2e/multi-host-smoke.sh", import.meta.url)),
  "utf8",
);

describe("real-host mobile E2E navigation", () => {
  it("keeps WebView-obscured workspace tools in distinct semantic header slots", () => {
    expect(realHostJourney).toContain('tap_terminal_header_tool "files"');
    expect(realHostJourney).toContain('tap_terminal_header_tool "source-control"');
    expect(realHostJourney).toMatch(/files\)\s+tap_screen_fraction 51 64 1 20/);
    expect(realHostJourney).toMatch(/source-control\)\s+tap_screen_fraction 59 64 1 20/);
  });
});
