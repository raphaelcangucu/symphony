import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const realHostJourney = readFileSync(
  fileURLToPath(new URL("../../../e2e/multi-host-smoke.sh", import.meta.url)),
  "utf8",
);

describe("real-host mobile E2E navigation", () => {
  it("uses accessibility contracts instead of screen coordinates for workspace tools", () => {
    expect(realHostJourney).toContain('tap_accessible "Open file explorer"');
    expect(realHostJourney).toContain('tap_accessible "Open source control"');
    expect(realHostJourney).not.toMatch(
      /tap_screen_fraction .*"Open (file explorer|source control)"/,
    );
  });
});
