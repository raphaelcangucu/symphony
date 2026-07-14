import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Markdown } from "@/components/ui/markdown";

const fetchAttachmentObjectUrlMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/attachments")>();
  return {
    ...actual,
    fetchAttachmentObjectUrl: (...args: unknown[]) =>
      fetchAttachmentObjectUrlMock(...args),
  };
});

describe("Markdown", () => {
  beforeEach(() => {
    fetchAttachmentObjectUrlMock.mockReset();
    fetchAttachmentObjectUrlMock.mockImplementation(
      async (src: string) => `blob:${src}`,
    );
  });

  it("keeps default document typography and table structure unchanged", () => {
    const { container } = render(
      <Markdown>{"| Name | Value |\n| --- | --- |\n| Alpha | Beta |"}</Markdown>,
    );

    const root = container.firstElementChild;
    const table = container.querySelector("table");
    expect(root).toHaveClass("markdown-body", "text-sm", "leading-6");
    expect(root).not.toHaveClass("markdown-body--assistant");
    expect(table?.parentElement).toBe(root);
  });

  it("renders authenticated images as block media outside paragraphs", async () => {
    const href =
      "http://localhost:4000/api/tracker/v1/projects/gamba/issues/1878/evidence/20260610-1/artifacts/artifacts/screens/home.png";

    const { container } = render(<Markdown>{`![home.png](${href})`}</Markdown>);

    const preview = await screen.findByAltText("home.png");
    expect(fetchAttachmentObjectUrlMock).toHaveBeenCalledWith(href);
    expect(preview).toHaveAttribute("src", `blob:${href}`);
    expect(preview).toHaveAttribute("alt", "home.png");
    expect(preview.closest("button")).toHaveAttribute("type", "button");
    expect(container.querySelector("figure")).not.toBeNull();
    expect(container.querySelector("p figure")).toBeNull();
  });

  it("renders evidence artifact images when alt text contains parentheses", async () => {
    const href =
      "http://localhost:4000/api/tracker/v1/projects/gamba/issues/1878/evidence/20260610-1/artifacts/artifacts/screens/home%20(failed).png";

    render(<Markdown>{`![home \\(failed\\).png](${href})`}</Markdown>);

    const preview = await screen.findByAltText("home (failed).png");
    expect(preview).toHaveAttribute("src", `blob:${href}`);
    expect(preview).toHaveAttribute("alt", "home (failed).png");
  });

  it("renders video links as block media outside paragraphs", async () => {
    const href = "/api/tracker/v1/projects/gamba/assistant/attachments/uploads/demo.webm";

    const { container } = render(
      <Markdown>{`[Screen recording](${href})`}</Markdown>,
    );

    const preview = await screen.findByLabelText("Screen recording");
    expect(fetchAttachmentObjectUrlMock).toHaveBeenCalledWith(href);
    expect(preview).toHaveAttribute("src", `blob:${href}`);
    expect(preview).toHaveAttribute("controls");
    expect(container.querySelector("figure")).not.toBeNull();
    expect(container.querySelector("p figure")).toBeNull();
  });

  it("omits unsafe external links around interactive media", async () => {
    const href = "/api/tracker/v1/projects/gamba/assistant/attachments/uploads/home.png";

    const { container } = render(
      <Markdown>{`[![home.png](${href})](https://example.com/reference)`}</Markdown>,
    );

    await screen.findByAltText("home.png");
    expect(container.querySelector("a button")).toBeNull();
    expect(container.querySelector("button button")).toBeNull();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not invoke custom link wrappers around interactive media", async () => {
    const href = "/api/tracker/v1/projects/gamba/assistant/attachments/uploads/home.png";
    const linkRenderer = vi.fn(
      ({ children }: { children: React.ReactNode }) => (
        <button type="button">{children}</button>
      ),
    );

    const { container } = render(
      <Markdown linkRenderer={linkRenderer}>
        {`[![home.png](${href})](./docs/plan.md)`}
      </Markdown>,
    );

    await screen.findByAltText("home.png");
    expect(linkRenderer).not.toHaveBeenCalled();
    expect(container.querySelector("button button")).toBeNull();
  });

  it("keeps regular links unchanged", () => {
    const { container } = render(
      <Markdown>Ordinary [Example](https://example.com/file.mp4) text.</Markdown>,
    );

    expect(screen.getByRole("link", { name: "Example" })).toHaveAttribute("href", "https://example.com/file.mp4");
    expect(screen.getByText(/Ordinary/).closest("p")).not.toBeNull();
    expect(container.querySelector("p a")).not.toBeNull();
  });

  it("keeps ordinary custom document links interactive inside paragraphs", () => {
    const linkRenderer = vi.fn(
      ({ children }: { children: React.ReactNode }) => (
        <button type="button">{children}</button>
      ),
    );

    const { container } = render(
      <Markdown linkRenderer={linkRenderer}>
        {"Read [the plan](./docs/plan.md) first."}
      </Markdown>,
    );

    expect(screen.getByRole("button", { name: "the plan" })).toBeInTheDocument();
    expect(linkRenderer).toHaveBeenCalledOnce();
    expect(container.querySelector("p > button")).not.toBeNull();
  });
});
