import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantComposer } from "@/components/assistant/AssistantComposer";
import { i18n } from "@/i18n";
import { createMockAssistantCatalogBundle } from "@/test-fixtures/assistantCatalog";
import { mockAssistantCodexCatalog } from "@/test-fixtures/assistantCatalog";
import type { NotionImportResult } from "@/services/notion";

const mockBundle = createMockAssistantCatalogBundle();
mockBundle.agents = [
  { ...mockAssistantCodexCatalog },
  ...mockBundle.agents.filter((a) => a.agent !== "codex"),
];

const importNotionPage = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({
    supported: true,
    listening: false,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("@/services/notion", async () => {
  const actual = await vi.importActual<typeof import("@/services/notion")>("@/services/notion");
  return {
    ...actual,
    importNotionPage,
  };
});

const NOTION_URL = "https://www.notion.so/workspace/Example-39c33f2eafc14020ac9bc223b4520d17";

const IMPORT_RESULT: NotionImportResult = {
  importId: "11111111-1111-1111-1111-111111111111",
  title: "Example Notion Page",
  kind: "page",
  sourceUrl: NOTION_URL,
  markdownPath: "/tmp/symphony-notion/11111111-1111-1111-1111-111111111111/page.md",
  assetsDir: "/tmp/symphony-notion/11111111-1111-1111-1111-111111111111/assets",
  metaPath: "/tmp/symphony-notion/11111111-1111-1111-1111-111111111111/meta.json",
  assetCount: 0,
  warnings: [],
  previewMarkdown: "# Example",
};

describe("notion import composer chip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importNotionPage.mockResolvedValue(IMPORT_RESULT);
  });

  it("shows the import chip when draft contains a Notion URL and calls onNotionImported on click", async () => {
    const onNotionImported = vi.fn();

    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={vi.fn()}
        onNotionImported={onNotionImported}
      />,
    );

    expect(screen.queryByTestId("notion-import-chip")).not.toBeInTheDocument();

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, {
      target: { value: `Please import this: ${NOTION_URL}` },
    });

    const chip = screen.getByTestId("notion-import-chip");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent(i18n.t("assistant.notionImport.importChip"));

    fireEvent.click(chip);

    await waitFor(() => {
      expect(importNotionPage).toHaveBeenCalledWith(NOTION_URL);
      expect(onNotionImported).toHaveBeenCalledWith(IMPORT_RESULT);
    });
  });
});
