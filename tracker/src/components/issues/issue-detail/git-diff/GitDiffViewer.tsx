import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { diffStatsFromPatch } from "@/lib/diffStats";
import { diffStyleForDiffViewMode, type DiffViewMode } from "@/lib/diffViewMode";
import type { GitDiffFileChange } from "@/types/gitDiff";

interface GitDiffViewerProps {
  file: GitDiffFileChange | null;
  viewMode: DiffViewMode;
}

export function GitDiffViewer({ file, viewMode }: GitDiffViewerProps) {
  const { t } = useTranslation();
  const fileDiff = useMemo(() => {
    if (!file?.patch) return null;
    try {
      return parsePatchFiles(file.patch, file.path).flatMap((patch) => patch.files)[0] ?? null;
    } catch {
      return null;
    }
  }, [file?.patch, file?.path]);

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("issue.diff.selectFile")}
      </div>
    );
  }

  const stats = diffStatsFromPatch(file.patch);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-slate-950">
      <header className="flex h-8 shrink-0 items-center justify-between gap-3 border-b bg-slate-50 px-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-[11px] font-medium text-slate-700">{file.path}</div>
          {file.oldPath ? <div className="truncate text-[10px] text-slate-500">from {file.oldPath}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums">
          <span className="text-emerald-600">+{stats.additions}</span>
          <span className="text-rose-600">-{stats.deletions}</span>
        </div>
      </header>
      {fileDiff ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <FileDiff
            className="min-w-full bg-white text-[11px] leading-5 text-slate-950"
            fileDiff={fileDiff}
            options={{
              diffStyle: diffStyleForDiffViewMode(viewMode),
              overflow: "scroll",
              themeType: "light",
            }}
          />
        </div>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto bg-white p-3 font-mono text-[11px] leading-5 text-slate-900">
          <code>{file.patch || "No patch available."}</code>
        </pre>
      )}
    </div>
  );
}
