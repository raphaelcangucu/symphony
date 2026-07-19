import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, ChevronDown, ChevronRight, Layers, Play, RotateCw, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  describeDockerError,
  dockerProjectGroupKey,
  fetchDockerOverview,
  groupDockerContainersByProject,
  runDockerCommand,
  type DockerCommand,
  type DockerContainer,
  type DockerOverview,
  type DockerProjectGroup,
  type DockerSortKey,
} from "@/services/docker";
import { isCanceledError } from "@/services/http";

const POLL_INTERVAL_MS = 5000;

const STATE_DOT_CLASS: Record<string, string> = {
  running: "bg-emerald-500",
  restarting: "bg-amber-500 animate-pulse",
  paused: "bg-amber-500",
  created: "bg-sky-500",
  exited: "bg-zinc-400",
  dead: "bg-red-500",
};

function shortenPath(path: string | null): string {
  if (!path) return "—";
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 3) return path;
  return `…/${segments.slice(-3).join("/")}`;
}

interface SelectionState {
  checked: boolean;
  indeterminate: boolean;
}

function resolveSelectionState(ids: readonly string[], selectedIds: ReadonlySet<string>): SelectionState {
  if (ids.length === 0) return { checked: false, indeterminate: false };
  const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
  if (selectedCount === 0) return { checked: false, indeterminate: false };
  if (selectedCount === ids.length) return { checked: true, indeterminate: false };
  return { checked: false, indeterminate: true };
}

interface SelectionCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel: string;
  className?: string;
}

function SelectionCheckbox({ checked, indeterminate, onChange, ariaLabel, className }: SelectionCheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate ?? false;
  }, [checked, indeterminate]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      className={`h-4 w-4 shrink-0 accent-primary ${className ?? ""}`}
      checked={checked}
      aria-label={ariaLabel}
      onClick={(event) => event.stopPropagation()}
      onChange={onChange}
    />
  );
}

