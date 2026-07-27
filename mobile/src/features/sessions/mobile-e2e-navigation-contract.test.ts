import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const realHostJourney = readFileSync(
  fileURLToPath(new URL("../../../e2e/multi-host-smoke.sh", import.meta.url)),
  "utf8",
);
const ciWorkflow = readFileSync(
  fileURLToPath(new URL("../../../../.github/workflows/mobile-e2e.yml", import.meta.url)),
  "utf8",
);

describe("real-host mobile E2E navigation", () => {
  it("keeps WebView-obscured workspace tools in distinct semantic header slots", () => {
    expect(realHostJourney).toContain('tap_terminal_header_tool "files"');
    expect(realHostJourney).toContain('tap_terminal_header_tool "source-control"');
    expect(realHostJourney).toMatch(/files\)\s+tap_screen_fraction 51 64 1 20/);
    expect(realHostJourney).toMatch(/source-control\)\s+tap_screen_fraction 59 64 1 20/);
    expect(realHostJourney).toContain(
      'wait_for_selector "content-desc" "Connection status: Live" 180',
    );
  });

  it("keeps real-agent turns strict by default and disables them explicitly in credentialless CI", () => {
    expect(realHostJourney).toContain('readonly REAL_AGENT_E2E="${DEV10X_E2E_REAL_AGENT:-1}"');
    expect(realHostJourney).toContain('if [[ "${REAL_AGENT_E2E}" == "1" ]]');
    expect(realHostJourney).toContain('wait_for_assistant_text "VERIFIED42" 180');
    expect(realHostJourney).toContain('wait_for_assistant_text "ACK73" 180');
    expect(ciWorkflow).toContain('DEV10X_E2E_REAL_AGENT: "0"');
    expect(ciWorkflow).not.toContain("EXPO_PUBLIC_E2E_FIXTURES");
  });
});
