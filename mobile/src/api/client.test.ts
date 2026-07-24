import { describe, expect, it, vi } from "vitest";

import {
  TrackerAuthError,
  TrackerProtocolError,
  TrackerRequestError,
  TrackerTimeoutError,
} from "./errors";
import { createTrackerClient } from "./client";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("createTrackerClient", () => {
  it("binds tracker authentication and locale to requests", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { id: "viewer-1", name: "Raphael" } }));
    const client = createTrackerClient({
      origin: "https://demo.test",
      token: "secret",
      locale: "pt-BR",
      fetchImpl,
    });

    await expect(client.viewer()).resolves.toEqual({
      id: "viewer-1",
      name: "Raphael",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://demo.test/api/tracker/v1/viewer",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Bearer secret",
          "X-Symphony-Locale": "pt-BR",
        }),
      }),
    );
  });

  it("keeps health outside the tracker API prefix", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const client = createTrackerClient({
      origin: "https://demo.test/symphony",
      token: "secret",
      locale: "en",
      fetchImpl,
    });

    await expect(client.health()).resolves.toEqual({ status: "ok" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://demo.test/symphony/api/health",
      expect.any(Object),
    );
  });

  it("maps project, thread, and project-session DTOs", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "project-1", slug: "symphony", name: "Symphony" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 42,
              scope: "project_session",
              project_slug: "symphony",
              project_name: "Symphony",
              issue_identifier: null,
              workspace_path: "/work/symphony",
              title: "Build mobile",
              status: "active",
              preview: "Continue",
              updated_at: "2026-07-24T01:00:00Z",
              agent_kind: "codex",
              needs_review: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "thread:42",
              thread_id: 42,
              title: "Build mobile",
              kind: "workspace_session",
              scope: "project_session",
              href: "/tracker/projects/symphony/workspaces/42",
              updated_at: "2026-07-24T01:00:00Z",
              aggregate_status: "running",
              agent_kind: "codex",
              issue_identifier: null,
              workspace_path: "/work/symphony",
              workspace_id: "42",
              pinned: false,
              archived: false,
            },
          ],
          meta: { next_cursor: null },
        }),
      );
    const client = createTrackerClient({
      origin: "https://demo.test",
      token: "secret",
      locale: "en",
      fetchImpl,
    });

    await expect(client.projects()).resolves.toEqual([
      { id: "project-1", slug: "symphony", name: "Symphony" },
    ]);
    await expect(client.threads({ limit: 100, includeArchived: false })).resolves.toEqual([
      expect.objectContaining({
        id: 42,
        projectSlug: "symphony",
        workspacePath: "/work/symphony",
        needsReview: true,
      }),
    ]);
    await expect(client.projectSessions("symphony", { limit: 50 })).resolves.toEqual({
      sessions: [
        expect.objectContaining({
          id: "thread:42",
          threadId: 42,
          href: "/projects/symphony/workspaces/42",
          aggregateStatus: "running",
        }),
      ],
      nextCursor: null,
    });
  });

  it("encodes thread list queries and thread creation payloads", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              id: 7,
              scope: "issue_session",
              project_slug: "mobile app",
              issue_identifier: "MOB-7",
              title: null,
              status: "idle",
            },
          },
          { status: 201 },
        ),
      );
    const client = createTrackerClient({
      origin: "https://demo.test",
      token: "secret",
      locale: "en",
      fetchImpl,
    });

    await client.threads({
      scopes: ["freeform", "project_session"],
      projectSlug: "mobile app",
      limit: 100,
      includeArchived: true,
    });
    await client.createThread({
      scope: "issue_session",
      projectSlug: "mobile app",
      issueIdentifier: "MOB-7",
      isolatedWorkspace: true,
      cloneBranch: "main",
      agentKind: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
    });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://demo.test/api/tracker/v1/assistant/threads?scopes=freeform%2Cproject_session&project_slug=mobile+app&limit=100&include_archived=true",
    );
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://demo.test/api/tracker/v1/assistant/threads");
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      scope: "issue_session",
      project_slug: "mobile app",
      issue_identifier: "MOB-7",
      isolated_workspace: true,
      clone_branch: "main",
      agent_kind: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
    });
  });

  it("throws a redacted auth error for unauthorized responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: "Bearer secret-token is invalid",
          },
        },
        { status: 401 },
      ),
    );
    const client = createTrackerClient({
      origin: "https://demo.test",
      token: "secret-token",
      locale: "en",
      fetchImpl,
    });

    const request = client.viewer();

    await expect(request).rejects.toBeInstanceOf(TrackerAuthError);
    await expect(request).rejects.not.toThrow("secret-token");
  });

  it("distinguishes protocol, request, and timeout failures", async () => {
    const protocolClient = createTrackerClient({
      origin: "https://demo.test",
      token: "secret",
      locale: "en",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("<html>bad gateway</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    });
    const requestClient = createTrackerClient({
      origin: "https://demo.test",
      token: "secret",
      locale: "en",
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")),
    });
    const timeoutClient = createTrackerClient({
      origin: "https://demo.test",
      token: "secret",
      locale: "en",
      timeoutMs: 1,
      fetchImpl: vi.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      ),
    });

    await expect(protocolClient.viewer()).rejects.toBeInstanceOf(TrackerProtocolError);
    await expect(requestClient.viewer()).rejects.toBeInstanceOf(TrackerRequestError);
    await expect(timeoutClient.viewer()).rejects.toBeInstanceOf(TrackerTimeoutError);
  });
});
