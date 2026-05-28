import { describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { createProject, createWorkspaceProject } from "@/services/projects";

describe("project service", () => {
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

    post.mockRestore();
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
    });
    expect(project.repositories?.[0]).toMatchObject({ fullName: "clouapp/front", workspacePath: "frontend" });
    expect(project.setup?.validationCommands).toEqual(["pnpm test"]);

    post.mockRestore();
  });
});
