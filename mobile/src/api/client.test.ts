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
      requestKey: "create-mobile-7",
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
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toEqual(
      expect.objectContaining({ "Idempotency-Key": "create-mobile-7" }),
    );
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

  it("maps issue operations and binds encoded issue routes", async () => {
    const issueDto = {
      id: "issue-7",
      identifier: "MOB-7",
      display_identifier: "MOB-7",
      project_slug: "mobile app",
      title: "Bring Orca workflows",
      description: "Complete task operations",
      status: { id: "started", name: "In Progress", category: "started" },
      priority: 1,
      position: 2,
      labels: ["mobile", "orca"],
      blocked_by: [],
      assignee_id: "raphael",
      creator: "raphael",
      agent_kind: "codex",
      agent_goal: "Ship the app",
      branch_name: "agent/mobile",
      inserted_at: "2026-07-24T01:00:00Z",
      updated_at: "2026-07-24T02:00:00Z",
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [issueDto] }))
      .mockResolvedValueOnce(jsonResponse({ data: issueDto }))
      .mockResolvedValueOnce(jsonResponse({ data: issueDto }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...issueDto, title: "Updated" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "comment-1",
              body: "Continue",
              author: "raphael",
              kind: "comment",
              inserted_at: "2026-07-24T02:30:00Z",
              updated_at: "2026-07-24T02:30:00Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              id: "comment-2",
              body: "Done",
              author: "raphael",
              kind: "comment",
              inserted_at: "2026-07-24T02:40:00Z",
              updated_at: "2026-07-24T02:40:00Z",
            },
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              identifier: "MOB-3",
              title: "Foundation",
              status: "In Progress",
              relation_type: "blocked_by",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            action: "continue_work",
            message: "Agent continued",
            issue: issueDto,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { status: "running" } }));
    const client = createTrackerClient({
      origin: "https://demo.test",
      token: "secret",
      locale: "en",
      fetchImpl,
    });

    await expect(client.issues("mobile app", { query: "Orca" })).resolves.toEqual([
      expect.objectContaining({
        identifier: "MOB-7",
        projectSlug: "mobile app",
        status: "In Progress",
        labels: ["mobile", "orca"],
      }),
    ]);
    await client.issue("mobile app", "MOB/7");
    await client.createIssue("mobile app", {
      title: "Bring Orca workflows",
      status: "In Progress",
      priority: 1,
    });
    await client.updateIssue("mobile app", "MOB/7", { title: "Updated" });
    await expect(client.comments("mobile app", "MOB/7")).resolves.toEqual([
      expect.objectContaining({ id: "comment-1", body: "Continue" }),
    ]);
    await client.createComment("mobile app", "MOB/7", "Done");
    await expect(client.blockers("mobile app", "MOB/7")).resolves.toEqual([
      expect.objectContaining({ identifier: "MOB-3", relationType: "blocked_by" }),
    ]);
    await client.dispatchIssue("mobile app", "MOB/7", {
      action: "continue_work",
      instructions: "Finish mobile parity",
    });
    await client.goalControl("mobile app", "MOB/7", { action: "resume" });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues?q=Orca",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7/comments",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7/comments",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7/blockers",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7/dispatch",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7/goal",
    ]);
    expect(fetchImpl.mock.calls[2]?.[1]?.method).toBe("POST");
    expect(fetchImpl.mock.calls[3]?.[1]?.method).toBe("PATCH");
    expect(JSON.parse(String(fetchImpl.mock.calls[7]?.[1]?.body))).toEqual({
      action: "continue_work",
      instructions: "Finish mobile parity",
    });
  });

  it("maps issue creation options", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          statuses: [
            { id: "todo", name: "Todo", category: "unstarted", position: 1 },
            { id: "started", name: "In Progress", category: "started", position: 2 },
          ],
          labels: [{ id: "mobile", name: "Mobile", color: "#60a5fa" }],
          assignees: [{ id: "user-1", login: "raphael", name: "Raphael" }],
          agents: [{ value: "codex", label: "Codex", default: true }],
          effective_agent: "codex",
        },
      }),
    );
    const client = createTrackerClient({
      origin: "https://demo.test",
      token: "secret",
      locale: "en",
      fetchImpl,
    });

    await expect(client.issueFormOptions("mobile app")).resolves.toEqual({
      statuses: ["Todo", "In Progress"],
      labels: [{ id: "mobile", name: "Mobile", color: "#60a5fa" }],
      assignees: [{ id: "user-1", login: "raphael", name: "Raphael" }],
      agents: [{ value: "codex", label: "Codex", default: true }],
      effectiveAgent: "codex",
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/form_options",
    );
  });

  it("maps thread documents and preview servers through encoded routes", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            available: true,
            reason: null,
            documents: [
              {
                id: "docs/plan.md",
                kind: "draft",
                path: "docs/plan.md",
                title: "Mobile plan",
                updated_at: "2026-07-24T02:00:00Z",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { path: "docs/plan.md", content: "# Mobile plan\n\nShip it." },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            available: true,
            reason: null,
            servers: [
              {
                id: 7,
                slug: "app",
                url: "http://127.0.0.1:4000",
                public_url: "https://preview.example.test",
                status: "ready",
                primary: true,
              },
            ],
          },
        }),
      );
    const client = createTrackerClient({
      origin: "https://demo.test",
      token: "secret",
      locale: "en",
      fetchImpl,
    });

    await expect(client.threadDocuments(42)).resolves.toEqual({
      available: true,
      reason: null,
      documents: [
        {
          id: "docs/plan.md",
          kind: "draft",
          path: "docs/plan.md",
          title: "Mobile plan",
          updatedAt: "2026-07-24T02:00:00Z",
        },
      ],
    });
    await expect(client.threadDocument(42, "docs/plan.md")).resolves.toEqual({
      path: "docs/plan.md",
      content: "# Mobile plan\n\nShip it.",
    });
    await expect(client.threadDevServers(42)).resolves.toEqual({
      available: true,
      reason: null,
      servers: [
        expect.objectContaining({
          id: 7,
          slug: "app",
          status: "ready",
          primary: true,
          publicUrl: "https://preview.example.test",
        }),
      ],
    });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://demo.test/api/tracker/v1/assistant/threads/42/documents",
      "https://demo.test/api/tracker/v1/assistant/threads/42/documents/docs/plan.md",
      "https://demo.test/api/tracker/v1/assistant/threads/42/dev_servers",
    ]);
    await expect(client.threadDocument(42, "../secret.md")).rejects.toThrow("safe relative");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("loads thread diff stats, paginated files, and one patch independently", async () => {
    const workspace = { path: "/tmp/mobile app", available: true };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              repo: ".",
              branch: "agent/mobile",
              base: "main",
              files_changed: 2,
              additions: 12,
              deletions: 3,
              untracked: 1,
            },
          ],
          workspace,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          files: [
            {
              repo: ".",
              path: "mobile/src/App.tsx",
              old_path: null,
              status: "modified",
              additions: 12,
              deletions: 3,
              binary: false,
            },
          ],
          total: 2,
          limit: 1,
          next_cursor: "mobile/src/App.tsx",
          workspace,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            repo: ".",
            path: "mobile/src/App.tsx",
            status: "modified",
            binary: false,
            truncated: false,
            patch: "@@ -1 +1 @@\n-old\n+new",
          },
          workspace,
        }),
      );
    const client = createTrackerClient({
      origin: "https://demo.test",
      token: "secret",
      locale: "en",
      fetchImpl,
    });

    await expect(client.threadDiffStats(42, "uncommitted")).resolves.toEqual({
      stats: [
        {
          repo: ".",
          branch: "agent/mobile",
          base: "main",
          filesChanged: 2,
          additions: 12,
          deletions: 3,
          untracked: 1,
        },
      ],
      workspace,
    });
    await expect(
      client.threadDiffFiles(42, {
        type: "uncommitted",
        query: "App",
        limit: 1,
        cursor: "start",
      }),
    ).resolves.toEqual({
      files: [
        {
          repo: ".",
          path: "mobile/src/App.tsx",
          oldPath: null,
          status: "modified",
          additions: 12,
          deletions: 3,
          binary: false,
        },
      ],
      total: 2,
      limit: 1,
      nextCursor: "mobile/src/App.tsx",
      workspace,
    });
    await expect(
      client.threadDiffPatch(42, {
        type: "uncommitted",
        repo: ".",
        path: "mobile/src/App.tsx",
      }),
    ).resolves.toEqual({
      repo: ".",
      path: "mobile/src/App.tsx",
      status: "modified",
      binary: false,
      truncated: false,
      patch: "@@ -1 +1 @@\n-old\n+new",
      workspace,
    });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://demo.test/api/tracker/v1/assistant/threads/42/diff/stats?type=uncommitted",
      "https://demo.test/api/tracker/v1/assistant/threads/42/diff/files?type=uncommitted&q=App&limit=1&cursor=start",
      "https://demo.test/api/tracker/v1/assistant/threads/42/diff/patch?type=uncommitted&repo=.&path=mobile%2Fsrc%2FApp.tsx",
    ]);
  });

  it("requires a commit message and preserves per-repository push failures", async () => {
    const workspace = { path: "/tmp/mobile", available: true };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              repo: ".",
              sha: "abc123",
              message: "feat: ship mobile diff",
              files: ["mobile/src/App.tsx"],
            },
          ],
          workspace,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { repo: ".", ok: true },
            { repo: "tracker", ok: false, error: "no upstream branch" },
          ],
          workspace,
        }),
      );
    const client = createTrackerClient({
      origin: "https://demo.test",
      token: "secret",
      locale: "en",
      fetchImpl,
    });

    await expect(client.commitThreadDiff(42, "  ")).rejects.toThrow("commit message");
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(client.commitThreadDiff(42, " feat: ship mobile diff ")).resolves.toEqual({
      commits: [
        {
          repo: ".",
          sha: "abc123",
          message: "feat: ship mobile diff",
          files: ["mobile/src/App.tsx"],
        },
      ],
      workspace,
    });
    await expect(client.pushThreadDiff(42)).resolves.toEqual({
      results: [
        { repo: ".", ok: true },
        { repo: "tracker", ok: false, error: "no upstream branch" },
      ],
      workspace,
    });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://demo.test/api/tracker/v1/assistant/threads/42/diff/commit",
      "https://demo.test/api/tracker/v1/assistant/threads/42/diff/push",
    ]);
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      message: "feat: ship mobile diff",
    });
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("POST");
  });

  it("maps issue pull requests and binds every operational endpoint", async () => {
    const pullRequest = {
      number: 7,
      title: "Complete mobile parity",
      url: "https://github.com/acme/mobile/pull/7",
      state: "open",
      repo: "acme/mobile",
      origin: "manual",
      is_draft: false,
      merged: false,
      head_ref: "agent/mobile",
      base_ref: "main",
      author: "raphael",
      mergeable: "CONFLICTING",
      checks_state: "failure",
      base_behind_by: 2,
      pipelines: [
        {
          name: "CI",
          url: "https://github.com/acme/mobile/actions/runs/99",
          jobs: [
            {
              name: "e2e",
              status: "COMPLETED",
              conclusion: "FAILURE",
              url: "https://github.com/acme/mobile/actions/jobs/100",
            },
          ],
        },
      ],
      statuses: [],
      conversation: [],
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [pullRequest],
          supported: true,
          available: true,
          children: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { ...pullRequest, origin: "manual" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { unlinked: true } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            moved_to: "Rework",
            comment_posted: true,
            jobs: [{ name: "e2e", conclusion: "FAILURE", url: "job" }],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { updated: true } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            reruns: [
              { run_id: 99, ok: true },
              { run_id: 100, ok: false, error: "rate_limited", status: 429 },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            merged: true,
            method: "squash",
            bypass: false,
            sha: "abc123",
            message: "merged",
            issue: null,
          },
        }),
      );
    const client = createTrackerClient({
      origin: "https://demo.test",
      token: "secret",
      locale: "en",
      fetchImpl,
    });

    await expect(client.issuePullRequests("mobile app", "MOB/7", true)).resolves.toEqual({
      pullRequests: [
        expect.objectContaining({
          number: 7,
          repo: "acme/mobile",
          origin: "manual",
          mergeable: "CONFLICTING",
          checksState: "failure",
          baseBehindBy: 2,
          pipelines: [
            expect.objectContaining({
              name: "CI",
              jobs: [
                expect.objectContaining({
                  name: "e2e",
                  conclusion: "FAILURE",
                }),
              ],
            }),
          ],
        }),
      ],
      supported: true,
      available: true,
      children: [],
    });
    await client.linkIssuePullRequest(
      "mobile app",
      "MOB/7",
      "https://github.com/acme/mobile/pull/7",
    );
    await client.unlinkIssuePullRequest(
      "mobile app",
      "MOB/7",
      "https://github.com/acme/mobile/pull/7",
    );
    await expect(client.requestPullRequestFix("mobile app", "MOB/7")).resolves.toEqual({
      movedTo: "Rework",
      commentPosted: true,
      jobs: [{ name: "e2e", conclusion: "FAILURE", url: "job" }],
    });
    await expect(client.updatePullRequestBranch("mobile app", "MOB/7", 7)).resolves.toEqual({
      updated: true,
    });
    await expect(client.rerunPullRequestJobs("mobile app", "MOB/7", 7)).resolves.toEqual([
      { runId: 99, ok: true },
      { runId: 100, ok: false, error: "rate_limited", status: 429 },
    ]);
    await expect(
      client.mergeIssuePullRequest("mobile app", "MOB/7", 7, {
        method: "squash",
        bypass: false,
      }),
    ).resolves.toEqual({
      merged: true,
      method: "squash",
      bypass: false,
      sha: "abc123",
      message: "merged",
      issue: null,
    });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7/pull_requests?refresh=1",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7/pull_requests/link",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7/pull_requests/link",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7/pull_requests/fix",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7/pull_requests/7/update_branch",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7/pull_requests/7/rerun_failed",
      "https://demo.test/api/tracker/v1/projects/mobile%20app/issues/MOB%2F7/pull_requests/7/merge",
    ]);
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetchImpl.mock.calls[2]?.[1]?.method).toBe("DELETE");
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body))).toEqual({
      url: "https://github.com/acme/mobile/pull/7",
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[6]?.[1]?.body))).toEqual({
      method: "squash",
      bypass: false,
    });
  });

  it("registers, unregisters, and tests native push without exposing tokens in results", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: { registered: true, device_id: "device-1" } }, { status: 201 }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { sent: true, device_count: 1 } }));
    const client = createTrackerClient({
      origin: "https://demo.test",
      token: "secret",
      locale: "en",
      fetchImpl,
    });

    await expect(
      client.registerMobilePush({
        profileId: "profile-1",
        deviceId: "device-1",
        platform: "android",
        token: "ExponentPushToken[private]",
      }),
    ).resolves.toEqual({ registered: true, deviceId: "device-1" });
    await expect(
      client.unregisterMobilePush({
        profileId: "profile-1",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({ deleted: true });
    await expect(client.sendTestMobilePush()).resolves.toEqual({
      sent: true,
      deviceCount: 1,
    });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://demo.test/api/tracker/v1/mobile_push/subscriptions",
      "https://demo.test/api/tracker/v1/mobile_push/subscriptions",
      "https://demo.test/api/tracker/v1/mobile_push/test",
    ]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      profile_id: "profile-1",
      device_id: "device-1",
      platform: "android",
      token: "ExponentPushToken[private]",
    });
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("DELETE");
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
