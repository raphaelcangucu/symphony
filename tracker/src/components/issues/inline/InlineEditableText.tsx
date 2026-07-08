import { Check, Pencil, X } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface InlineEditableTextProps {
  value: string;
  onSave: (value: string) => Promise<boolean>;
  placeholder?: string;
  disabled?: boolean;
  saving?: boolean;
  multiline?: boolean;
  displayClassName?: string;
  inputClassName?: string;
  "aria-label"?: string;
}

export function InlineEditableText({
  value,
  onSave,
  placeholder,
  disabled = false,
  saving = false,
  multiline = false,
  displayClassName,
  inputClassName,
  "aria-label": ariaLabel,
}: InlineEditableTextProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("issue.inlineText.placeholder");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const inputId = useId();

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    if (inputRef.current && "select" in inputRef.current) {
      inputRef.current.select();
    }
  }, [editing]);

  async function commit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(value);
      setEditing(false);
      return;
    }
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

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (!multiline && event.key === "Enter") {
      event.preventDefault();
      void commit();
      return;
    }
    if (multiline && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void commit();
    }
  }

  if (editing) {
    const sharedClassName = cn(
      "w-full rounded-lg border border-primary/30 bg-background/80 px-3 py-2 text-sm shadow-sm outline-none ring-2 ring-primary/15 transition-shadow focus:ring-primary/30",
      inputClassName,
    );

    return (
      <div className="space-y-2">
        {multiline ? (
          <textarea
            ref={inputRef as RefObject<HTMLTextAreaElement>}
            id={inputId}
            value={draft}
            rows={4}
            aria-label={ariaLabel}
            className={cn(sharedClassName, "min-h-24 resize-y")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <input
            ref={inputRef as RefObject<HTMLInputElement>}
            id={inputId}
            value={draft}
            aria-label={ariaLabel}
            className={sharedClassName}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        )}
        <div className="flex items-center gap-1.5">
          <Button type="button" size="sm" disabled={saving} onClick={() => void commit()} className="h-auto gap-1 px-2.5 py-1">
            <Check className="h-3.5 w-3.5" />
            {t("issue.comments.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={cancel}
            className="h-auto gap-1 px-2.5 py-1 text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
            {t("issue.comments.cancel")}
          </Button>
          {multiline ? (
            <span className="text-[11px] text-muted-foreground">{t("issue.inlineText.saveHint")}</span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled || saving}
      aria-label={ariaLabel ?? t("issue.inlineText.editAria")}
      onClick={() => setEditing(true)}
      className={cn(
        "group relative w-full rounded-lg text-left transition-colors",
        "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
        disabled ? "cursor-default opacity-70" : "cursor-text",
        displayClassName,
      )}
    >
      <span className={cn("block pr-8", !value.trim() && "text-muted-foreground")}>
        {value.trim() || resolvedPlaceholder}
      </span>
      {!disabled ? (
        <Pencil className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      ) : null}
    </button>
  );
}
