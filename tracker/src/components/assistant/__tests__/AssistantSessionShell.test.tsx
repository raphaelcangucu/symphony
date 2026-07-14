import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssistantSessionShell } from "@/components/assistant/AssistantSessionShell";

describe("AssistantSessionShell", () => {
  it("keeps a single feed scroller and pins composer outside it", () => {
    render(
      <AssistantSessionShell
        toolbar={<div>toolbar</div>}
        feed={<div>feed-body</div>}
        dock={<div>approval-dock</div>}
        composer={<div>composer-body</div>}
      />,
    );

    const root = screen.getByTestId("assistant-session-shell");
    expect(root).toHaveClass("assistant-chat-typography");
    expect(root).not.toHaveClass("rounded-xl", "shadow-sm");

    const feed = screen.getByTestId("assistant-session-feed");
    expect(feed.className).toMatch(/overflow-y-auto/);
    expect(feed).toHaveTextContent("feed-body");
    expect(feed).not.toHaveTextContent("composer-body");

    expect(screen.getByTestId("assistant-session-composer")).toHaveTextContent("composer-body");
    expect(screen.getByTestId("assistant-session-composer").className).toMatch(/shrink-0/);
  });

  it("renders feedOverlay as a sibling of the feed scroller, not inside it", () => {
    render(
      <AssistantSessionShell
        feed={<div>feed-body</div>}
        feedOverlay={<div data-testid="scroll-to-bottom">overlay</div>}
        composer={<div>composer-body</div>}
      />,
    );

    const feed = screen.getByTestId("assistant-session-feed");
    const overlay = screen.getByTestId("scroll-to-bottom");
    expect(feed).not.toContainElement(overlay);
    expect(overlay).toBeInTheDocument();
  });

  it("renders optional environment overlay without creating a second page scroller on root", () => {
    render(
      <AssistantSessionShell
        feed={<div>feed</div>}
        composer={<div>composer</div>}
        environment={<div data-testid="env-panel">env</div>}
      />,
    );
    const root = screen.getByTestId("assistant-session-shell");
    expect(root.className).toMatch(/overflow-hidden/);
    expect(root.className).not.toMatch(/overflow-y-auto/);
    expect(screen.getByTestId("env-panel")).toBeInTheDocument();
  });
});
