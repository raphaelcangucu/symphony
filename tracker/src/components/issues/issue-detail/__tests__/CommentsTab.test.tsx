import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommentsTab } from "@/components/issues/issue-detail/CommentsTab";

vi.mock("@/services/assistant", async () => {
  const actual = await vi.importActual<typeof import("@/services/assistant")>("@/services/assistant");
  return {
    ...actual,
    uploadAssistantAttachment: vi.fn(async () => ({
      id: "upload-1",
      type: "image" as const,
      name: "shot.png",
      mediaType: "image/png",
      path: "uploads/upload-1.png",
    })),
  };
});

describe("CommentsTab image paste", () => {
  it("uploads a pasted image and inserts a Markdown reference into the comment body", async () => {
    render(
      <CommentsTab
        comments={[]}
        loading={false}
        error={null}
        projectSlug="gamba"
        onAddComment={vi.fn()}
      />,
    );

    const textarea = screen.getByRole("textbox");
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
        files: [file],
      },
    });

    await waitFor(() =>
      expect((textarea as HTMLTextAreaElement).value).toContain(
        "![shot.png](/api/tracker/v1/projects/gamba/assistant/attachments/uploads/upload-1.png)",
      ),
    );
  });
});
