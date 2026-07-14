import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { normalizeSidebarTree } from "@/components/layout/sidebar/sidebarVisibleRows";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { i18n } from "@/i18n";
import type {
  SidebarProjectNode,
  SidebarSessionNode,
  SidebarWorkspaceNode,
} from "@/types/sidebar";

export type SidebarSearchResultKind = "project" | "workspace" | "session";

export interface SidebarSearchResult {
  readonly id: string;
  readonly kind: SidebarSearchResultKind;
  readonly title: string;
  readonly context: string;
  readonly status: string;
  readonly href: string;
  readonly projectId: string;
}

export interface SidebarSearchLauncherProps {
  readonly open: boolean;
  readonly tree: readonly SidebarProjectNode[];
  readonly loading?: boolean;
  onOpenChange(open: boolean): void;
  onOpenNode(href: string): void;
  onRequestProjectExpand?(projectId: string): void;
}

export function buildSidebarSearchResults(
  tree: unknown,
  query: unknown,
): readonly SidebarSearchResult[] {
  const normalizedQuery = normalizeSearchText(typeof query === "string" ? query.trim() : "");
  const results: SidebarSearchResult[] = [];
  const seenIds = new Set<string>();

  for (const project of normalizeSidebarTree(tree)) {
    addResult(
      results,
      seenIds,
      {
        id: project.id,
        kind: "project",
        title: project.title,
        context: project.subtitle,
        status: project.loadState,
        href: `/projects/${encodeURIComponent(project.projectSlug)}/board`,
        projectId: project.id,
      },
      normalizedQuery,
    );

    const workspaces = [...project.workspaces, ...project.overflowWorkspaces];
    for (const workspace of workspaces) {
      addWorkspaceResults(results, seenIds, project, workspace, normalizedQuery);
    }

    for (const unassignedSession of project.unassignedSessions) {
      addSessionResult(
        results,
        seenIds,
        project,
        null,
        unassignedSession,
        normalizedQuery,
      );
    }
  }

  return results;
}

export function SidebarSearchLauncher({
  open,
  tree,
  loading = false,
  onOpenChange,
  onOpenNode,
  onRequestProjectExpand,
}: SidebarSearchLauncherProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const results = useMemo(() => buildSidebarSearchResults(tree, query), [query, tree]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  function close() {
    setQuery("");
    onOpenChange(false);
  }

  function openResult(result: SidebarSearchResult) {
    if (result.kind === "project") onRequestProjectExpand?.(result.projectId);
    onOpenNode(result.href);
    close();
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : close())}
      label={t("layout.sidebar.search.title")}
      description={t("layout.sidebar.search.description")}
      shouldFilter={false}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t("layout.sidebar.search.placeholder")}
      />
      <CommandList>
        <CommandEmpty>
          {loading
            ? t("layout.sidebar.search.loading")
            : t("layout.sidebar.search.empty")}
        </CommandEmpty>
        {results.map((result) => (
          <CommandItem
            key={result.id}
            value={result.id}
            aria-label={`${result.title} · ${typeLabel(result.kind, t)} · ${result.context}`}
            onSelect={() => openResult(result)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{result.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {result.context}
              </span>
            </span>
            <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
              {typeLabel(result.kind, t)} ·{" "}
              {localizeSidebarSearchStatus(result.kind, result.status)}
            </span>
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

function addWorkspaceResults(
  results: SidebarSearchResult[],
  seenIds: Set<string>,
  project: SidebarProjectNode,
  workspace: SidebarWorkspaceNode,
  query: string,
): void {
  addResult(
    results,
    seenIds,
    {
      id: workspace.id,
      kind: "workspace",
      title: workspace.title,
      context: project.title,
      status: workspace.aggregateStatus,
      href: workspace.href,
      projectId: project.id,
    },
    query,
  );

  for (const childSession of [...workspace.sessions, ...workspace.overflowSessions]) {
    addSessionResult(results, seenIds, project, workspace, childSession, query);
  }
}

function addSessionResult(
  results: SidebarSearchResult[],
  seenIds: Set<string>,
  project: SidebarProjectNode,
  workspace: SidebarWorkspaceNode | null,
  session: SidebarSessionNode,
  query: string,
): void {
  addResult(
    results,
    seenIds,
    {
      id: session.id,
      kind: "session",
      title: session.title,
      context: workspace ? `${project.title} · ${workspace.title}` : project.title,
      status: session.statusKind,
      href: session.href,
      projectId: project.id,
    },
    query,
  );
}

function addResult(
  results: SidebarSearchResult[],
  seenIds: Set<string>,
  result: SidebarSearchResult,
  query: string,
): void {
  if (seenIds.has(result.id)) return;
  seenIds.add(result.id);
  if (!query || searchableText(result).includes(query)) results.push(result);
}

function searchableText(result: SidebarSearchResult): string {
  return normalizeSearchText(
    `${result.title} ${result.context} ${result.status} ${result.kind}`,
  );
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

function typeLabel(
  kind: SidebarSearchResultKind,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return t(`layout.sidebar.search.types.${kind}`);
}

export function localizeSidebarSearchStatus(
  kind: SidebarSearchResultKind,
  status: string,
): string {
  const unknown = i18n.t("layout.sidebar.search.unknownStatus");
  if (!status.trim()) return unknown;

  if (kind === "session") {
    const key = `layout.recents.status.${status}`;
    const label = i18n.t(key);
    return label === key ? unknown : label;
  }

  if (kind === "workspace") {
    const key = `layout.sidebar.tree.aggregateStatus.${status}`;
    const label = i18n.t(key);
    return label === key ? unknown : label;
  }

  const loadKey = `layout.sidebar.search.loadState.${status}`;
  const loadLabel = i18n.t(loadKey);
  if (loadLabel !== loadKey) return loadLabel;

  const aggregateKey = `layout.sidebar.tree.aggregateStatus.${status}`;
  const aggregateLabel = i18n.t(aggregateKey);
  return aggregateLabel === aggregateKey ? unknown : aggregateLabel;
}
