import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { getCommitEvidence } from "@/services/commitEvidence";
import type { CommitEvidenceDetail, CommitEvidenceSummary, CommitFileChange } from "@/types/commitEvidence";

interface CommitDiffSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  identifier: string;
  commit: CommitEvidenceSummary | null;
}

export function CommitDiffSheet({
  open,
  onOpenChange,
  projectSlug,
  identifier,
  commit,
}: CommitDiffSheetProps) {
  const [detail, setDetail] = useState<CommitEvidenceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !commit) {
      setDetail(null);
      setError(null);
      setSelectedPath(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void getCommitEvidence(projectSlug, identifier, commit.repo, commit.sha)
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        setSelectedPath(result.files[0]?.path ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load commit diff.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, commit, projectSlug, identifier]);

  const selectedFile = detail?.files.find((file) => file.path === selectedPath) ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden p-0 sm:max-w-3xl lg:max-w-4xl">
        <SheetHeader className="border-b px-6 py-4 text-left">
          <SheetTitle className="font-mono text-sm">
            {commit ? `${commit.shortSha} · ${commit.repo}` : "Commit"}
          </SheetTitle>
          <SheetDescription className="text-left text-sm text-foreground">
            {commit?.message ?? "Agent commit changes"}
          </SheetDescription>
          {commit ? (
            <p className="text-xs text-muted-foreground">
              {commit.author} · {formatDate(commit.authoredAt)} · +{commit.insertions} / -{commit.deletions}
            </p>
          ) : null}
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading diff…
            </div>
          ) : null}

          {error ? <p className="px-6 py-4 text-sm text-destructive">{error}</p> : null}

          {!loading && !error && detail ? (
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <FileList
                files={detail.files}
                onSelect={setSelectedPath}
                selectedPath={selectedPath}
              />
              <FileDiff file={selectedFile} />
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FileList({
  files,
  selectedPath,
  onSelect,
}: {
  files: CommitFileChange[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  if (files.length === 0) {
    return (
      <div className="border-b px-4 py-3 text-sm text-muted-foreground md:w-56 md:border-b-0 md:border-r">
        No file changes in this commit.
      </div>
    );
  }

  return (
    <div className="max-h-40 overflow-y-auto border-b md:max-h-none md:w-56 md:shrink-0 md:border-b-0 md:border-r">
      {files.map((file) => (
        <button
          className={cn(
            "flex w-full flex-col gap-0.5 border-b px-4 py-2 text-left text-xs last:border-b-0 hover:bg-muted/60",
            selectedPath === file.path && "bg-muted",
          )}
          key={file.path}
          onClick={() => onSelect(file.path)}
          type="button"
        >
          <span className="truncate font-mono">{file.path}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{file.status}</span>
        </button>
      ))}
    </div>
  );
}

function FileDiff({ file }: { file: CommitFileChange | null }) {
  if (!file) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Select a file to view its diff.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-950 p-4">
      <pre className="font-mono text-[11px] leading-5">
        {file.patch.split("\n").map((line, index) => (
          <DiffLine key={`${file.path}-${index}`} line={line} />
        ))}
      </pre>
    </div>
  );
}

function DiffLine({ line }: { line: string }) {
  const className = cn(
    "block whitespace-pre-wrap break-words",
    line.startsWith("+") && !line.startsWith("+++")
      ? "text-emerald-300"
      : line.startsWith("-") && !line.startsWith("---")
        ? "text-red-300"
        : line.startsWith("@@")
          ? "text-sky-300"
          : "text-slate-200",
  );

  return <code className={className}>{line || " "}</code>;
}

function formatDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
