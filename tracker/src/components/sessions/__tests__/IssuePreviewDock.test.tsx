import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssuePreviewDock } from "@/components/sessions/IssuePreviewDock";
import { initTestI18n } from "@/i18n/testUtils";
import type { IssueDevServer, IssueDevServersResponse } from "@/types/issue";

const useIssueDevServersMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useIssueDevServers", () => ({
  useIssueDevServers: (...args: unknown[]) => useIssueDevServersMock(...args),
}));

vi.mock("@/components/issues/issue-detail/PreviewTab", () => ({
  PreviewPanel: ({ projectSlug, issueIdentifier }: { projectSlug: string; issueIdentifier: string }) => (
    <div data-testid="preview-panel" data-project={projectSlug} data-issue={issueIdentifier} />
  ),
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

function server(overrides: Partial<IssueDevServer> = {}): IssueDevServer {
  return {
    id: 1,
    slug: "web",
    working_dir: "web",
    port: 5173,
    url: "http://myhost:5173/",
    status: "ready",
    primary: true,
    session_name: "dev-web",
    ...overrides,
  };
}

function response(servers: IssueDevServer[]): IssueDevServersResponse {
  return {
    available: true,
    reason: "ok" as IssueDevServersResponse["reason"],
    servers,
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
        view="board"
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

  it("renders resize, details, fullscreen and close controls in split mode", () => {
    renderDock();

    expect(screen.getByRole("button", { name: "Resize preview panel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show dev server details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand preview to full screen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close preview panel" })).toBeInTheDocument();
  });

  it("embeds the dev server url in an iframe when the server is ready", () => {
    useIssueDevServersMock.mockReturnValue(devServersResult({ data: response([server()]) }));

    renderDock();

    const frame = screen.getByTitle("Dev server preview for 510");
    expect(frame).toHaveAttribute("src", "http://localhost:5173/");
    expect(screen.getByRole("button", { name: "Reload preview" })).toBeInTheDocument();
    expect(screen.queryByTestId("preview-panel")).not.toBeInTheDocument();
  });

  it("falls back to the management panel when no server is ready", () => {
    useIssueDevServersMock.mockReturnValue(
      devServersResult({ data: response([server({ status: "crashed" })]) }),
    );

    renderDock();

    expect(screen.queryByTitle("Dev server preview for 510")).not.toBeInTheDocument();
    const panel = screen.getByTestId("preview-panel");
    expect(panel).toHaveAttribute("data-project", "macro-markets");
    expect(panel).toHaveAttribute("data-issue", "510");
  });

  it("toggles the management panel from the details button while a preview is live", async () => {
    const user = userEvent.setup();
    useIssueDevServersMock.mockReturnValue(devServersResult({ data: response([server()]) }));

    renderDock();

    await user.click(screen.getByRole("button", { name: "Show dev server details" }));
    expect(screen.getByTestId("preview-panel")).toBeInTheDocument();
    expect(screen.queryByTitle("Dev server preview for 510")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide dev server details" }));
    expect(screen.queryByTestId("preview-panel")).not.toBeInTheDocument();
    expect(screen.getByTitle("Dev server preview for 510")).toBeInTheDocument();
  });

  it("shows one tab per server and switches the iframe to the selected server", async () => {
    const user = userEvent.setup();
    useIssueDevServersMock.mockReturnValue(
      devServersResult({
        data: response([
          server(),
          server({ id: 2, slug: "api", working_dir: "api", port: 8080, url: "http://myhost:8080/", primary: false }),
        ]),
      }),
    );

    renderDock();

    expect(screen.getByRole("tab", { name: "Preview web (ready)" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTitle("Dev server preview for 510")).toHaveAttribute("src", "http://localhost:5173/");

    await user.click(screen.getByRole("tab", { name: "Preview api (ready)" }));

    expect(screen.getByRole("tab", { name: "Preview api (ready)" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTitle("Dev server preview for 510")).toHaveAttribute("src", "http://localhost:8080/");
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

  it("lets the user navigate the iframe by editing the URL and pressing Enter", async () => {
    const user = userEvent.setup();
    useIssueDevServersMock.mockReturnValue(devServersResult({ data: response([server({ port: 4300 })]) }));

    renderDock();

    const urlInput = screen.getByRole("textbox", { name: "Preview URL" });
    expect(urlInput).toHaveValue("http://localhost:4300/");
    expect(screen.getByTitle("Dev server preview for 510")).toHaveAttribute("src", "http://localhost:4300/");

    await user.clear(urlInput);
    await user.type(
      urlInput,
      "http://mtu.localhost:4301/advisor/32555201/student-advising-note#/Advising%20Notes{Enter}",
    );

    expect(urlInput).toHaveValue(
      "http://mtu.localhost:4301/advisor/32555201/student-advising-note#/Advising%20Notes",
    );
    expect(screen.getByTitle("Dev server preview for 510")).toHaveAttribute(
      "src",
      "http://mtu.localhost:4301/advisor/32555201/student-advising-note#/Advising%20Notes",
    );
    expect(screen.getByRole("link", { name: "Open preview in new tab" })).toHaveAttribute(
      "href",
      "http://mtu.localhost:4301/advisor/32555201/student-advising-note#/Advising%20Notes",
    );
  });

  it("resolves relative paths against the current preview URL on Enter", async () => {
    const user = userEvent.setup();
    useIssueDevServersMock.mockReturnValue(devServersResult({ data: response([server({ port: 4300 })]) }));

    renderDock();

    const urlInput = screen.getByRole("textbox", { name: "Preview URL" });
    await user.clear(urlInput);
    await user.type(urlInput, "/dashboard{Enter}");

    expect(urlInput).toHaveValue("http://localhost:4300/dashboard");
    expect(screen.getByTitle("Dev server preview for 510")).toHaveAttribute("src", "http://localhost:4300/dashboard");
  });

  it("resets the URL bar when switching server tabs", async () => {
    const user = userEvent.setup();
    useIssueDevServersMock.mockReturnValue(
      devServersResult({
        data: response([
          server({ port: 4300 }),
          server({ id: 2, slug: "api", working_dir: "api", port: 8080, url: "http://myhost:8080/", primary: false }),
        ]),
      }),
    );

    renderDock();

    const urlInput = screen.getByRole("textbox", { name: "Preview URL" });
    await user.clear(urlInput);
    await user.type(urlInput, "http://mtu.localhost:4301/advisor{Enter}");
    expect(screen.getByTitle("Dev server preview for 510")).toHaveAttribute("src", "http://mtu.localhost:4301/advisor");

    await user.click(screen.getByRole("tab", { name: "Preview api (ready)" }));

    expect(urlInput).toHaveValue("http://localhost:8080/");
    expect(screen.getByTitle("Dev server preview for 510")).toHaveAttribute("src", "http://localhost:8080/");
  });
});
