import { afterEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import {
  archiveIssue,
  createIssue,
  deleteIssue,
  getIssueFormOptions,
  listIssues,
  restoreIssue,
  updateIssue,
} from "@/services/issues";
import { normalizeIssue } from "@/services/mappers";

describe("issues service filters", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls the issues endpoint without params when filters omitted", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: [] } });

    await listIssues("macro-markets");

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues");
  });

  it("forwards search, assignee, and creator filters", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: [] } });

    await listIssues("macro-markets", { search: "login ui", assignee: "me", creator: "octocat" });

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues", {
      params: { q: "login ui", assignee: "me", creator: "octocat" },
    });
  });

  it("omits empty filter values", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: [] } });

    await listIssues("macro-markets", { search: "", assignee: "alice" });

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues", {
      params: { assignee: "alice" },
    });
  });
});

describe("createIssue payload", () => {
  afterEach(() => vi.restoreAllMocks());

  const createdDto = { id: 1, identifier: "1", title: "Social login", status: "Todo" };

  it("sends labels, assignees, and agent in snake_case", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: createdDto } });

    await createIssue("macro-markets", {
      title: "Social login",
      description: "body",
      status: "Todo",
      priority: 2,
      labelIds: ["L1", "L2"],
      assigneeIds: ["U1"],
      agent: "codex",
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues", {
      title: "Social login",
      description: "body",
      status: "Todo",
      priority: 2,
      label_ids: ["L1", "L2"],
      assignee_ids: ["U1"],
      agent: "codex",
    });
  });

  it("sends a trimmed Codex goal when provided", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: createdDto } });

    await createIssue("macro-markets", {
      title: "Social login",
      description: "body",
      status: "Todo",
      agent: "codex",
      goal: "  Ship OAuth login  ",
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues", {
      title: "Social login",
      description: "body",
      status: "Todo",
      agent: "codex",
      goal: "Ship OAuth login",
    });
  });

  it("omits goal for agents that do not support goals", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: createdDto } });

    await createIssue("macro-markets", {
      title: "Cursor cleanup",
      description: null,
      status: "Todo",
      agent: "cursor",
      goal: "Do not send this",
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues", {
      title: "Cursor cleanup",
      description: null,
      status: "Todo",
      agent: "cursor",
    });
  });

  it("omits empty selectors", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: createdDto } });

    await createIssue("macro-markets", {
      title: "Social login",
      description: null,
      status: "Todo",
      labelIds: [],
      assigneeIds: [],
      agent: null,
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues", {
      title: "Social login",
      description: null,
      status: "Todo",
    });
  });

  it("sends model and effort when provided", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: createdDto } });

    await createIssue("macro-markets", {
      title: "Social login",
      status: "Todo",
      agent: "codex",
      model: "gpt-5.5",
      effort: "high",
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues", {
      title: "Social login",
      description: null,
      status: "Todo",
      agent: "codex",
      model: "gpt-5.5",
      effort: "high",
    });
  });

  it("omits model and effort when undefined", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: createdDto } });

    await createIssue("macro-markets", {
      title: "Social login",
      status: "Todo",
      agent: "codex",
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues", {
      title: "Social login",
      description: null,
      status: "Todo",
      agent: "codex",
    });
  });
});

describe("updateIssue payload", () => {
  afterEach(() => vi.restoreAllMocks());

  const updatedDto = { id: 1, identifier: "517", title: "New title", status: "Todo" };

  it("patches mutable fields in snake_case", async () => {
    const patch = vi.spyOn(http, "patch").mockResolvedValueOnce({ data: { data: updatedDto } });

    const result = await updateIssue("macro-markets", "517", {
      title: "New title",
      description: "Updated body",
      labelIds: ["bug", "frontend"],
      agent: "claude",
    });

    expect(patch).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/517", {
      title: "New title",
      description: "Updated body",
      label_ids: ["bug", "frontend"],
      agent: "claude",
    });
    expect(result.identifier).toBe("517");
  });

  it("sends null model to clear", async () => {
    const patch = vi.spyOn(http, "patch").mockResolvedValueOnce({ data: { data: updatedDto } });

    await updateIssue("macro-markets", "517", { model: null });

    expect(patch).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/517", {
      model: null,
    });
  });

  it("sends null effort to clear", async () => {
    const patch = vi.spyOn(http, "patch").mockResolvedValueOnce({ data: { data: updatedDto } });

    await updateIssue("macro-markets", "517", { effort: null });

    expect(patch).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/517", {
      effort: null,
    });
  });

  it("sends model and effort when provided", async () => {
    const patch = vi.spyOn(http, "patch").mockResolvedValueOnce({ data: { data: updatedDto } });

    await updateIssue("macro-markets", "517", { model: "gpt-5.5", effort: "xhigh" });

    expect(patch).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/517", {
      model: "gpt-5.5",
      effort: "xhigh",
    });
  });
});

describe("normalizeIssue model and effort", () => {
  it("maps model and effort from camelCase", () => {
    const issue = normalizeIssue({
      id: 1,
      identifier: "MAC-1",
      title: "Pinned",
      model: "gpt-5.5",
      effort: "high",
    });

    expect(issue.model).toBe("gpt-5.5");
    expect(issue.effort).toBe("high");
  });

  it("maps null model and effort", () => {
    const issue = normalizeIssue({
      id: 2,
      identifier: "MAC-2",
      title: "Cleared",
      model: null,
      effort: null,
    });

    expect(issue.model).toBeNull();
    expect(issue.effort).toBeNull();
  });
});

describe("issue lifecycle actions", () => {
  afterEach(() => vi.restoreAllMocks());

  const dto = { id: 1, identifier: "MAC-1", title: "Archive me", status: "Todo" };

  it("posts to the archive endpoint", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: dto } });

    const result = await archiveIssue("macro-markets", "MAC-1");

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/MAC-1/archive");
    expect(result.identifier).toBe("MAC-1");
  });

  it("posts to the restore endpoint", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: dto } });

    await restoreIssue("macro-markets", "MAC-1");

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/MAC-1/restore");
  });

  it("sends a DELETE to the issue endpoint", async () => {
    const del = vi.spyOn(http, "delete").mockResolvedValueOnce({ data: { data: dto } });

    await deleteIssue("macro-markets", "MAC-1");

    expect(del).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/MAC-1");
  });

  it("rejects blank identifiers", async () => {
    await expect(archiveIssue("macro-markets", " ")).rejects.toThrow("identifier is required");
    await expect(deleteIssue("macro-markets", "")).rejects.toThrow("identifier is required");
  });
});

describe("getIssueFormOptions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("normalizes labels, assignees, statuses, and agents", async () => {
    vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: {
          labels: [{ id: "L1", name: "bug", color: "ff0000" }, { name: "  " }],
          assignees: [{ id: "U1", login: "alice", name: "Alice", avatar_url: "https://x/a.png" }],
          statuses: [{ name: "Todo", category: "unstarted", position: 1, is_terminal: false }],
          agents: [
            { value: "codex", label: "Codex", default: true },
            { value: "bogus", label: "Nope", default: false },
          ],
        },
      },
    });

    const options = await getIssueFormOptions("macro-markets");

    expect(options.labels).toEqual([{ id: "L1", name: "bug", color: "ff0000" }]);
    expect(options.assignees).toEqual([
      { id: "U1", login: "alice", name: "Alice", avatarUrl: "https://x/a.png" },
    ]);
    expect(options.statuses).toEqual(["Todo"]);
    expect(options.agents).toEqual([{ value: "codex", label: "Codex", default: true }]);
  });
});
