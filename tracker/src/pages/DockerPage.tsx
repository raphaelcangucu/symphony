import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, Play, RotateCw, Square, Trash2 } from "lucide-react";

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
  compareDockerContainers,
  describeDockerError,
  fetchDockerOverview,
  runDockerCommand,
  type DockerCommand,
  type DockerContainer,
  type DockerOverview,
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

  const rows = useMemo(() => {
    const containers = overview?.containers ?? [];
    const query = search.trim().toLowerCase();
    const filtered = containers.filter((item) => {
      if (onlyRunning && item.state !== "running") return false;
      if (!query) return true;
      return [item.name, item.image, item.composeProject ?? "", item.composeWorkingDir ?? ""].some(
        (field) => field.toLowerCase().includes(query),
      );
    });
    const sorted = [...filtered].sort((a, b) => compareDockerContainers(a, b, sortKey));
    return sortAsc ? sorted : sorted.reverse();
  }, [overview, search, onlyRunning, sortKey, sortAsc]);

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

  const daemonError = loadError ?? (overview && !overview.available ? overview.error : null);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-semibold">{t("docker.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("docker.subtitle")}</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("docker.searchPlaceholder")}
          className="max-w-xs"
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

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">
                <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("name")}>
                  {t("docker.columns.name")}
                  <ArrowUpDown className="h-3 w-3" aria-hidden />
                </button>
              </th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1"
                  onClick={() => toggleSort("composeProject")}
                >
                  {t("docker.columns.project")}
                  <ArrowUpDown className="h-3 w-3" aria-hidden />
                </button>
              </th>
              <th className="px-3 py-2">{t("docker.columns.path")}</th>
              <th className="px-3 py-2">
                <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("image")}>
                  {t("docker.columns.image")}
                  <ArrowUpDown className="h-3 w-3" aria-hidden />
                </button>
              </th>
              <th className="px-3 py-2">
                <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("state")}>
                  {t("docker.columns.status")}
                  <ArrowUpDown className="h-3 w-3" aria-hidden />
                </button>
              </th>
              <th className="px-3 py-2">{t("docker.columns.ports")}</th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1"
                  onClick={() => toggleSort("cpuPercent")}
                >
                  {t("docker.columns.cpu")}
                  <ArrowUpDown className="h-3 w-3" aria-hidden />
                </button>
              </th>
              <th className="px-3 py-2">{t("docker.columns.memory")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((container) => {
              const pending = pendingIds.has(container.id);
              return (
                <tr key={container.id} className="border-t">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT_CLASS[container.state] ?? "bg-zinc-400"}`}
                        aria-hidden
                      />
                      <span className="font-medium">{container.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">{container.composeProject ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground" title={container.composeWorkingDir ?? undefined}>
                    {shortenPath(container.composeWorkingDir)}
                  </td>
                  <td className="max-w-56 truncate px-3 py-2" title={container.image}>
                    {container.image}
                  </td>
                  <td className="px-3 py-2">{container.status}</td>
                  <td className="max-w-48 truncate px-3 py-2" title={container.ports}>
                    {container.ports || "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{container.cpuPercent ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{container.memoryUsage ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center justify-end gap-1">
                      {container.state === "running" ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            aria-label={t("docker.rowActions.stop")}
                            title={t("docker.rowActions.stop")}
                            onClick={() => void executeCommand(container, "stop")}
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
                            onClick={() => void executeCommand(container, "restart")}
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
                          onClick={() => void executeCommand(container, "start")}
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
                        onClick={() => setRemoveTarget(container)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                      </Button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  {overview === null ? t("docker.loading") : t("docker.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

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
    </div>
  );
}
