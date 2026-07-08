import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssuePreviewDock } from "@/components/sessions/IssuePreviewDock";
import { initTestI18n } from "@/i18n/testUtils";
import type { IssueDevServersResponse } from "@/types/issue";

const useIssueDevServersMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useIssueDevServers", () => ({
  useIssueDevServers: (...args: unknown[]) => useIssueDevServersMock(...args),
}));

function devServersResult(overrides: Partial<ReturnType<typeof baseResult>> = {}) {
  return { ...baseResult(), ...overrides };
}

function baseResult() {
  return {
    data: null as IssueDevServersResponse | null,
    loading: false,
    error: null as string | null,
    refresh: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    startServer: vi.fn(),
    stopServer: vi.fn(),
    restartServer: vi.fn(),
    startTunnel: vi.fn(),
  };
}

function readyResponse(): IssueDevServersResponse {
  return {
    available: true,
    reason: "ok" as IssueDevServersResponse["reason"],
    servers: [
      {
        id: 1,
        slug: "web",
        working_dir: "web",
        port: 5173,
        url: "http://myhost:5173/",
        status: "ready",
        primary: true,
        session_name: "dev-web",
      },
    ],
    tunnel: { enabled: false, running: false },
  };
}

function renderDock({
  fullscreen = false,
  onToggleFullscreen = () => {},
  onClose = () => {},
}: {
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onClose?: () => void;
} = {}) {
  const splitContainerRef = createRef<HTMLDivElement>();

  return render(
    <div ref={splitContainerRef} style={{ width: 1200 }}>
      <IssuePreviewDock
        projectSlug="macro-markets"
        issueIdentifier="510"
        splitContainerRef={splitContainerRef}
        fullscreen={fullscreen}
        onToggleFullscreen={onToggleFullscreen}
        onClose={onClose}
      />
    </div>,
  );
}

describe("IssuePreviewDock", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    window.localStorage.clear();
    useIssueDevServersMock.mockReset();
    useIssueDevServersMock.mockReturnValue(devServersResult());
  });

  it("renders resize, fullscreen and close controls in split mode", () => {
    renderDock();

    expect(screen.getByRole("button", { name: "Resize preview panel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand preview to full screen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close preview panel" })).toBeInTheDocument();
  });

  it("embeds the dev server url in an iframe when the server is ready", () => {
    useIssueDevServersMock.mockReturnValue(devServersResult({ data: readyResponse() }));

    renderDock();

    const frame = screen.getByTitle("Dev server preview for 510");
    expect(frame).toHaveAttribute("src", "http://localhost:5173/");
    expect(screen.getByRole("button", { name: "Reload preview" })).toBeInTheDocument();
  });

  it("offers to start the dev server when none is running", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    useIssueDevServersMock.mockReturnValue(
      devServersResult({
        start,
        data: {
          available: true,
          reason: "ok" as IssueDevServersResponse["reason"],
          servers: [],
          tunnel: { enabled: false, running: false },
        },
      }),
    );

    renderDock();

    expect(screen.getByText("No dev server is running for this issue yet.")).toBeInTheDocument();
    // The header action and the empty-state CTA both start the server.
    const [headerStart] = screen.getAllByRole("button", { name: "Start dev server" });
    await user.click(headerStart!);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("invokes close and fullscreen callbacks", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onToggleFullscreen = vi.fn();

    renderDock({ onClose, onToggleFullscreen });

    await user.click(screen.getByRole("button", { name: "Expand preview to full screen" }));
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Close preview panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("exits full screen with Escape", async () => {
    const user = userEvent.setup();
    const onToggleFullscreen = vi.fn();

    renderDock({ fullscreen: true, onToggleFullscreen });

    await user.keyboard("{Escape}");

    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
  });
});
