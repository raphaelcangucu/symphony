import { describe, expect, it } from "vitest";

import { githubProjectBoardUrl, projectTrackerLinkLabel, resolveProjectTrackerUrl } from "@/lib/projectTrackerUrl";
import type { Project } from "@/types/project";

const baseProject: Project = {
  id: "1",
  slug: "macro-markets",
  name: "Macro Markets",
  description: null,
  tracker: { kind: "local", config: {} },
};

describe("projectTrackerUrl", () => {
  it("returns null for local projects", () => {
    expect(resolveProjectTrackerUrl(baseProject)).toBeNull();
  });

  it("prefers trackerUrl from the API", () => {
    const project: Project = {
      ...baseProject,
      trackerUrl: "https://github.com/orgs/clouapp/projects/2",
      tracker: { kind: "github", config: { repo: "clouapp/front" } },
    };

    expect(resolveProjectTrackerUrl(project)).toBe("https://github.com/orgs/clouapp/projects/2");
  });

  it("builds linear project urls from project_slug", () => {
    const project: Project = {
      ...baseProject,
      tracker: { kind: "linear", config: { project_slug: "macro-markets" } },
    };

    expect(resolveProjectTrackerUrl(project)).toBe("https://linear.app/project/macro-markets/issues");
  });

  it("builds github org project urls from repo and project_number", () => {
    const project: Project = {
      ...baseProject,
      tracker: {
        kind: "github",
        config: { repo: "clouapp/front", project_number: 2 },
      },
    };

    expect(resolveProjectTrackerUrl(project)).toBe("https://github.com/orgs/clouapp/projects/2");
  });

  it("builds jira board urls from project_key and base_url", () => {
    const project: Project = {
      ...baseProject,
      tracker: {
        kind: "jira",
        config: { project_key: "ABC", base_url: "https://acme.atlassian.net" },
      },
    };

    expect(resolveProjectTrackerUrl(project)).toBe("https://acme.atlassian.net/jira/software/projects/ABC/boards");
  });

  it("resolves github board urls from project_id lookup map", () => {
    const project: Project = {
      ...baseProject,
      tracker: {
        kind: "github",
        config: { project_id: "PVT_test", repo: "GambaLabs/frontend" },
      },
      trackerUrl: "https://github.com/GambaLabs/frontend/issues",
    };

    expect(
      resolveProjectTrackerUrl(project, {
        PVT_test: "https://github.com/orgs/GambaLabs/projects/2",
      }),
    ).toBe("https://github.com/orgs/GambaLabs/projects/2");
  });

  it("does not fall back to repo issues when project_id is configured", () => {
    const project: Project = {
      ...baseProject,
      tracker: {
        kind: "github",
        config: { project_id: "PVT_test", repo: "GambaLabs/frontend" },
      },
    };

    expect(resolveProjectTrackerUrl(project)).toBeNull();
  });

  it("builds github board urls from discovery summaries", () => {
    expect(
      githubProjectBoardUrl({
        id: "1",
        number: 2,
        title: "Board",
        owner: { login: "clouapp", kind: "organization" },
        repoNameWithOwner: "clouapp/front",
      }),
    ).toBe("https://github.com/orgs/clouapp/projects/2");
  });

  it("labels tracker links by kind", () => {
    expect(projectTrackerLinkLabel("github")).toBe("Open GitHub project");
    expect(projectTrackerLinkLabel("linear")).toBe("Open Linear project");
    expect(projectTrackerLinkLabel("jira")).toBe("Open Jira project");
  });
});
