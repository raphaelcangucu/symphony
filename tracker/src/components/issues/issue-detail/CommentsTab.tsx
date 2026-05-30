import { FormEvent, KeyboardEvent, ReactNode, useRef, useState } from "react";
import { Bold, Code, Heading, Italic, Link2, List, ListChecks, ListOrdered, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Comment, CreateCommentInput } from "@/types/comment";

import { CommentCard, WorkpadBadge } from "./CommentCard";

interface CommentsTabProps {
  comments: Comment[];
  loading: boolean;
  error: string | null;
  onAddComment: (input: CreateCommentInput) => Promise<Comment>;
}

type ComposerMode = "write" | "preview";

export function CommentsTab({ comments, loading, error, onAddComment }: CommentsTabProps) {
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<ComposerMode>("write");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSubmit = body.trim().length > 0 && !submitting;

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
    const selected = body.slice(start, end) || "text";
    const snippet = `[${selected}](url)`;
    const next = body.slice(0, start) + snippet + body.slice(end);
    setBody(next);
    const urlStart = start + selected.length + 3;
    restoreSelection(urlStart, urlStart + 3);
  }

  const actions: { Icon: LucideIcon; label: string; run: () => void }[] = [
    { Icon: Heading, label: "Heading", run: () => prefixLines("## ") },
    { Icon: Bold, label: "Bold", run: () => surround("**", "**", "bold") },
    { Icon: Italic, label: "Italic", run: () => surround("_", "_", "italic") },
    { Icon: Code, label: "Code", run: () => surround("`", "`", "code") },
    { Icon: Link2, label: "Link", run: insertLink },
    { Icon: List, label: "Bulleted list", run: () => prefixLines("- ") },
    { Icon: ListOrdered, label: "Numbered list", run: () => prefixLines((index) => `${index + 1}. `) },
    { Icon: ListChecks, label: "Task list", run: () => prefixLines("- [ ] ") },
  ];

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onAddComment({ body });
      setBody("");
      setMode("write");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to add comment");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div className="space-y-4">
      <form className="overflow-hidden rounded-lg border" onSubmit={handleSubmit}>
        <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-1.5 py-1.5">
          <div className="flex items-center gap-1">
            <ComposerTab active={mode === "write"} onClick={() => setMode("write")}>
              Write
            </ComposerTab>
            <ComposerTab active={mode === "preview"} onClick={() => setMode("preview")}>
              Preview
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
            <Textarea
              ref={textareaRef}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Use Markdown to format your comment"
              className="min-h-28 resize-y border-0 bg-transparent p-0 shadow-none ring-offset-0 focus-visible:ring-0"
            />
          ) : body.trim() ? (
            <Markdown>{body}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to preview.</p>
          )}
        </div>
        <div className="flex items-center justify-between border-t bg-muted/40 px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded border px-1 font-mono text-[10px] font-semibold leading-tight">M↓</span>
            Markdown supported · ⌘/Ctrl+Enter to send
          </span>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {submitting ? "Posting…" : "Comment"}
          </Button>
        </div>
      </form>

      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
      {!error && loading && comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading comments…</p>
      ) : null}
      {!error && !loading && comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : null}

      {comments.map((comment) => (
        <CommentCard
          key={comment.id}
          author={comment.author}
          body={comment.body}
          createdAt={comment.createdAt}
          url={comment.url}
          highlight={comment.kind === "workpad"}
          badge={comment.kind === "workpad" ? <WorkpadBadge /> : undefined}
        />
      ))}
    </div>
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
