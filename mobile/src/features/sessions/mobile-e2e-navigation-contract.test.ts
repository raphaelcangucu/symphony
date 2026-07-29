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
const orchestratorRoute = readFileSync(
  fileURLToPath(new URL("../orchestrator/OrchestratorSessionRoute.tsx", import.meta.url)),
  "utf8",
);
const realHostSeed = readFileSync(
  fileURLToPath(new URL("../../../../elixir/dev/mobile_e2e_seed.exs", import.meta.url)),
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

  it("drives the real associated-task detail and composer action journey", () => {
    expect(realHostJourney).toContain('tap_accessible "Open ${host_a_issue} task"');
    expect(realHostJourney).toContain('tap_accessible "Summary"');
    expect(realHostJourney).toContain('tap_accessible "PR"');
    expect(realHostJourney).toContain('wait_for_ui_contains "Passed"');
    expect(realHostJourney).toContain('tap_accessible "Comments"');
    expect(realHostJourney).toContain('tap_accessible "Evidence"');
    expect(realHostJourney).toContain('tap_accessible "Sessions"');
    expect(realHostJourney).toContain('tap_accessible "Open composer actions"');
    expect(realHostJourney).toContain('tap_accessible "Plan mode"');
    expect(realHostJourney).toContain('tap_accessible "Magic"');
    expect(realHostJourney).toContain('tap_accessible "Add context"');
    expect(realHostJourney).toContain(
      'wait_for_selector "content-desc" "Remove issue ${host_a_issue}"',
    );
    expect(realHostJourney).toContain('assert_ui_absent "RPC method failed"');
    expect(realHostJourney).toContain('assert_ui_absent "Offline"');
    expect(realHostJourney).toContain('assert_ui_absent "Project not found"');
    expect(realHostJourney).toContain("assert_task_session_evidence");
  });

  it("keeps associated tasks inside the active host navigation tree", () => {
    expect(orchestratorRoute).toContain(
      "`/h/${encodeURIComponent(hostId)}/issue/${encodeURIComponent(taskProjectSlug)}/${encodeURIComponent(taskIdentifier)}`",
    );
  });

  it("seeds a real per-session transcript that the encrypted stream can subscribe to", () => {
    expect(realHostSeed).toContain("alias SymphonyElixir.Agent.SessionStore");
    expect(realHostSeed).toContain(
      "SessionStore.append(session_workspace_path, execution_thread.id",
    );
  });
});
