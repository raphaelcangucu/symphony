import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useIssueDevServers, type UseIssueDevServersResult } from "@/hooks/useIssueDevServers";
import type { IssueDevServer, IssueDevServerTunnel, IssueDevServersResponse } from "@/types/issue";

import { PreviewTab } from "../PreviewTab";

vi.mock("@/hooks/useIssueDevServers", () => ({
  useIssueDevServers: vi.fn(),
}));

const navigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

const hookActions = {
  refresh: vi.fn(),
  restart: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  startTunnel: vi.fn(),
};

describe("PreviewTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    navigate.mockReset();
    for (const action of Object.values(hookActions)) {
      action.mockResolvedValue(undefined);
    }
  });

  it("renders the primary preview link and manual controls when ready", () => {
    renderPreview(
      response([
        server({ id: 1, slug: "api", status: "ready", url: "http://127.0.0.1:4000", primary: false }),
        server({ id: 2, slug: "web", status: "ready", url: "http://127.0.0.1:5173", primary: true }),
      ]),
    );

    const link = screen.getByRole("link", { name: /^open preview$/i });
    expect(link).toHaveAttribute("href", "http://127.0.0.1:5173");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));

    expect(screen.getByRole("button", { name: /^start preview$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^stop preview$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^restart preview$/i })).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^open api preview$/i })).toHaveAttribute(
      "href",
      "http://127.0.0.1:4000",
    );
    expect(screen.getByRole("link", { name: /^open web preview$/i })).toHaveAttribute(
      "href",
      "http://127.0.0.1:5173",
    );
  });

  it("shows public tunnel and localhost URLs for a ready server when the tunnel is running", () => {
    renderPreview(
      response(
        [
          server({
            id: 1,
            slug: "back",
            status: "ready",
            port: 4102,
            url: "https://macro-markets-510-back.example.tracker.cods.dev/admin",
            primary: true,
          }),
        ],
        { enabled: true, running: true },
      ),
    );

    expect(screen.getByText(/public preview urls/i)).toBeInTheDocument();
    const publicLinks = screen.getAllByRole("link", {
      name: "https://macro-markets-510-back.example.tracker.cods.dev/admin",
    });
    expect(publicLinks.length).toBeGreaterThan(0);
    for (const link of publicLinks) {
      expect(link).toHaveAttribute("href", "https://macro-markets-510-back.example.tracker.cods.dev/admin");
    }
    const localLinks = screen.getAllByRole("link", { name: "http://127.0.0.1:4102/admin" });
    expect(localLinks.length).toBeGreaterThan(0);
    for (const link of localLinks) {
      expect(link).toHaveAttribute("href", "http://127.0.0.1:4102/admin");
    }
  });

  it("does not duplicate a localhost URL when the preview already points at loopback", () => {
    renderPreview(response([server({ status: "ready", port: 5173, url: "http://127.0.0.1:5173" })]));

    expect(screen.queryByText(/^Local:/)).not.toBeInTheDocument();
  });

  it("renders a disabled availability message", () => {
    renderPreview({ available: false, reason: "disabled", servers: [] });

    expect(screen.getByText(/dev-server previews are disabled/i)).toBeInTheDocument();
  });

  it("renders provisioning status while a server is starting", () => {
    renderPreview(response([server({ status: "starting", url: null, port: null })]));

    expect(screen.getByRole("status")).toHaveTextContent(/preview is being provisioned/i);
    expect(screen.getByText(/^starting$/i)).toBeInTheDocument();
  });

  it.each(["stopped", "crashed"] as const)("does not present a persisted %s URL as the ready preview", (status) => {
    renderPreview(response([server({ status, url: "http://127.0.0.1:5173" })]));

    expect(screen.queryByText(/preview is ready/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^open preview$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^open web preview$/i })).not.toBeInTheDocument();
  });

  it("disables manual controls when previews are unavailable", () => {
    renderPreview({ available: false, reason: "disabled", servers: [] });

    expect(screen.getByRole("button", { name: /^start preview$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^stop preview$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^restart preview$/i })).toBeDisabled();
  });

  it("renders a lock unavailable reason message", () => {
    renderPreview({ available: false, reason: "lock_unavailable", servers: [] });

    expect(screen.getByText(/preview is already being changed/i)).toBeInTheDocument();
  });

  it("does not render the removed capacity barrier message", () => {
    renderPreview({ available: false, reason: "capacity" as unknown as IssueDevServersResponse["reason"], servers: [] });

    expect(screen.queryByText(/preview capacity is full/i)).not.toBeInTheDocument();
  });

  it("offers assistant handoff when preview start failed", async () => {
    const user = userEvent.setup();
    renderPreview({ available: false, reason: "start_failed", servers: [] });

    await user.click(screen.getByRole("button", { name: /ask assistant to fix/i }));

    expect(navigate).toHaveBeenCalledWith("/projects/macro-markets/board/issues/MAC-1/agent");
    expect(sessionStorage.getItem("symphony:preview-assistant-handoff")).toContain("preview dev server failed");
  });

  it("offers assistant handoff when a dev server crashed", async () => {
    const user = userEvent.setup();
    renderPreview(response([server({ status: "crashed", url: null, port: 4100 })]));

    const handoffButtons = screen.getAllByRole("button", { name: /ask assistant to fix/i });
    await user.click(handoffButtons[0]!);

    expect(navigate).toHaveBeenCalledWith("/projects/macro-markets/board/issues/MAC-1/agent");
    const stored = sessionStorage.getItem("symphony:preview-assistant-handoff");
    expect(stored).toContain("preview dev server failed");
    expect(stored).toContain("sym-issue-macro-markets-MAC-1-web");
  });

  it("calls start when Start Preview is clicked", async () => {
    const user = userEvent.setup();
    renderPreview(response([]));

    await user.click(screen.getByRole("button", { name: /^start preview$/i }));

    expect(hookActions.start).toHaveBeenCalledTimes(1);
  });

  it("warns and shows only localhost URLs when the tunnel is enabled but not running", () => {
    renderPreview(
      response(
        [
          server({
            id: 1,
            slug: "back",
            status: "ready",
            port: 4102,
            url: "https://macro-markets-510-back.example.tracker.cods.dev/admin",
            primary: true,
          }),
        ],
        { enabled: true, running: false },
      ),
    );

    expect(screen.getByText(/cloudflare tunnel is not running/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start tunnel/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "https://macro-markets-510-back.example.tracker.cods.dev/admin" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^open preview$/i })).toHaveAttribute(
      "href",
      "http://127.0.0.1:4102/admin",
    );
    expect(screen.getByRole("link", { name: /^open back preview$/i })).toHaveAttribute(
      "href",
      "http://127.0.0.1:4102/admin",
    );
  });

  it("calls startTunnel when Start tunnel is clicked", async () => {
    const user = userEvent.setup();
    renderPreview(
      response(
        [server({ id: 1, slug: "back", status: "ready", port: 4102, url: "https://x.example.tracker.cods.dev/", primary: true })],
        { enabled: true, running: false },
      ),
    );

    await user.click(screen.getByRole("button", { name: /start tunnel/i }));

    expect(hookActions.startTunnel).toHaveBeenCalledTimes(1);
  });
});

function renderPreview(data: IssueDevServersResponse, overrides: Partial<UseIssueDevServersResult> = {}) {
  vi.mocked(useIssueDevServers).mockReturnValue({
    data,
    error: null,
    loading: false,
    ...hookActions,
    ...overrides,
  });

  render(<PreviewTab projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" />);
}

function response(servers: IssueDevServer[], tunnel?: IssueDevServerTunnel): IssueDevServersResponse {
  return { available: true, reason: null, servers, ...(tunnel ? { tunnel } : {}) };
}

function server(overrides: Partial<IssueDevServer> = {}): IssueDevServer {
  return {
    id: 1,
    port: 5173,
    primary: true,
    session_name: "sym-issue-macro-markets-MAC-1-web",
    slug: "web",
    status: "ready",
    url: "http://127.0.0.1:5173",
    working_dir: "tracker",
    ...overrides,
  };
}
