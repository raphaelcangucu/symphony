import { FormEvent, KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Bold, Code, Heading, Italic, Link2, List, ListChecks, ListOrdered, Pencil, Trash2, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import { useCommentMentions } from "@/hooks/useCommentMentions";
import { useIssueFormOptions } from "@/hooks/useIssueFormOptions";
import { useMarkdownImagePaste } from "@/hooks/useMarkdownImagePaste";
import { cn } from "@/lib/utils";
import type { Comment, CreateCommentInput, UpdateCommentInput } from "@/types/comment";

import { CommentCard, EvidenceBadge, SyncBadge, WorkpadBadge } from "./CommentCard";
import { MentionAutocomplete } from "./MentionAutocomplete";

interface CommentsTabProps {
  comments: Comment[];
  loading: boolean;
  error: string | null;
  projectSlug: string;
  onAddComment: (input: CreateCommentInput) => Promise<Comment>;
  onUpdateComment: (commentId: string, input: UpdateCommentInput) => Promise<Comment>;
  onDeleteComment: (commentId: string) => Promise<void>;
}

type ComposerMode = "write" | "preview";

export function CommentsTab({
  comments,
  loading,
  error,
  projectSlug,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
}: CommentsTabProps) {
  const { t } = useTranslation();
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<ComposerMode>("write");
  const [submitting, setSubmitting] = useState(false);
  const { options: formOptions } = useIssueFormOptions(projectSlug);
  const assignees = formOptions.assignees;
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionContainerRef = useRef<HTMLDivElement>(null);
  const { handlePaste, uploading } = useMarkdownImagePaste({ projectSlug, setValue: setBody });
  const mentions = useCommentMentions(body, assignees);

  useEffect(() => {
    if (!mentions.open) {
      setMentionIndex(0);
    }
  }, [mentions.open, mentions.query]);

  const canSubmit = body.trim().length > 0 && !submitting && !uploading;

  function restoreSelection(start: number, end: number) {
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(start, end);
    });
  }

  function surround(before: string, after: string, placeholder: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = body.slice(start, end) || placeholder;
    const next = body.slice(0, start) + before + selected + after + body.slice(end);
    setBody(next);
    restoreSelection(start + before.length, start + before.length + selected.length);
  }

  function prefixLines(prefix: string | ((index: number) => string)) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const lineStart = body.lastIndexOf("\n", start - 1) + 1;
    const block = body.slice(lineStart, end) || "";
    const replaced = block
      .split("\n")
      .map((line, index) => (typeof prefix === "function" ? prefix(index) : prefix) + line)
      .join("\n");
    const next = body.slice(0, lineStart) + replaced + body.slice(end);
    setBody(next);
    restoreSelection(lineStart, lineStart + replaced.length);
  }

  function insertLink() {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = body.slice(start, end) || t("issue.comments.linkPlaceholder");
    const snippet = `[${selected}](url)`;
    const next = body.slice(0, start) + snippet + body.slice(end);
    setBody(next);
    const urlStart = start + selected.length + 3;
    restoreSelection(urlStart, urlStart + 3);
  }

  const actions: { Icon: LucideIcon; label: string; run: () => void }[] = useMemo(
    () => [
      { Icon: Heading, label: t("issue.comments.toolbar.heading"), run: () => prefixLines("## ") },
      { Icon: Bold, label: t("issue.comments.toolbar.bold"), run: () => surround("**", "**", "bold") },
      { Icon: Italic, label: t("issue.comments.toolbar.italic"), run: () => surround("_", "_", "italic") },
      { Icon: Code, label: t("issue.comments.toolbar.code"), run: () => surround("`", "`", "code") },
      { Icon: Link2, label: t("issue.comments.toolbar.link"), run: insertLink },
      { Icon: List, label: t("issue.comments.toolbar.bulletedList"), run: () => prefixLines("- ") },
      {
        Icon: ListOrdered,
        label: t("issue.comments.toolbar.numberedList"),
        run: () => prefixLines((index) => `${index + 1}. `),
      },
      { Icon: ListChecks, label: t("issue.comments.toolbar.taskList"), run: () => prefixLines("- [ ] ") },
    ],
    [body, t],
  );

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onAddComment({ body });
      setBody("");
      setMode("write");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.comments.addFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function applyMention(login: string) {
    const next = mentions.selectMention(login);
    if (!next) return;
    setBody(next);
    const cursor = next.length;
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentions.open && mentions.filteredAssignees.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((current) => (current + 1) % mentions.filteredAssignees.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((current) =>
          current === 0 ? mentions.filteredAssignees.length - 1 : current - 1,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const login = mentions.filteredAssignees[mentionIndex]?.login;
        if (login) applyMention(login);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        mentions.close();
        return;
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div className="space-y-4">
      <form className="rounded-lg border" onSubmit={handleSubmit}>
        <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-1.5 py-1.5">
          <div className="flex items-center gap-1">
            <ComposerTab active={mode === "write"} onClick={() => setMode("write")}>
              {t("issue.comments.write")}
            </ComposerTab>
            <ComposerTab active={mode === "preview"} onClick={() => setMode("preview")}>
              {t("issue.comments.preview")}
            </ComposerTab>
          </div>
          {mode === "write" ? (
            <div className="flex items-center gap-0.5">
              {actions.map(({ Icon, label, run }) => (
                <button
                  key={label}
                  type="button"
                  title={label}
                  aria-label={label}
                  onClick={run}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="p-3">
          {mode === "write" ? (
            <div ref={mentionContainerRef} className="relative overflow-visible">
              <Textarea
                ref={textareaRef}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  mentions.handleChange(event.target.value, event.target.selectionStart);
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={t("issue.comments.placeholder")}
                className="min-h-28 resize-y border-0 bg-transparent p-0 shadow-none ring-offset-0 focus-visible:ring-0"
              />
              <MentionAutocomplete
                open={mentions.open}
                options={mentions.filteredAssignees}
                activeIndex={mentionIndex}
                onSelect={applyMention}
                anchorRef={textareaRef}
                containerRef={mentionContainerRef}
                caretIndex={mentions.mentionStart + 1 + mentions.query.length}
              />
            </div>
          ) : body.trim() ? (
            <Markdown>{body}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">{t("issue.comments.nothingToPreview")}</p>
          )}
        </div>
        <div className="flex items-center justify-between border-t bg-muted/40 px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded border px-1 font-mono text-[10px] font-semibold leading-tight">M↓</span>
            {uploading ? t("issue.comments.uploadingImage") : t("issue.comments.markdownHint")}
          </span>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {submitting ? t("issue.comments.posting") : t("issue.comments.comment")}
          </Button>
        </div>
      </form>

      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
      {!error && loading && comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("issue.comments.loading")}</p>
      ) : null}
      {!error && !loading && comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("issue.comments.empty")}</p>
      ) : null}

      {comments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          projectSlug={projectSlug}
          onUpdateComment={onUpdateComment}
          onDeleteComment={onDeleteComment}
        />
      ))}
    </div>
  );
}

