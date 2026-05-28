import { describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { listGitHubOwners, listGitHubRepositories, scanRepositories, suggestWorkspaceSetup } from "@/services/projectSetup";

describe("project setup service", () => {
  it("lists accessible GitHub owners", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: [
          {
            login: "raphaelcangucu",
            avatar_url: "https://github.com/raphaelcangucu.png",
            kind: "user",
          },
          {
            login: "clouapp",
            name: "Clou App",
            avatar_url: "https://github.com/clouapp.png",
            kind: "organization",
          },
        ],
      },
    });

    const owners = await listGitHubOwners();

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/github/owners");
    expect(owners).toEqual([
      {
        login: "raphaelcangucu",
        name: null,
        avatarUrl: "https://github.com/raphaelcangucu.png",
        kind: "user",
      },
      {
        login: "clouapp",
        name: "Clou App",
        avatarUrl: "https://github.com/clouapp.png",
        kind: "organization",
      },
    ]);
    get.mockRestore();
  });

  it("lists GitHub repositories for an owner", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: [
          {
            name: "front",
            full_name: "clouapp/front",
            clone_url: "https://github.com/clouapp/front.git",
            default_branch: "homolog",
            private: true,
            avatar_url: "https://github.com/clouapp.png",
            suggested_local_path: "/home/me/code/front",
          },
        ],
      },
    });

    const repositories = await listGitHubRepositories("clouapp");

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/github/owners/clouapp/repositories");
    expect(repositories[0]).toMatchObject({
      fullName: "clouapp/front",
      defaultBranch: "homolog",
      avatarUrl: "https://github.com/clouapp.png",
      localPath: "/home/me/code/front",
      suggestedLocalPath: "/home/me/code/front",
    });
    get.mockRestore();
  });

  it("scans repositories and requests workspace suggestions", async () => {
    const post = vi
      .spyOn(http, "post")
      .mockResolvedValueOnce({
        data: {
          data: {
            scans: [
              {
                local_path: "/code/front",
                workspace_path: "frontend",
                stack: ["node"],
                package_manager: "pnpm",
                validation_commands: ["pnpm test"],
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            workflow_statuses: [{ name: "Todo", category: "active", position: 0, is_terminal: false }],
            workflow_config: { active_states: ["Todo"], terminal_states: ["Done"] },
            validation_commands: ["pnpm test"],
            after_create_hook: "git clone repo frontend",
            prompt_template: "Use frontend/",
            scan_summary: { repository_count: 1 },
          },
        },
      });

    const scans = await scanRepositories([{ localPath: "/code/front", workspacePath: "frontend" }]);
    const suggestion = await suggestWorkspaceSetup({
      repositories: [
        {
          fullName: "clouapp/front",
          cloneUrl: "https://github.com/clouapp/front.git",
          selectedBranch: "homolog",
          workspacePath: "frontend",
          role: "frontend",
        },
      ],
      scans,
    });

    expect(post).toHaveBeenNthCalledWith(1, "/api/tracker/v1/project_setup/scan", {
      repositories: [{ local_path: "/code/front", workspace_path: "frontend" }],
    });
    expect(post).toHaveBeenNthCalledWith(2, "/api/tracker/v1/project_setup/suggest", {
      repositories: [
        {
          github_full_name: "clouapp/front",
          clone_url: "https://github.com/clouapp/front.git",
          selected_branch: "homolog",
          workspace_path: "frontend",
          role: "frontend",
        },
      ],
      scans: [
        {
          local_path: "/code/front",
          workspace_path: "frontend",
          stack: ["node"],
          package_manager: "pnpm",
          validation_commands: ["pnpm test"],
        },
      ],
    });
    expect(suggestion.workflowStatuses[0].name).toBe("Todo");
    expect(suggestion.validationCommands).toEqual(["pnpm test"]);
    post.mockRestore();
  });
});
