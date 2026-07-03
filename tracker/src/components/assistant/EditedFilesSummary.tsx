import { useMemo, useState } from "react";

import { GitDiffViewer } from "@/components/issues/issue-detail/git-diff/GitDiffViewer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { diffStatsFromPatch } from "@/lib/diffStats";
import { loadDiffViewMode } from "@/lib/diffViewMode";
import type { AssistantToolCall } from "@/services/assistant";
import type { GitDiffFileChange } from "@/types/gitDiff";

interface EditedFilesSummaryProps {
  toolCalls: AssistantToolCall[];
}

interface EditedFileEntry {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
}

export function EditedFilesSummary({ toolCalls }: EditedFilesSummaryProps) {
  const files = useMemo(() => editedFilesFromToolCalls(toolCalls), [toolCalls]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewMode] = useState(() => loadDiffViewMode());

  if (files.length === 0) return null;

  const selected = files.find((file) => file.path === selectedPath) ?? null;
  const selectedDiff: GitDiffFileChange | null = selected
    ? { path: selected.path, oldPath: null, status: "modified", patch: selected.patch }
    : null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>
        Edited {files.length} file{files.length === 1 ? "" : "s"}:
      </span>
      {files.map((file) => (
        <Button
          key={file.path}
          type="button"
          variant="outline"
          size="sm"
          className="h-6 max-w-full gap-1.5 rounded-md px-2 font-mono text-[11px]"
          aria-label={`View changes to ${file.path}`}
          title={file.path}
          onClick={() => setSelectedPath(file.path)}
        >
          <span className="min-w-0 truncate">{baseName(file.path)}</span>
          <span className="shrink-0 text-emerald-600">+{file.additions}</span>
          <span className="shrink-0 text-rose-600">-{file.deletions}</span>
        </Button>
      ))}

      <Dialog open={selected != null} onOpenChange={(open) => !open && setSelectedPath(null)}>
        <DialogContent className="flex h-[min(84vh,760px)] max-w-5xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle>Edited file diff</DialogTitle>
            <DialogDescription>{selected?.path ?? "No file selected"}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <GitDiffViewer file={selectedDiff} viewMode={viewMode} />
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

function entriesFromToolCall(call: AssistantToolCall): EditedFileEntry[] {
  const result = (call.result ?? {}) as Record<string, unknown>;
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