interface CommentItemProps {
  comment: Comment;
  projectSlug: string;
  onUpdateComment: (commentId: string, input: UpdateCommentInput) => Promise<Comment>;
  onDeleteComment: (commentId: string) => Promise<void>;
}

function CommentItem({ comment, projectSlug, onUpdateComment, onDeleteComment }: CommentItemProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [mode, setMode] = useState<ComposerMode>("write");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { handlePaste, uploading } = useMarkdownImagePaste({ projectSlug, setValue: setBody });

  const canSave = body.trim().length > 0 && !saving && !uploading && !deleting;

  async function saveEdit() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onUpdateComment(comment.id, { body });
      setEditing(false);
      setMode("write");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.comments.updateFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    const confirmed = window.confirm(t("issue.comments.deleteConfirm"));
    if (!confirmed) return;
    setDeleting(true);
    try {
      await onDeleteComment(comment.id);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.comments.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setBody(comment.body);
      setEditing(false);
      setMode("write");
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void saveEdit();
    }
  }

  if (editing) {
    return (
      <form
        className="rounded-lg border"
        onSubmit={(event) => {
          event.preventDefault();
          void saveEdit();
        }}
      >
        <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-1.5 py-1.5">
          <div className="flex items-center gap-1">
            <ComposerTab active={mode === "write"} onClick={() => setMode("write")}>
              {t("issue.comments.write")}
            </ComposerTab>
            <ComposerTab active={mode === "preview"} onClick={() => setMode("preview")}>
              {t("issue.comments.preview")}
            </ComposerTab>
          </div>
        </div>
        <div className="p-3">
          {mode === "write" ? (
            <Textarea
              ref={textareaRef}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={handleEditKeyDown}
              onPaste={handlePaste}
              className="min-h-28 resize-y border-0 bg-transparent p-0 shadow-none ring-offset-0 focus-visible:ring-0"
            />
          ) : body.trim() ? (
            <Markdown>{body}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">{t("issue.comments.nothingToPreview")}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t bg-muted/40 px-3 py-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving || deleting}
            onClick={() => {
              setBody(comment.body);
              setEditing(false);
              setMode("write");
            }}
          >
            {t("issue.comments.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={!canSave}>
            {saving ? t("issue.comments.saving") : t("issue.comments.save")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <CommentCard
      author={comment.author}
      body={comment.body}
      createdAt={comment.createdAt}
      url={comment.url}
      kind={comment.kind}
      highlight={comment.kind === "workpad" || comment.kind === "evidence"}
      badge={
        <>
          {comment.kind === "workpad" ? <WorkpadBadge /> : null}
          {comment.kind === "evidence" ? <EvidenceBadge /> : null}
          <SyncBadge syncStatus={comment.syncStatus} />
        </>
      }
      actions={
        <>
          <button
            type="button"
            title={t("issue.comments.editAria")}
            aria-label={t("issue.comments.editAria")}
            disabled={deleting}
            onClick={() => {
              setBody(comment.body);
              setEditing(true);
            }}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={t("issue.comments.deleteAria")}
            aria-label={t("issue.comments.deleteAria")}
            disabled={deleting}
            onClick={() => void handleDelete()}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-rose-600 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      }
    />
  );
}

function ComposerTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-xs font-medium transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
