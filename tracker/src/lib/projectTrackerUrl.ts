import type { TFunction } from "i18next";

import { i18n } from "@/i18n";
import type { GitHubProjectSummary } from "@/services/remoteTrackers";
import type { Project, TrackerKind } from "@/types/project";

type Translate = TFunction;

export function projectTrackerLinkLabel(
  kind: TrackerKind,
  t: Translate = i18n.t.bind(i18n) as Translate,
): string {
  return t(`project.list.trackerLink.${kind}`);
}

export function githubProjectBoardUrl(board: GitHubProjectSummary): string {
  const scope = board.owner.kind === "organization" ? "orgs" : "users";
  return `https://github.com/${scope}/${board.owner.login}/projects/${board.number}`;
}

export function resolveProjectTrackerUrl(
  project: Project,
  githubBoardsById: Readonly<Record<string, string>> = {},
): string | null {
  if (project.trackerUrl && !isRepoIssuesFallback(project.trackerUrl, project)) {
    return project.trackerUrl;
  }

  const { kind, config } = project.tracker;
  if (kind === "local") return null;

  const projectUrl = configString(config, "project_url");
  if (projectUrl) return projectUrl;

  switch (kind) {
    case "linear": {
      const slug = configString(config, "project_slug");
      return slug ? `https://linear.app/project/${slug}/issues` : null;
    }
    case "github": {
      const projectId = configString(config, "project_id");
      if (projectId && githubBoardsById[projectId]) {
        return githubBoardsById[projectId];
      }

      const repo = configString(config, "repo");
      const projectNumber = configNumber(config, "project_number");
      if (repo && projectNumber != null) {
        const owner = repo.split("/")[0]?.trim();
        if (owner) {
          const ownerKind = configString(config, "owner_kind");
          const scope = ownerKind === "user" ? "users" : "orgs";
          return `https://github.com/${scope}/${owner}/projects/${projectNumber}`;
        }
      }

      if (projectId) return null;

      return repo ? `https://github.com/${repo}/issues` : null;
    }
    case "jira": {
      const projectKey = configString(config, "project_key");
      const baseUrl = configString(config, "base_url");
      if (!projectKey || !baseUrl) return null;
      return `${baseUrl.replace(/\/$/, "")}/jira/software/projects/${projectKey}/boards`;
    }
    default:
      return null;
  }
}

function configString(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function configNumber(config: Record<string, unknown>, key: string): number | null {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isRepoIssuesFallback(url: string, project: Project): boolean {
  if (project.tracker.kind !== "github") return false;
  const repo = configString(project.tracker.config, "repo");
  return Boolean(repo && url === `https://github.com/${repo}/issues`);
}
