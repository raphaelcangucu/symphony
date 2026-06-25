import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Markdown } from "@/components/ui/markdown";

vi.mock("@/components/shared/AttachmentVideo", () => ({
  AttachmentVideo: ({ src, label }: { src: string; label: string }) => (
    <div data-testid="attachment-video" data-src={src}>
      {label}
    </div>
  ),
}));

vi.mock("@/components/shared/AttachmentImage", () => ({
  AttachmentImage: ({ src, alt }: { src: string; alt: string }) => (
    <img data-testid="attachment-image" src={src} alt={alt} />
  ),
}));

describe("Markdown", () => {
  it("renders evidence artifact images through the authenticated preview", () => {
    const href =
      "http://localhost:4000/api/tracker/v1/projects/gamba/issues/1878/evidence/20260610-1/artifacts/artifacts/screens/home.png";

    render(<Markdown>{`![home.png](${href})`}</Markdown>);

    const preview = screen.getByTestId("attachment-image");
    expect(preview).toHaveAttribute("src", href);
    expect(preview).toHaveAttribute("alt", "home.png");
  });

  it("renders evidence artifact images when alt text contains parentheses", () => {
    const href =
      "http://localhost:4000/api/tracker/v1/projects/gamba/issues/1878/evidence/20260610-1/artifacts/artifacts/screens/home%20(failed).png";

    render(<Markdown>{`![home \\(failed\\).png](${href})`}</Markdown>);

    const preview = screen.getByTestId("attachment-image");
    expect(preview).toHaveAttribute("src", href);
    expect(preview).toHaveAttribute("alt", "home (failed).png");
  });

  it("renders internal video attachment links as previews", () => {
    const href = "/api/tracker/v1/projects/gamba/assistant/attachments/uploads/demo.webm";

    render(<Markdown>{`[Screen recording](${href})`}</Markdown>);

    const preview = screen.getByTestId("attachment-video");
    expect(preview).toHaveAttribute("data-src", href);
    expect(preview).toHaveTextContent("Screen recording");
  });

  it("renders evidence artifact video links as previews", () => {
    const href =
      "http://localhost:4000/api/tracker/v1/projects/gamba/issues/1878/evidence/20260610-1/artifacts/artifacts/videos/flow.webm";

    render(<Markdown>{`[e2e recording](${href})`}</Markdown>);

    const preview = screen.getByTestId("attachment-video");
    expect(preview).toHaveAttribute("data-src", href);
    expect(preview).toHaveTextContent("e2e recording");
  });

  it("keeps regular links unchanged", () => {
    render(<Markdown>[Example](https://example.com/file.mp4)</Markdown>);

    expect(screen.queryByTestId("attachment-video")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Example" })).toHaveAttribute("href", "https://example.com/file.mp4");
  });
});
