import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NotionImportCard } from "../NotionImportCard";
import type { NotionImportResult } from "@/services/notion";

const FIXTURE: NotionImportResult = {
  importId: "11111111-1111-1111-1111-111111111111",
  title: "Marble Race Backend",
  kind: "page",
  sourceUrl: "https://www.notion.so/example",
  markdownPath: "/tmp/symphony-notion/11111111-1111-1111-1111-111111111111/page.md",
  assetsDir: "/tmp/symphony-notion/11111111-1111-1111-1111-111111111111/assets",
  metaPath: "/tmp/symphony-notion/11111111-1111-1111-1111-111111111111/meta.json",
  assetCount: 2,
  warnings: [],
  previewMarkdown: "# Hello\n\nImported preview body.",
};

describe("NotionImportCard", () => {
  it("calls onOpenPreview when Open preview is clicked", async () => {
    const onOpenPreview = vi.fn();
    const user = userEvent.setup();

    render(<NotionImportCard result={FIXTURE} onOpenPreview={onOpenPreview} />);

    expect(screen.getByTestId("notion-import-card")).toBeInTheDocument();
    expect(screen.getByText("Marble Race Backend")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open preview/i }));
    expect(onOpenPreview).toHaveBeenCalledTimes(1);
  });
});