interface ContainerActionsProps {
  container: DockerContainer;
  pending: boolean;
  onExecute: (target: DockerContainer, command: DockerCommand) => void;
  onRemove: (target: DockerContainer) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function ContainerActions({ container, pending, onExecute, onRemove, t }: ContainerActionsProps) {
  return (
    <span className="flex shrink-0 items-center justify-end gap-1">
      {container.state === "running" ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={pending}
            aria-label={t("docker.rowActions.stop")}
            title={t("docker.rowActions.stop")}
            onClick={() => onExecute(container, "stop")}
          >
            <Square className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={pending}
            aria-label={t("docker.rowActions.restart")}
            title={t("docker.rowActions.restart")}
            onClick={() => onExecute(container, "restart")}
          >
            <RotateCw className="h-4 w-4" aria-hidden />
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={pending}
          aria-label={t("docker.rowActions.start")}
          title={t("docker.rowActions.start")}
          onClick={() => onExecute(container, "start")}
        >
          <Play className="h-4 w-4" aria-hidden />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label={t("docker.rowActions.remove")}
        title={t("docker.rowActions.remove")}
        onClick={() => onRemove(container)}
      >
        <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
      </Button>
    </span>
  );
}

interface SortButtonProps {
  label: string;
  active: boolean;
  ascending: boolean;
  onClick: () => void;
  className?: string;
}

function SortButton({ label, active, ascending, onClick, className }: SortButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 ${className ?? ""}`}
      onClick={onClick}
      aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}
    >
      {label}
      <ArrowUpDown className={`h-3 w-3 ${active ? "text-foreground" : ""}`} aria-hidden />
    </button>
  );
}

interface DockerGroupTableRowsProps {
  group: DockerProjectGroup;
  expanded: boolean;
  onToggle: () => void;
  pendingIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  onToggleGroupSelection: (group: DockerProjectGroup) => void;
  onToggleContainerSelection: (containerId: string) => void;
  onExecute: (target: DockerContainer, command: DockerCommand) => void;
  onRemove: (target: DockerContainer) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function DockerGroupTableRows({
  group,
  expanded,
  onToggle,
  pendingIds,
  selectedIds,
  onToggleGroupSelection,
  onToggleContainerSelection,
  onExecute,
  onRemove,
  t,
}: DockerGroupTableRowsProps) {
  const runningCount = group.containers.filter((item) => item.state === "running").length;
  const projectLabel = group.composeProject ?? t("docker.unassignedProject");
  const groupKey = dockerProjectGroupKey(group);
  const groupContainerIds = group.containers.map((item) => item.id);
  const groupSelection = resolveSelectionState(groupContainerIds, selectedIds);

  return (
    <>
      <tr className="border-t bg-muted/30">
        <td className="w-10 px-3 py-2">
          <SelectionCheckbox
            checked={groupSelection.checked}
            indeterminate={groupSelection.indeterminate}
            ariaLabel={t("docker.selectGroup", { project: projectLabel })}
            onChange={() => onToggleGroupSelection(group)}
          />
        </td>
        <td colSpan={7} className="px-3 py-2">
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-2 text-left"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={`docker-group-${groupKey}`}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-semibold">{projectLabel}</span>
            <span className="hidden truncate text-xs text-muted-foreground sm:inline" title={group.composeWorkingDir ?? undefined}>
              {shortenPath(group.composeWorkingDir)}
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {t("docker.groupSummary", { total: group.containers.length, running: runningCount })}
            </span>
          </button>
        </td>
      </tr>
      {expanded
        ? group.containers.map((container) => {
            const pending = pendingIds.has(container.id);
            const selected = selectedIds.has(container.id);
            return (
              <tr
                key={container.id}
                id={`docker-group-${groupKey}`}
                className={`border-t ${selected ? "bg-primary/5" : ""}`}
              >
                <td className="w-10 px-3 py-2">
                  <SelectionCheckbox
                    checked={selected}
                    ariaLabel={t("docker.selectContainer", { name: container.name })}
                    onChange={() => onToggleContainerSelection(container.id)}
                  />
                </td>
                <td className="px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 pl-4">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT_CLASS[container.state] ?? "bg-zinc-400"}`}
                      aria-hidden
                    />
                    <span className="truncate font-medium">{container.name}</span>
                  </span>
                </td>
                <td className="hidden max-w-56 truncate px-3 py-2 lg:table-cell" title={container.image}>
                  {container.image}
                </td>
                <td className="px-3 py-2">{container.status}</td>
                <td className="hidden max-w-48 truncate px-3 py-2 xl:table-cell" title={container.ports}>
                  {container.ports || "—"}
                </td>
                <td className="hidden px-3 py-2 tabular-nums md:table-cell">{container.cpuPercent ?? "—"}</td>
                <td className="hidden px-3 py-2 tabular-nums lg:table-cell">{container.memoryUsage ?? "—"}</td>
                <td className="px-2 py-2 sm:px-3">
                  <ContainerActions
                    container={container}
                    pending={pending}
                    onExecute={onExecute}
                    onRemove={onRemove}
                    t={t}
                  />
                </td>
              </tr>
            );
          })
        : null}
    </>
  );
}

