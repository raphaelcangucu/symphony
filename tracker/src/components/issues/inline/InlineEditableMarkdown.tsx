import { Check, Eye, Pencil, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";

interface InlineEditableMarkdownProps {
  value: string;
  onSave: (value: string) => Promise<boolean>;
  disabled?: boolean;
  saving?: boolean;
  placeholder?: string;
}

export function InlineEditableMarkdown({
  value,
  onSave,
  disabled = false,
  saving = false,
  placeholder = "Add a description…",
}: InlineEditableMarkdownProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [preview, setPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaId = useId();

  useEffect(() => {
    if (!editing) {
      setDraft(value);
      setPreview(false);
    }
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;
    textareaRef.current?.focus();
  }, [editing, preview]);

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) {
      setEditing(false);
      return;
    }
    const saved = await onSave(trimmed);
    if (saved) setEditing(false);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void commit();
    }
  }

  if (editing) {
    return (
      <div className="overflow-hidden rounded-xl border border-primary/20 bg-card/60 shadow-sm">
        <div className="flex items-center gap-1 border-b border-border/60 bg-muted/30 px-2 py-1.5">
          <TabButton active={!preview} onClick={() => setPreview(false)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Write
          </TabButton>
          <TabButton active={preview} onClick={() => setPreview(true)}>
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            Preview
          </TabButton>
        </div>
        {preview ? (
          <div className="min-h-32 px-4 py-3">
            {draft.trim() ? (
              <Markdown>{draft}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
            )}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            id={textareaId}
            value={draft}
            rows={10}
            aria-label="Issue description"
            className="min-h-32 w-full resize-y border-0 bg-transparent px-4 py-3 text-sm outline-none ring-0 focus-visible:ring-0"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        )}
        <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void commit()}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Save
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={cancel}
            className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
          <span className="text-[11px] text-muted-foreground">⌘↵ to save · Markdown supported</span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled || saving}
      onClick={() => setEditing(true)}
      className={cn(
        "group relative w-full rounded-xl border border-transparent px-3 py-2 text-left transition-colors",
        "hover:border-border/60 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
        disabled ? "cursor-default opacity-70" : "cursor-text",
      )}
    >
      {value.trim() ? (
        <div className="pr-8">
          <Markdown>{value}</Markdown>
        </div>
      ) : (
        <p className="pr-8 text-sm text-muted-foreground">{placeholder}</p>
      )}
      {!disabled ? (
        <Pencil className="pointer-events-none absolute right-3 top-3 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      ) : null}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
