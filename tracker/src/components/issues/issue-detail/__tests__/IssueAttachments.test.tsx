import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IssueAttachments } from "../IssueAttachments";
import type { IssueAttachment } from "@/types/issue";

vi.mock("@/services/attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/attachments")>();
  return {
    ...actual,
    // Keep the image in its loading state so the async blob fetch never resolves
    // during the test (no act warnings); the caption still renders.
    fetchAttachmentObjectUrl: vi.fn(() => new Promise<string>(() => {})),
  };
});

function fileAttachment(overrides: Partial<IssueAttachment> = {}): IssueAttachment {
  return {
    id: "10500",
    filename: "WHCCD.VAR.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 24_576,
    createdAt: "2026-06-01T09:00:00.000Z",
    author: "Maker",
    isImage: false,
    ...overrides,
  };
}

describe("IssueAttachments", () => {
  it("renders nothing when there are no attachments", () => {
    const { container } = render(<IssueAttachments attachments={[]} projectSlug="advising" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a file chip for a non-image attachment", () => {
    render(<IssueAttachments attachments={[fileAttachment()]} projectSlug="advising" />);

    expect(screen.getByRole("heading", { name: /attachments/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open WHCCD.VAR.docx" })).toBeInTheDocument();
  });

  it("renders an image thumbnail with a caption for image attachments", () => {
    const image = fileAttachment({ id: "10501", filename: "screenshot.png", mimeType: "image/png", isImage: true });

    render(<IssueAttachments attachments={[image]} projectSlug="advising" />);

    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
  });
});
