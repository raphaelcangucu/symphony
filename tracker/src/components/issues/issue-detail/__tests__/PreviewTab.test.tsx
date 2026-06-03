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

  it("shows the localhost URL alongside a public tunnel preview", () => {
    renderPreview(
      response([
        server({
          id: 1,
          slug: "back",
          status: "ready",
          port: 4102,
          url: "https://macro-markets-510-back.example.tracker.cods.dev/admin",
          primary: true,
        }),
      ]),
    );

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
