import { parsePatchFiles, type DiffLineAnnotation } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { diffStatsFromPatch } from "@/lib/diffStats";
import { lineTextFromPatch, type DiffReviewComment, type DiffReviewSide } from "@/lib/diffReview";
import { diffStyleForDiffViewMode, type DiffViewMode } from "@/lib/diffViewMode";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { GitDiffFileChange } from "@/types/gitDiff";

export interface SaveDiffCommentInput {
  id?: string;
  side: DiffReviewSide;
  lineNumber: number;
  lineText: string | null;
  comment: string;
}

interface GitDiffViewerProps {
  file: GitDiffFileChange | null;
  viewMode: DiffViewMode;
  /** Line comments for THIS file; enables review mode when provided. */
  comments?: DiffReviewComment[];
  onSaveComment?: (input: SaveDiffCommentInput) => void;
  onRemoveComment?: (id: string) => void;
}

type AnnotationMetadata =
  | { kind: "comment"; comment: DiffReviewComment }
  | { kind: "draft"; side: DiffReviewSide; lineNumber: number };

export function GitDiffViewer({ file, viewMode, comments, onSaveComment, onRemoveComment }: GitDiffViewerProps) {
  const { t } = useTranslation();
  const reviewEnabled = comments != null && onSaveComment != null;
  const [draft, setDraft] = useState<{ side: DiffReviewSide; lineNumber: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    setDraft(null);
    setEditingId(null);
  }, [file?.path]);

  const fileDiff = useMemo(() => {
    if (!file?.patch) return null;
    try {
      return parsePatchFiles(file.patch, file.path).flatMap((patch) => patch.files)[0] ?? null;
    } catch {
      return null;
    }
  }, [file]);

  const lineAnnotations = useMemo((): DiffLineAnnotation<AnnotationMetadata>[] => {
    if (!reviewEnabled) return [];
    const entries: DiffLineAnnotation<AnnotationMetadata>[] = (comments ?? []).map((comment) => ({
      side: comment.side,
      lineNumber: comment.lineNumber,
      metadata: { kind: "comment", comment },
    }));
    if (draft && !(comments ?? []).some((c) => c.side === draft.side && c.lineNumber === draft.lineNumber)) {
      entries.push({ side: draft.side, lineNumber: draft.lineNumber, metadata: { kind: "draft", ...draft } });
    }
    return entries;
  }, [comments, draft, reviewEnabled]);

  const options = useMemo(
    () => ({
      diffStyle: diffStyleForDiffViewMode(viewMode),
      overflow: "scroll" as const,
      themeType: "light" as const,
      ...(reviewEnabled
        ? {
            lineHoverHighlight: "number" as const,
            onLineNumberClick: ({ annotationSide, lineNumber }: { annotationSide: DiffReviewSide; lineNumber: number }) => {
              setEditingId(null);
              setDraft({ side: annotationSide, lineNumber });
            },
          }
        : {}),
    }),
    [reviewEnabled, viewMode],
  );

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("issue.diff.selectFile")}
      </div>
    );
  }

  const stats = diffStatsFromPatch(file.patch);

  function saveDraft(comment: string) {
    if (!file || !draft || !onSaveComment) return;
    onSaveComment({
      side: draft.side,
      lineNumber: draft.lineNumber,
      lineText: lineTextFromPatch(file.patch, draft.side, draft.lineNumber),
      comment,
    });
    setDraft(null);
  }

  function saveEdit(existing: DiffReviewComment, comment: string) {
    if (!onSaveComment) return;
    onSaveComment({
      id: existing.id,
      side: existing.side,
      lineNumber: existing.lineNumber,
      lineText: existing.lineText,
      comment,
    });
    setEditingId(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-slate-950">
      <header className="flex h-8 shrink-0 items-center justify-between gap-3 border-b bg-slate-50 px-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-[11px] font-medium text-slate-700">{file.path}</div>
          {file.oldPath ? <div className="truncate text-[10px] text-slate-500">from {file.oldPath}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10px]">
          {reviewEnabled ? (
            <span className="text-slate-500">{t("issue.diff.review.hint")}</span>
          ) : null}
          <span className="tabular-nums text-emerald-600">+{stats.additions}</span>
          <span className="tabular-nums text-rose-600">-{stats.deletions}</span>
        </div>
      </header>
      {fileDiff ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <FileDiff<AnnotationMetadata>
            className="min-w-full bg-white text-[11px] leading-5 text-slate-950"
            fileDiff={fileDiff}
            options={options}
            lineAnnotations={lineAnnotations}
            renderAnnotation={(annotation) => {
              const metadata = annotation.metadata;
              if (!metadata) return null;
              if (metadata.kind === "draft") {
                return (
                  <CommentEditor
                    initialValue=""
                    onSave={saveDraft}
                    onCancel={() => setDraft(null)}
                  />
                );
              }
              if (editingId === metadata.comment.id) {
                return (
                  <CommentEditor
                    initialValue={metadata.comment.comment}
                    onSave={(value) => saveEdit(metadata.comment, value)}
                    onCancel={() => setEditingId(null)}
                  />
                );
              }
              return (
                <CommentCard
                  comment={metadata.comment}
                  onEdit={() => {
                    setDraft(null);
                    setEditingId(metadata.comment.id);
                  }}
                  onRemove={onRemoveComment ? () => onRemoveComment(metadata.comment.id) : undefined}
                />
              );
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

function CommentEditor({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue: string;
  onSave: (comment: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const canSave = value.trim().length > 0;

  return (
    <div className="my-1 rounded-md border border-sky-200 bg-sky-50/80 p-2" data-testid="diff-comment-editor">
      <Textarea
        autoFocus
        value={value}
        rows={2}
        placeholder={t("issue.diff.review.placeholder")}
        className="min-h-14 border-sky-200 bg-white text-xs text-slate-900"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canSave) onSave(value);
        }}
      />
      <div className="mt-1.5 flex justify-end gap-1.5">
        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={!canSave}
          onClick={() => onSave(value)}
        >
          {t("issue.diff.review.save")}
        </Button>
      </div>
    </div>
  );
}

function CommentCard({
  comment,
  onEdit,
  onRemove,
}: {
  comment: DiffReviewComment;
  onEdit: () => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="my-1 rounded-md border border-amber-200 bg-amber-50/90 px-2.5 py-1.5" data-testid="diff-comment-card">
      <p className="whitespace-pre-wrap text-xs text-slate-800">{comment.comment}</p>
      <div className="mt-1 flex justify-end gap-2 text-[10px]">
        <button type="button" className="text-slate-500 hover:text-slate-800" onClick={onEdit}>
          {t("issue.diff.review.edit")}
        </button>
        {onRemove ? (
          <button type="button" className="text-slate-500 hover:text-rose-600" onClick={onRemove}>
            {t("issue.diff.review.remove")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
