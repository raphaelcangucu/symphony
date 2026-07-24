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

vi.mock("@/services/issueDevServers", () => ({
  fetchDevServerOutput: vi.fn(async () => ({ output: "", session_name: "" })),
  subscribeDevServerOutput: vi.fn(() => () => undefined),
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
  restartServer: vi.fn(),
  start: vi.fn(),
  startServer: vi.fn(),
  stop: vi.fn(),
  stopServer: vi.fn(),
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

  it("renders status strip without a card title heading", () => {
    renderPreview(response([server({ status: "ready" })]));

    expect(screen.getByLabelText(/^preview status$/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^issue preview$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^issue preview$/i)).not.toBeInTheDocument();
  });

  it("renders one ready CTA, secondary controls, and compact server metadata", () => {
    renderPreview(
      response([
        server({ id: 1, slug: "api", status: "ready", port: 4000, url: "http://127.0.0.1:4000", primary: false }),
        server({ id: 2, slug: "web", status: "ready", url: "http://127.0.0.1:5173", primary: true }),
      ]),
    );

    expect(screen.getByLabelText(/^preview status$/i)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /^open preview$/i });
    expect(link).toHaveAttribute("href", "http://127.0.0.1:5173");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));

    expect(screen.queryByRole("button", { name: /^start preview$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^stop preview$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^restart preview$/i })).toBeInTheDocument();
    expect(screen.getByText("api · :4000 · ready")).toBeInTheDocument();
    expect(screen.getByText("web · :5173 · ready")).toBeInTheDocument();
    expect(screen.getByText("primary")).toBeInTheDocument();
    expect(screen.getAllByText("http://127.0.0.1:5173")).toHaveLength(1);
    expect(screen.queryByText(/preview is ready from/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^open api preview$/i })).not.toBeInTheDocument();
  });

  it("shows tunnel state inline and both tunnel and local ready URLs when the tunnel is running", () => {
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

    expect(screen.getByText(/tunnel: running/i)).toBeInTheDocument();
    expect(screen.queryByText(/public preview urls/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^open preview$/i })).toHaveAttribute(
      "href",
      "https://macro-markets-510-back.example.tracker.cods.dev/admin",
    );
    expect(screen.getByText(/^Tunnel:$/)).toBeInTheDocument();
    expect(screen.getByText(/^Local:$/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://macro-markets-510-back.example.tracker.cods.dev/admin" }),
    ).toHaveAttribute("href", "https://macro-markets-510-back.example.tracker.cods.dev/admin");
    expect(screen.getByRole("link", { name: "http://localhost:4102/admin" })).toHaveAttribute(
      "href",
      "http://localhost:4102/admin",
    );
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

  it("does not show a provisioning callout for stopped dev servers", () => {
    renderPreview(response([server({ status: "stopped", url: null, port: null })]));

    expect(screen.queryByText(/preview is being provisioned/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/start preview to request a new run/i)).not.toBeInTheDocument();
  });

  it.each(["stopped", "crashed"] as const)("does not present a persisted %s URL as the ready preview", (status) => {
    renderPreview(response([server({ status, url: "http://127.0.0.1:5173" })]));

    expect(screen.queryByText(/preview is ready/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^open preview$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^open web preview$/i })).not.toBeInTheDocument();
  });

  it("shows a conflict callout and no open link when a ready server bound an out-of-lease port", () => {
    renderPreview(
      response([
        server({
          status: "ready",
          sync_state: "conflict",
          sync_reason: "actual port 59595 is outside allowed ports [4300, 4301]",
          port: 59595,
          url: "http://127.0.0.1:59595/",
          local_url: "http://127.0.0.1:59595/",
        }),
      ]),
    );

    expect(screen.getByText(/preview is out of sync/i)).toBeInTheDocument();
    expect(screen.getByText(/59595 is outside allowed ports/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^open preview$/i })).not.toBeInTheDocument();
  });

  it("disables manual controls when previews are unavailable", () => {
    renderPreview({ available: false, reason: "disabled", servers: [] });

    expect(screen.queryByRole("button", { name: /^start preview$/i })).not.toBeInTheDocument();
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

    expect(navigate).toHaveBeenCalledWith("/projects/macro-markets/board/issues/MAC-1/sessions");
    expect(sessionStorage.getItem("symphony:preview-assistant-handoff")).toContain("preview dev server failed");
  });

  it("offers assistant handoff when a dev server crashed", async () => {
    const user = userEvent.setup();
    renderPreview(response([server({ status: "crashed", url: null, port: 4100 })]));

    const handoffButtons = screen.getAllByRole("button", { name: /ask assistant to fix/i });
    await user.click(handoffButtons[0]!);

    expect(navigate).toHaveBeenCalledWith("/projects/macro-markets/board/issues/MAC-1/sessions");
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

  it("calls per-server controls for each dev server row", async () => {
    const user = userEvent.setup();
    renderPreview(
      response([
        server({ id: 10, slug: "api", status: "ready", url: "http://127.0.0.1:4000", primary: false }),
        server({ id: 20, slug: "web", status: "ready", url: "http://127.0.0.1:5173", primary: true }),
      ]),
    );

    await user.click(screen.getByRole("button", { name: /^start api preview$/i }));
    await user.click(screen.getByRole("button", { name: /^stop web preview$/i }));
    await user.click(screen.getByRole("button", { name: /^restart api preview$/i }));

    expect(hookActions.startServer).toHaveBeenCalledWith(10);
    expect(hookActions.stopServer).toHaveBeenCalledWith(20);
    expect(hookActions.restartServer).toHaveBeenCalledWith(10);
  });

  it("shows stopped tunnel state inline with both tunnel and local ready URLs", () => {
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

    expect(screen.getByText(/tunnel: stopped/i)).toBeInTheDocument();
    expect(screen.queryByText(/cloudflare tunnel is not running/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start tunnel/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^open preview$/i })).toHaveAttribute(
      "href",
      "http://localhost:4102/admin",
    );
    expect(screen.getByText(/^Tunnel:$/)).toBeInTheDocument();
    expect(screen.getByText(/^Local:$/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://macro-markets-510-back.example.tracker.cods.dev/admin" }),
    ).toHaveAttribute("href", "https://macro-markets-510-back.example.tracker.cods.dev/admin");
    expect(screen.getByRole("link", { name: "http://localhost:4102/admin" })).toHaveAttribute(
      "href",
      "http://localhost:4102/admin",
    );
    expect(screen.queryByRole("link", { name: /^open back preview$/i })).not.toBeInTheDocument();
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
