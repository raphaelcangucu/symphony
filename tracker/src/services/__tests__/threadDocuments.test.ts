import { describe, expect, it } from "vitest";

import { normalizeAssistantDocumentHref } from "@/services/threadDocuments";

describe("normalizeAssistantDocumentHref", () => {
  it("accepts relative markdown paths", () => {
    expect(normalizeAssistantDocumentHref("./distributionmachine-tracker-project.md")).toBe(
      "distributionmachine-tracker-project.md",
    );
  });

  it("maps absolute freeform workspace paths to thread-relative paths", () => {
    expect(
      normalizeAssistantDocumentHref(
        "/home/raphaelcangucu/code/macro-markets-workspaces/assistant/freeform/7006/WORKFLOW.distributionmachine.md",
      ),
    ).toBe("WORKFLOW.distributionmachine.md");
  });

  it("maps file:// urls from the assistant", () => {
    expect(
      normalizeAssistantDocumentHref(
        "file:///home/raphaelcangucu/code/macro-markets-workspaces/assistant/freeform/7006/WORKFLOW.distributionmachine.md",
      ),
    ).toBe("WORKFLOW.distributionmachine.md");
  });

  it("ignores external urls", () => {
    expect(normalizeAssistantDocumentHref("https://example.com/file.md")).toBeNull();
  });
});
