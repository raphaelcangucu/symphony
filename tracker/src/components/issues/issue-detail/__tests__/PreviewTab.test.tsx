import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useIssueDevServers, type UseIssueDevServersResult } from "@/hooks/useIssueDevServers";
import type { IssueDevServer, IssueDevServersResponse } from "@/types/issue";

import { PreviewTab } from "../PreviewTab";

vi.mock("@/hooks/useIssueDevServers", () => ({
  useIssueDevServers: vi.fn(),
}));

const hookActions = {
  refresh: vi.fn(),
  restart: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};

describe("PreviewTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const link = screen.getByRole("link", { name: /open preview/i });
    expect(link).toHaveAttribute("href", "http://127.0.0.1:5173");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));

    expect(screen.getByRole("button", { name: /^start preview$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^stop preview$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^restart preview$/i })).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
  });

  it("renders a disabled availability message", () => {
    renderPreview({ available: false, reason: "disabled", servers: [] });

    expect(screen.getByText(/dev-server previews are disabled/i)).toBeInTheDocument();
  });

  it("renders provisioning status while a server is starting", () => {
    renderPreview(response([server({ status: "starting", url: null, port: null })]));

    expect(screen.getByText(/preview is being provisioned/i)).toBeInTheDocument();
    expect(screen.getByText(/^starting$/i)).toBeInTheDocument();
  });

  it("calls start when Start Preview is clicked", async () => {
    const user = userEvent.setup();
    renderPreview(response([]));

    await user.click(screen.getByRole("button", { name: /^start preview$/i }));

    expect(hookActions.start).toHaveBeenCalledTimes(1);
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

  render(<PreviewTab projectSlug="macro-markets" issueIdentifier="MAC-1" />);
}

function response(servers: IssueDevServer[]): IssueDevServersResponse {
  return { available: true, reason: null, servers };
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