interface DockerGroupMobileSectionProps {
  group: DockerProjectGroup;
  expanded: boolean;
  onToggle: () => void;
  pendingIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  onToggleGroupSelection: (group: DockerProjectGroup) => void;
  onToggleContainerSelection: (containerId: string) => void;
  onExecute: (target: DockerContainer, command: DockerCommand) => void;
  onRemove: (target: DockerContainer) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function DockerGroupMobileSection({
  group,
  expanded,
  onToggle,
  pendingIds,
  selectedIds,
  onToggleGroupSelection,
  onToggleContainerSelection,
  onExecute,
  onRemove,
  t,
}: DockerGroupMobileSectionProps) {
  const runningCount = group.containers.filter((item) => item.state === "running").length;
  const projectLabel = group.composeProject ?? t("docker.unassignedProject");
  const groupKey = dockerProjectGroupKey(group);
  const groupContainerIds = group.containers.map((item) => item.id);
  const groupSelection = resolveSelectionState(groupContainerIds, selectedIds);

  const renderContainerCard = (container: DockerContainer) => {
    const pending = pendingIds.has(container.id);
    const selected = selectedIds.has(container.id);
    return (
      <article
        key={container.id}
        className={`rounded-lg border bg-background p-3 shadow-sm ${selected ? "border-primary/40 bg-primary/5" : ""}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <SelectionCheckbox
              checked={selected}
              ariaLabel={t("docker.selectContainer", { name: container.name })}
              onChange={() => onToggleContainerSelection(container.id)}
              className="mt-0.5"
            />
            <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT_CLASS[container.state] ?? "bg-zinc-400"}`}
                aria-hidden
              />
              <h3 className="truncate font-medium">{container.name}</h3>
            </div>
            <p className="text-xs text-muted-foreground">{container.status}</p>
            </div>
          </div>
          <ContainerActions
            container={container}
            pending={pending}
            onExecute={onExecute}
            onRemove={onRemove}
            t={t}
          />
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t("docker.columns.image")}</dt>
            <dd className="truncate" title={container.image}>
              {container.image}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("docker.columns.ports")}</dt>
            <dd className="truncate" title={container.ports}>
              {container.ports || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("docker.columns.cpu")}</dt>
            <dd className="tabular-nums">{container.cpuPercent ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("docker.columns.memory")}</dt>
            <dd className="tabular-nums">{container.memoryUsage ?? "—"}</dd>
          </div>
        </dl>
      </article>
    );
  };

  return (
    <section key={groupKey} className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-3">
        <SelectionCheckbox
          checked={groupSelection.checked}
          indeterminate={groupSelection.indeterminate}
          ariaLabel={t("docker.selectGroup", { project: projectLabel })}
          onChange={() => onToggleGroupSelection(group)}
        />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={onToggle}
          aria-expanded={expanded}
        >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{projectLabel}</span>
          <span className="block truncate text-xs text-muted-foreground" title={group.composeWorkingDir ?? undefined}>
            {shortenPath(group.composeWorkingDir)}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("docker.groupSummary", { total: group.containers.length, running: runningCount })}
        </span>
        </button>
      </div>
      {expanded ? <div className="grid gap-3 p-3">{group.containers.map(renderContainerCard)}</div> : null}
    </section>
  );
}

