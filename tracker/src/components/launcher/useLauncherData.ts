import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildBranchIssueIndex, resolveBranchIssue } from "@/components/launcher/launcherSources";
import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { listIssues } from "@/services/issues";
import { listProjectBranches, type ProjectBranch } from "@/services/projectBranches";
import { listProjectPullRequests, type ProjectPullRequest } from "@/services/projectPullRequests";
import type { AgentExecutionStatus } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { LauncherItem, LauncherTabId } from "@/types/launcher";

export interface UseLauncherDataArgs {
  projectSlug: string;
  open: boolean;
  activeTab: LauncherTabId;
  query: string;
}

export interface LauncherDataItem extends LauncherItem {
  status?: AgentExecutionStatus | null;
  prNumber?: number | null;
  branchName?: string | null;
}

export interface UseLauncherDataResult {
  items: LauncherDataItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface TabData {
  issues: Issue[];
  prs: ProjectPullRequest[];
  branches: ProjectBranch[];
  branchIssues: Issue[];
}

const EMPTY_DATA: TabData = { issues: [], prs: [], branches: [], branchIssues: [] };

function branchTreeUrl(repo: string | null, branch: string): string | null {
  if (!repo) return null;
  return `https://github.com/${repo}/tree/${branch}`;
}

async function fetchForTab(projectSlug: string, tab: LauncherTabId, query: string): Promise<TabData> {
  if (tab === "issues") {
    const issues = await listIssues(projectSlug, { search: query });
    return { ...EMPTY_DATA, issues };
  }
  if (tab === "prs") {
    const prs = await listProjectPullRequests(projectSlug);
    return { ...EMPTY_DATA, prs };
  }
  if (tab === "branches") {
    const [branches, branchIssues] = await Promise.all([
      listProjectBranches(projectSlug),
      listIssues(projectSlug),
    ]);
    return { ...EMPTY_DATA, branches, branchIssues };
  }
  return EMPTY_DATA;
}

export function useLauncherData({
  projectSlug,
  open,
  activeTab,
  query,
}: UseLauncherDataArgs): UseLauncherDataResult {
  const { executions } = useAgentExecutions({ enabled: open });

  const [data, setData] = useState<TabData>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const active = open && projectSlug.trim() !== "" && activeTab !== "actions";

  const load = useCallback(async () => {
    if (!active) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const next = await fetchForTab(projectSlug, activeTab, query);
      if (requestId !== requestIdRef.current) return;
      setData(next);
      setError(null);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError("load-failed");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [active, projectSlug, activeTab, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo<LauncherDataItem[]>(() => {
    if (activeTab === "issues") {
      return data.issues.map((issue) => issueItem(issue, executions.get(issue.identifier)?.status ?? null));
    }
    if (activeTab === "prs") {
      return data.prs.map((pr) => ({
        kind: "prs" as LauncherTabId,
        id: `pr:${pr.repo ?? "?"}#${pr.number}`,
        title: pr.title ?? `#${pr.number}`,
        subtitle: pr.repo ? `${pr.repo} · #${pr.number}` : `#${pr.number}`,
        issueIdentifier: pr.issueIdentifier,
        externalUrl: pr.url,
        searchTokens: [String(pr.number), pr.title ?? "", pr.repo ?? "", pr.issueIdentifier ?? ""],
        status: pr.issueIdentifier ? (executions.get(pr.issueIdentifier)?.status ?? null) : null,
        prNumber: pr.number,
        branchName: null,
      }));
    }
    if (activeTab === "branches") {
      const index = buildBranchIssueIndex(data.branchIssues);
      return data.branches.map((branch) => {
        const issue = resolveBranchIssue(index, branch.name);
        return {
          kind: "branches" as LauncherTabId,
          id: branch.name,
          title: branch.name,
          subtitle: branch.repo,
          issueIdentifier: issue?.identifier ?? null,
          externalUrl: issue ? null : branchTreeUrl(branch.repo, branch.name),
          searchTokens: [branch.name, branch.repo ?? "", issue?.identifier ?? ""],
          status: issue ? (executions.get(issue.identifier)?.status ?? null) : null,
          branchName: branch.name,
          prNumber: null,
        };
      });
    }
    return [];
  }, [activeTab, data, executions]);

  return { items, loading, error, refetch: load };
}

function issueItem(issue: Issue, status: AgentExecutionStatus | null): LauncherDataItem {
  const numberToken = issue.identifier.includes("-") ? (issue.identifier.split("-").pop() ?? "") : issue.identifier;
  return {
    kind: "issues" as LauncherTabId,
    id: issue.identifier,
    title: issue.title,
    subtitle: issue.status,
    issueIdentifier: issue.identifier,
    externalUrl: null,
    searchTokens: [issue.identifier, issue.title, numberToken],
    status,
  };
}
