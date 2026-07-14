import { useEffect, useMemo, useRef, useState } from "react";

import { GitDiffViewer } from "@/components/issues/issue-detail/git-diff/GitDiffViewer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ComposerContextChipRef } from "@/components/assistant/contextMentions";
import { diffStatsFromPatch } from "@/lib/diffStats";
import { isAbortError } from "@/lib/httpAbort";
import { loadDiffViewMode } from "@/lib/diffViewMode";
import {
  getGitDiffFiles,
  getGitDiffPatch,
  getThreadGitDiffFiles,
  getThreadGitDiffPatch,
  type GitDiffFilesListOptions,
} from "@/services/gitDiff";
import type { AssistantToolCall } from "@/services/assistant";
import type { GitDiffFileChange, GitDiffFileEntry, GitDiffFilesPage } from "@/types/gitDiff";

interface EditedFilesSummaryProps {
  toolCalls: AssistantToolCall[];
  projectSlug?: string;
  issueIdentifier?: string | null;
  threadId?: number | null;
  onInsertContext?: (ref: ComposerContextChipRef) => void;
}

interface EditedFileEntry {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
}

export function EditedFilesSummary({
  toolCalls,
  projectSlug = "",
  issueIdentifier = null,
  threadId = null,
  onInsertContext,
}: EditedFilesSummaryProps) {
  const files = useMemo(() => editedFilesFromToolCalls(toolCalls), [toolCalls]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [resolvedPatches, setResolvedPatches] = useState<Record<string, string>>({});
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [viewMode] = useState(() => loadDiffViewMode());
  const abortRef = useRef<AbortController | null>(null);

  const selected = files.find((file) => file.path === selectedPath) ?? null;
  const selectedPatch = selected ? resolvedPatches[selected.path] ?? selected.patch : "";
  const selectedDiff: GitDiffFileChange | null = selected
    ? { path: selected.path, oldPath: null, status: "modified", patch: selectedPatch }
    : null;

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function openFile(file: EditedFileEntry) {
    setSelectedPath(file.path);
    if (file.patch || resolvedPatches[file.path] || loadingPath === file.path) return;
    if (!threadId && (!projectSlug || !issueIdentifier)) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadingPath(file.path);

    try {
      const listFiles = (params: GitDiffFilesListOptions): Promise<GitDiffFilesPage> =>
        threadId
          ? getThreadGitDiffFiles(threadId, "uncommitted", params)
          : getGitDiffFiles(projectSlug, issueIdentifier ?? "", "uncommitted", params);

      const match = await resolveEditedFileLocation(file.path, listFiles, controller.signal);
      if (controller.signal.aborted || !match) return;

      const patchResult = threadId
        ? await getThreadGitDiffPatch(threadId, "uncommitted", match.repo, match.path, { signal: controller.signal })
        : await getGitDiffPatch(projectSlug, issueIdentifier ?? "", "uncommitted", match.repo, match.path, {
            signal: controller.signal,
          });
      if (controller.signal.aborted) return;

      setResolvedPatches((current) => ({ ...current, [file.path]: patchResult.patch }));
    } catch (cause) {
      if (isAbortError(cause)) return;
    } finally {
      if (!controller.signal.aborted) setLoadingPath(null);
    }
  }

  if (files.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>
        Edited {files.length} file{files.length === 1 ? "" : "s"}:
      </span>
      {files.map((file) => (
        <EditedFileButton
          key={file.path}
          file={file}
          patch={resolvedPatches[file.path] ?? file.patch}
          onClick={() => void openFile(file)}
          onInsertContext={onInsertContext}
        />
      ))}

      <Dialog open={selected != null} onOpenChange={(open) => !open && setSelectedPath(null)}>
        <DialogContent className="flex h-[min(84vh,760px)] max-w-5xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle>Edited file diff</DialogTitle>
            <DialogDescription>{selected?.path ?? "No file selected"}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            {selected && loadingPath === selected.path ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading diff…</div>
            ) : (
              <GitDiffViewer file={selectedDiff} viewMode={viewMode} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function editedFilesFromToolCalls(toolCalls: AssistantToolCall[]): EditedFileEntry[] {
  const byPath = new Map<string, EditedFileEntry>();

  for (const call of toolCalls) {
    if (!isEditTool(call)) continue;

    for (const entry of entriesFromToolCall(call)) {
      const current = byPath.get(entry.path);
      if (!current) {
        byPath.set(entry.path, entry);
        continue;
      }

      byPath.set(entry.path, {
        path: entry.path,
        patch: [current.patch, entry.patch].filter(Boolean).join("\n"),
        additions: current.additions + entry.additions,
        deletions: current.deletions + entry.deletions,
      });
    }
  }

  return [...byPath.values()];
}

/**
 * Codex tool-call results may already carry native per-file patches (see
 * `FileActivityPresenter`/`FileChangeCapture` on the backend) via
 * `result.files`. Those are preferred — no network round-trip needed. Only
 * tool calls without that native breakdown fall back to splitting the
 * aggregate `result.diff` string by path.
 */
function entriesFromToolCall(call: AssistantToolCall): EditedFileEntry[] {
  const result = (call.result ?? {}) as Record<string, unknown>;
  const nativeEntries = nativeFileEntries(result);
  if (nativeEntries.length > 0) return nativeEntries;

  const paths = Array.isArray(result.paths) ? result.paths.filter((path): path is string => typeof path === "string") : [];
  const diff = typeof result.diff === "string" ? result.diff : "";
  const patchByPath = splitPatchByPath(diff);

  return paths.map((path) => {
    const patch = patchByPath.get(path) ?? diff;
    const stats = diffStatsFromPatch(patch);
    const additions = stats.additions > 0 ? stats.additions : numberOrZero(result.additions);
    const deletions = stats.deletions > 0 ? stats.deletions : numberOrZero(result.deletions);
    return { path, patch, additions, deletions };
  });
}

function nativeFileEntries(result: Record<string, unknown>): EditedFileEntry[] {
  const rawFiles = Array.isArray(result.files) ? result.files : [];
  const entries: EditedFileEntry[] = [];

  for (const raw of rawFiles) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const path = typeof entry.path === "string" ? entry.path : null;
    if (!path) continue;

    entries.push({
      path,
      patch: typeof entry.patch === "string" ? entry.patch : "",
      additions: numberOrZero(entry.additions),
      deletions: numberOrZero(entry.deletions),
    });
  }

  return entries;
}

function EditedFileButton({
  file,
  patch,
  onClick,
  onInsertContext,
}: {
  file: EditedFileEntry;
  patch: string;
  onClick: () => void;
  onInsertContext?: (ref: ComposerContextChipRef) => void;
}) {
  const stats = patch ? diffStatsFromPatch(patch) : { additions: file.additions, deletions: file.deletions };

  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 max-w-full gap-1.5 rounded-md px-2 font-mono text-[11px]"
        aria-label={`View changes to ${file.path}`}
        title={file.path}
        onClick={onClick}
      >
        <span className="min-w-0 truncate">{baseName(file.path)}</span>
        <span className="shrink-0 text-emerald-600">+{stats.additions}</span>
        <span className="shrink-0 text-rose-600">-{stats.deletions}</span>
      </Button>
      {onInsertContext ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-md"
          aria-label={`Add ${file.path} to context`}
          title={`Add ${file.path} to context`}
          onClick={() => onInsertContext(contextRefForEditedFile(file, patch, stats))}
        >
          +
        </Button>
      ) : null}
    </span>
  );
}

function contextRefForEditedFile(
  file: EditedFileEntry,
  patch: string,
  stats: { additions: number; deletions: number },
): ComposerContextChipRef {
  const content = [
    "### Agent edited file",
    "",
    `- Path: ${file.path}`,
    `- Additions: ${stats.additions}`,
    `- Deletions: ${stats.deletions}`,
    patch ? ["", "```diff", patch, "```"].join("\n") : null,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");

  return {
    type: "file",
    id: file.path,
    label: baseName(file.path),
    detail: "Edited by agent",
    content,
    state: "draft",
  };
}

function splitPatchByPath(diff: string): Map<string, string> {
  const patches = new Map<string, string>();
  if (!diff.includes("diff --git ")) return patches;

  const chunks = diff
    .split(/\n(?=diff --git )/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const path = pathFromDiffHeader(chunk);
    if (path) patches.set(path, chunk);
  }

  return patches;
}

function pathFromDiffHeader(patch: string): string | null {
  const firstLine = patch.split("\n", 1)[0] ?? "";
  const match = firstLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
  return match?.[2] ?? null;
}

/**
 * Resolves a tool-reported (often absolute) edited path to the exact
 * `{repo, path}` pair the patch API needs, via the paginated/searchable
 * `/diff/files` metadata endpoint — never the full workspace diff.
 */
async function resolveEditedFileLocation(
  editedPath: string,
  listFiles: (params: GitDiffFilesListOptions) => Promise<GitDiffFilesPage>,
  signal: AbortSignal,
): Promise<{ repo: string; path: string } | null> {
  const page = await listFiles({ q: baseName(editedPath), limit: 50, signal });
  return findEntryForEditedPath(page.files, editedPath);
}

function findEntryForEditedPath(entries: GitDiffFileEntry[], editedPath: string): { repo: string; path: string } | null {
  const normalizedEditedPath = normalizePath(editedPath);

  for (const entry of entries) {
    const repoPath = normalizePath(entry.repo ? `${entry.repo}/${entry.path}` : entry.path);
    const filePath = normalizePath(entry.path);

    if (
      normalizedEditedPath === repoPath ||
      normalizedEditedPath === filePath ||
      normalizedEditedPath.endsWith(`/${repoPath}`) ||
      normalizedEditedPath.endsWith(`/${filePath}`)
    ) {
      return { repo: entry.repo, path: entry.path };
    }
  }

  return null;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isEditTool(call: AssistantToolCall): boolean {
  return call.name === "apply_patch" || call.name === "edit_file" || call.name === "write_file";
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? path;
}
