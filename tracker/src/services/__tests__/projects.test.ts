import { afterEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { normalizeProject, type BackendProjectDto } from "@/services/mappers";
import {
  archiveProject,
  createProject,
  createWorkspaceProject,
  deleteProject,
  getProject,
  listProjects,
  restoreProject,
  updateProject,
} from "@/services/projects";

describe("project service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists active projects without query params by default", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: [],
      },
    });

    await listProjects();

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects");
  });

  it("lists archived projects when requested", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: [
          {
            id: 1,
            name: "Macro Markets",
            slug: "macro-markets",
            description: "Local tracker",
            issue_count: 0,
            statuses: [],
            archived_at: "2026-05-28T14:00:00Z",
          },
        ],
      },
    });

    const projects = await listProjects({ includeArchived: true });

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects", { params: { include_archived: "true" } });
    expect(projects[0]).toMatchObject({ slug: "macro-markets", archivedAt: "2026-05-28T14:00:00Z" });
  });

  it("creates a project through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          id: 1,
          name: "Macro Markets",
          slug: "macro-markets",
          description: "Local tracker",
          issue_count: 0,
          statuses: [],
        },
      },
    });

    const project = await createProject({
      name: "Macro Markets",
      slug: "macro-markets",
      description: "Local tracker",
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects", {
      name: "Macro Markets",
      slug: "macro-markets",
      description: "Local tracker",
    });
    expect(project).toMatchObject({ name: "Macro Markets", slug: "macro-markets" });
  });

  it("creates a workspace project through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          id: 1,
          name: "Macro Markets",
          slug: "macro-markets",
          repositories: [{ id: 10, github_full_name: "clouapp/front", workspace_path: "frontend", role: "frontend" }],
          setup: { validation_commands: ["pnpm test"] },
          statuses: [{ id: 100, name: "Todo", category: "active", position: 0, is_terminal: false }],
        },
      },
    });

    const project = await createWorkspaceProject({
      name: "Macro Markets",
      slug: "macro-markets",
      workflowStatuses: [{ id: "todo", name: "Todo", category: "active", position: 0, isTerminal: false }],
      repositories: [{ fullName: "clouapp/front", workspacePath: "frontend", role: "frontend" }],
      setup: { validationCommands: ["pnpm test"] },
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/workspace", {
      name: "Macro Markets",
      slug: "macro-markets",
      description: null,
      workflow_statuses: [{ name: "Todo", category: "active", position: 0, is_terminal: false }],
      repositories: [{ github_full_name: "clouapp/front", workspace_path: "frontend", role: "frontend" }],
      setup: { validation_commands: ["pnpm test"] },
      tracker: { kind: "local", config: {} },
    });
    expect(project.repositories?.[0]).toMatchObject({ fullName: "clouapp/front", workspacePath: "frontend" });
    expect(project.setup?.validationCommands).toEqual(["pnpm test"]);
  });

  it("createWorkspaceProject sends tracker payload", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          id: 1,
          name: "Roadmap",
          slug: "roadmap",
          tracker_kind: "github",
          tracker_config: { project_id: "PVT_1", project_number: 7 },
        },
      },
    });

    await createWorkspaceProject({
      name: "Roadmap",
      slug: "roadmap",
      workflowStatuses: [],
      repositories: [],
      setup: {},
      tracker: { kind: "github", config: { project_id: "PVT_1", project_number: 7, status_field: "Symphony State" } },
    });

    expect(post).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/workspace",
      expect.objectContaining({
        tracker: { kind: "github", config: { project_id: "PVT_1", project_number: 7, status_field: "Symphony State" } },
      }),
    );
  });

  it("updates a project's details and tracker through the tracker API", async () => {
    const put = vi.spyOn(http, "put").mockResolvedValueOnce({
      data: {
        data: {
          id: 3,
          name: "Macro Markets",
          slug: "macro-markets",
          description: "Connected board",
          tracker_kind: "github",
          tracker_config: { project_id: "PVT_kwDOCpPais4BY509", repo: "clouapp/front", status_field: "Status" },
        },
      },
    });

    const project = await updateProject(" macro-markets ", {
      name: "  Macro Markets  ",
      description: "  Connected board  ",
      tracker: {
        kind: "github",
        config: { project_id: "PVT_kwDOCpPais4BY509", repo: "clouapp/front", status_field: "Status" },
      },
    });

    expect(put).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets", {
      name: "Macro Markets",
      description: "Connected board",
      tracker: {
        kind: "github",
        config: { project_id: "PVT_kwDOCpPais4BY509", repo: "clouapp/front", status_field: "Status" },
      },
    });
    expect(project.tracker).toEqual({
      kind: "github",
      config: { project_id: "PVT_kwDOCpPais4BY509", repo: "clouapp/front", status_field: "Status" },
    });
  });

  it("only sends fields that were provided when updating a project", async () => {
    const put = vi.spyOn(http, "put").mockResolvedValueOnce({
      data: { data: { id: 3, name: "Renamed", slug: "macro-markets" } },
    });

    await updateProject("macro-markets", { name: "Renamed" });

    expect(put).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets", { name: "Renamed" });
  });

  it("rejects an empty name when updating a project", async () => {
    const put = vi.spyOn(http, "put");

    await expect(updateProject("macro-markets", { name: "   " })).rejects.toThrow("Project name is required");

    expect(put).not.toHaveBeenCalled();
  });

  it("trims the slug before getting a project", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: {
          id: 1,
          name: "Macro Markets",
          slug: "macro-markets",
        },
      },
    });

    await getProject(" macro-markets ");

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets");
  });

  it("rejects blank slugs before getting a project", async () => {
    const get = vi.spyOn(http, "get");

    await expect(getProject("   ")).rejects.toThrow("projectSlug is required");

    expect(get).not.toHaveBeenCalled();
  });

  it("rejects empty slugs before getting a project", async () => {
    const get = vi.spyOn(http, "get");

    await expect(getProject("")).rejects.toThrow("projectSlug is required");

    expect(get).not.toHaveBeenCalled();
  });

  it("archives a project through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          id: 1,
          name: "Macro Markets",
          slug: "macro-markets",
          archived_at: "2026-05-28T14:00:00Z",
        },
      },
    });

    const project = await archiveProject("macro-markets");

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/archive");
    expect(project).toMatchObject({ slug: "macro-markets", archivedAt: "2026-05-28T14:00:00Z" });
  });

  it("trims the slug before archiving a project", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          id: 1,
          name: "Macro Markets",
          slug: "macro-markets",
          archived_at: "2026-05-28T14:00:00Z",
        },
      },
    });

    await archiveProject(" macro-markets ");

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/archive");
  });

  it("rejects blank slugs before archiving a project", async () => {
    const post = vi.spyOn(http, "post");

    await expect(archiveProject("   ")).rejects.toThrow("projectSlug is required");

    expect(post).not.toHaveBeenCalled();
  });

  it("rejects empty slugs before archiving a project", async () => {
    const post = vi.spyOn(http, "post");

    await expect(archiveProject("")).rejects.toThrow("projectSlug is required");

    expect(post).not.toHaveBeenCalled();
  });

  it("restores a project through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          id: 1,
          name: "Macro Markets",
          slug: "macro-markets",
          archived_at: null,
        },
      },
    });

    const project = await restoreProject("macro-markets");

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/restore");
    expect(project).toMatchObject({ slug: "macro-markets", archivedAt: null });
  });

  it("trims the slug before restoring a project", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          id: 1,
          name: "Macro Markets",
          slug: "macro-markets",
          archived_at: null,
        },
      },
    });

    await restoreProject(" macro-markets ");

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/restore");
  });

  it("rejects blank slugs before restoring a project", async () => {
    const post = vi.spyOn(http, "post");

    await expect(restoreProject("   ")).rejects.toThrow("projectSlug is required");

    expect(post).not.toHaveBeenCalled();
  });

  it("rejects empty slugs before restoring a project", async () => {
    const post = vi.spyOn(http, "post");

    await expect(restoreProject("")).rejects.toThrow("projectSlug is required");

    expect(post).not.toHaveBeenCalled();
  });

  it("deletes a project through the tracker API", async () => {
    const del = vi.spyOn(http, "delete").mockResolvedValueOnce({
      data: { data: null },
    });

    await deleteProject("macro-markets");

    expect(del).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets");
  });

  it("trims the slug before deleting a project", async () => {
    const del = vi.spyOn(http, "delete").mockResolvedValueOnce({
      data: { data: null },
    });

    await deleteProject(" macro-markets ");

    expect(del).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets");
  });

  it("rejects blank slugs before deleting a project", async () => {
    const del = vi.spyOn(http, "delete");

    await expect(deleteProject("   ")).rejects.toThrow("projectSlug is required");

    expect(del).not.toHaveBeenCalled();
  });

  it("rejects empty slugs before deleting a project", async () => {
    const del = vi.spyOn(http, "delete");

    await expect(deleteProject("")).rejects.toThrow("projectSlug is required");

    expect(del).not.toHaveBeenCalled();
  });
});

describe("normalizeProject tracker", () => {
  it("defaults to local tracker", () => {
    const dto = { id: 1, slug: "p", name: "P" } as BackendProjectDto;
    expect(normalizeProject(dto).tracker).toEqual({ kind: "local", config: {} });
  });

  it("reads github tracker", () => {
    const dto = {
      id: 1,
      slug: "p",
      name: "P",
      tracker_kind: "github",
      tracker_config: { project_id: "PVT_1" },
    } as unknown as BackendProjectDto;
    expect(normalizeProject(dto).tracker).toEqual({ kind: "github", config: { project_id: "PVT_1" } });
  });
});
