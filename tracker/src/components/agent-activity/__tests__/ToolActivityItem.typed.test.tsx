import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToolActivityItem } from "@/components/agent-activity/ToolActivityItem";
import type { FileActivityView } from "@/components/assistant/fileActivity";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import { canonicalizeToolCall } from "@/lib/toolCallCanonicalize";

const commandFileActivity: FileActivityView = {
  kind: "command",
  title: "Wait for preview health endpoint",
  path: null,
  lineRange: null,
  additions: null,
  deletions: null,
  status: "running",
  body: null,
};

describe("ToolActivityItem typed routing", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders preview typed card for health-wait presentation instead of raw JSON", () => {
    const presentation = canonicalizeToolCall({
      name: "Bash",
      arguments: {
        description: "Wait for preview health endpoint",
        command:
          "for i in $(seq 1 60); do curl -sf http://127.0.0.1:4301/health && break; sleep 3; done",
      },
      status: "running",
    });

    expect(presentation.family).toBe("preview");
    expect(presentation.meta.healthWait).toBe(true);

    renderWithI18n(
      <ToolActivityItem
        toolName="Bash"
        view={{
          toolType: "Bash",
          description: null,
          status: "running",
          input: { value: '{"parsingResult":true}', language: "json" },
          output: null,
          defaultCollapsed: true,
        }}
        fileActivity={commandFileActivity}
        presentation={presentation}
      />,
    );

    expect(screen.getAllByText(/health|Wait for preview/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/parsingResult/)).toBeNull();
  });
});