export function DockerPage() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<DockerOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [sortKey, setSortKey] = useState<DockerSortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [removeTarget, setRemoveTarget] = useState<DockerContainer | null>(null);
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const data = await fetchDockerOverview(controller.signal);
      setOverview(data);
      setLoadError(null);
    } catch (error) {
      if (!isCanceledError(error)) {
        setLoadError(describeDockerError(error));
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [refresh]);

  const filteredContainers = useMemo(() => {
    const containers = overview?.containers ?? [];
    const query = search.trim().toLowerCase();
    return containers.filter((item) => {
      if (onlyRunning && item.state !== "running") return false;
      if (!query) return true;
      return [item.name, item.image, item.composeProject ?? "", item.composeWorkingDir ?? ""].some(
        (field) => field.toLowerCase().includes(query),
      );
    });
  }, [overview, search, onlyRunning]);

  const groups = useMemo(
    () => groupDockerContainersByProject(filteredContainers, sortKey, sortAsc),
    [filteredContainers, sortKey, sortAsc],
  );

  const visibleContainerIds = useMemo(
    () => filteredContainers.map((container) => container.id),
    [filteredContainers],
  );

  const allSelection = useMemo(
    () => resolveSelectionState(visibleContainerIds, selectedIds),
    [visibleContainerIds, selectedIds],
  );

  const selectedContainers = useMemo(
    () => filteredContainers.filter((container) => selectedIds.has(container.id)),
    [filteredContainers, selectedIds],
  );

  useEffect(() => {
    const visible = new Set(visibleContainerIds);
    setSelectedIds((previous) => {
      const next = new Set([...previous].filter((id) => visible.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [visibleContainerIds]);

  const toggleContainerSelection = useCallback((containerId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(containerId)) next.delete(containerId);
      else next.add(containerId);
      return next;
    });
  }, []);

  const toggleGroupSelection = useCallback((group: DockerProjectGroup) => {
    const ids = group.containers.map((container) => container.id);
    setSelectedIds((previous) => {
      const next = new Set(previous);
      const allSelected = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      const allSelected = visibleContainerIds.every((id) => next.has(id));
      for (const id of visibleContainerIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [visibleContainerIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const bulkActionTargets = useMemo(
    () => ({
      start: selectedContainers.filter((container) => container.state !== "running"),
      stop: selectedContainers.filter((container) => container.state === "running"),
      restart: selectedContainers.filter((container) => container.state === "running"),
      remove: selectedContainers,
    }),
    [selectedContainers],
  );

  const bulkPending = useMemo(
    () => selectedContainers.some((container) => pendingIds.has(container.id)),
    [pendingIds, selectedContainers],
  );

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  const isGroupExpanded = useCallback(
    (groupKey: string) => !collapsedGroups.has(groupKey),
    [collapsedGroups],
  );

  const executeCommand = useCallback(
    async (target: DockerContainer, command: DockerCommand, force = false) => {
      setPendingIds((previous) => new Set(previous).add(target.id));
      setActionError(null);
      try {
        await runDockerCommand(target.id, command, { force });
        await refresh();
      } catch (error) {
        setActionError(t("docker.actionFailed", { message: describeDockerError(error) }));
      } finally {
        setPendingIds((previous) => {
          const next = new Set(previous);
          next.delete(target.id);
          return next;
        });
      }
    },
    [refresh, t],
  );

  const executeBulkCommand = useCallback(
    async (command: DockerCommand, targets: DockerContainer[]) => {
      if (targets.length === 0) return;
      setActionError(null);
      const targetIds = targets.map((target) => target.id);
      setPendingIds((previous) => new Set([...previous, ...targetIds]));
      try {
        const results = await Promise.allSettled(
          targets.map((target) =>
            runDockerCommand(target.id, command, {
              force: command === "remove" && target.state === "running",
            }),
          ),
        );
        const failedCount = results.filter((result) => result.status === "rejected").length;
        if (failedCount > 0) {
          setActionError(
            t("docker.bulkActionFailed", { count: failedCount, total: targets.length }),
          );
        } else {
          setSelectedIds((previous) => {
            const next = new Set(previous);
            for (const id of targetIds) next.delete(id);
            return next;
          });
        }
        await refresh();
      } finally {
        setPendingIds((previous) => {
          const next = new Set(previous);
          for (const id of targetIds) next.delete(id);
          return next;
        });
      }
    },
    [refresh, t],
  );

  const handleExecute = useCallback(
    (target: DockerContainer, command: DockerCommand) => {
      void executeCommand(target, command);
    },
    [executeCommand],
  );

  const toggleSort = useCallback(
    (key: DockerSortKey) => {
      if (key === sortKey) {
        setSortAsc((previous) => !previous);
        return;
      }
      setSortKey(key);
      setSortAsc(true);
    },
    [sortKey],
  );

  const confirmRemove = useCallback(async () => {
    if (!removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    await executeCommand(target, "remove", target.state === "running");
  }, [executeCommand, removeTarget]);

  const confirmBulkRemove = useCallback(async () => {
    const targets = bulkActionTargets.remove;
    setBulkRemoveOpen(false);
    await executeBulkCommand("remove", targets);
  }, [bulkActionTargets.remove, executeBulkCommand]);

  const daemonError = loadError ?? (overview && !overview.available ? overview.error : null);

  const renderGroupedContent = (): ReactNode => {
    if (groups.length === 0) {
      return (
        <div className="rounded-lg border px-3 py-8 text-center text-sm text-muted-foreground">
          {overview === null ? t("docker.loading") : t("docker.empty")}
        </div>
      );
    }

    return (
      <>
        <div className="hidden overflow-hidden rounded-lg border md:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <SelectionCheckbox
                      checked={allSelection.checked}
                      indeterminate={allSelection.indeterminate}
                      ariaLabel={t("docker.selectAll")}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-3 py-2">
                    <SortButton
                      label={t("docker.columns.name")}
                      active={sortKey === "name"}
                      ascending={sortAsc}
                      onClick={() => toggleSort("name")}
                    />
                  </th>
                  <th className="hidden px-3 py-2 lg:table-cell">
                    <SortButton
                      label={t("docker.columns.image")}
                      active={sortKey === "image"}
                      ascending={sortAsc}
                      onClick={() => toggleSort("image")}
                    />
                  </th>
                  <th className="px-3 py-2">
                    <SortButton
                      label={t("docker.columns.status")}
                      active={sortKey === "state"}
                      ascending={sortAsc}
                      onClick={() => toggleSort("state")}
                    />
                  </th>
                  <th className="hidden px-3 py-2 xl:table-cell">{t("docker.columns.ports")}</th>
                  <th className="hidden px-3 py-2 md:table-cell">
                    <SortButton
                      label={t("docker.columns.cpu")}
                      active={sortKey === "cpuPercent"}
                      ascending={sortAsc}
                      onClick={() => toggleSort("cpuPercent")}
                    />
                  </th>
                  <th className="hidden px-3 py-2 lg:table-cell">{t("docker.columns.memory")}</th>
                  <th className="px-2 py-2 sm:px-3" />
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const groupKey = dockerProjectGroupKey(group);
                  return (
                    <DockerGroupTableRows
                      key={groupKey}
                      group={group}
                      expanded={isGroupExpanded(groupKey)}
                      onToggle={() => toggleGroup(groupKey)}
                      pendingIds={pendingIds}
                      selectedIds={selectedIds}
                      onToggleGroupSelection={toggleGroupSelection}
                      onToggleContainerSelection={toggleContainerSelection}
                      onExecute={handleExecute}
                      onRemove={setRemoveTarget}
                      t={t}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-3 md:hidden">
          {groups.map((group) => {
            const groupKey = dockerProjectGroupKey(group);
            return (
              <DockerGroupMobileSection
                key={groupKey}
                group={group}
                expanded={isGroupExpanded(groupKey)}
                onToggle={() => toggleGroup(groupKey)}
                pendingIds={pendingIds}
                selectedIds={selectedIds}
                onToggleGroupSelection={toggleGroupSelection}
                onToggleContainerSelection={toggleContainerSelection}
                onExecute={handleExecute}
                onRemove={setRemoveTarget}
                t={t}
              />
            );
          })}
        </div>
      </>
    );
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
        <header>
          <h1 className="text-xl font-semibold">{t("docker.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("docker.subtitle")}</p>
        </header>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("docker.searchPlaceholder")}
            className="w-full sm:max-w-xs"
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyRunning}
              onChange={(event) => setOnlyRunning(event.target.checked)}
              className="h-4 w-4"
            />
            {t("docker.onlyRunning")}
          </label>
          <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
            <SortButton
              label={t("docker.columns.project")}
              active={sortKey === "composeProject"}
              ascending={sortAsc}
              onClick={() => toggleSort("composeProject")}
            />
          </div>
        </div>

        {daemonError ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            {t("docker.unavailable")}: {daemonError}
          </div>
        ) : null}
        {actionError ? (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100">
            {actionError}
          </div>
        ) : null}

        {selectedIds.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            <span className="text-sm font-medium">
              {t("docker.selectionSummary", {
                selected: selectedIds.size,
                total: filteredContainers.length,
              })}
            </span>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={bulkPending || bulkActionTargets.start.length === 0}
                onClick={() => void executeBulkCommand("start", bulkActionTargets.start)}
              >
                <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {t("docker.bulkActions.start")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={bulkPending || bulkActionTargets.stop.length === 0}
                onClick={() => void executeBulkCommand("stop", bulkActionTargets.stop)}
              >
                <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {t("docker.bulkActions.stop")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={bulkPending || bulkActionTargets.restart.length === 0}
                onClick={() => void executeBulkCommand("restart", bulkActionTargets.restart)}
              >
                <RotateCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {t("docker.bulkActions.restart")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={bulkPending || bulkActionTargets.remove.length === 0}
                onClick={() => setBulkRemoveOpen(true)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5 text-red-500" aria-hidden />
                {t("docker.bulkActions.remove")}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={bulkPending} onClick={clearSelection}>
                {t("docker.clearSelection")}
              </Button>
            </div>
          </div>
        ) : null}

        {renderGroupedContent()}

        <Dialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("docker.removeTitle")}</DialogTitle>
              <DialogDescription>
                {t("docker.removeDescription", { name: removeTarget?.name ?? "" })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRemoveTarget(null)}>
                {t("docker.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={removeTarget !== null && pendingIds.has(removeTarget.id)}
                onClick={() => void confirmRemove()}
              >
                {t("docker.removeConfirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={bulkRemoveOpen} onOpenChange={setBulkRemoveOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("docker.bulkRemoveTitle")}</DialogTitle>
              <DialogDescription>
                {t("docker.bulkRemoveDescription", { count: bulkActionTargets.remove.length })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setBulkRemoveOpen(false)}>
                {t("docker.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={bulkPending}
                onClick={() => void confirmBulkRemove()}
              >
                {t("docker.removeConfirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
