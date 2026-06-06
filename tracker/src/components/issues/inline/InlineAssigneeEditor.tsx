import { Check, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { cn } from "@/lib/utils";
import type { IssueAssigneeOption } from "@/types/issue";

interface InlineAssigneeEditorProps {
  assignee: string | null;
  options: IssueAssigneeOption[];
  optionsLoading?: boolean;
  disabled?: boolean;
  saving?: boolean;
  onSave: (assigneeIds: string[]) => Promise<boolean>;
}

function assigneeValue(option: IssueAssigneeOption): string {
  return option.id ?? option.login ?? "";
}

function findOption(options: IssueAssigneeOption[], login: string | null): IssueAssigneeOption | null {
  if (!login) return null;
  const normalized = login.toLowerCase();
  return (
    options.find((option) => option.login?.toLowerCase() === normalized) ??
    options.find((option) => option.id === login) ??
    null
  );
}

export function InlineAssigneeEditor({
  assignee,
  options,
  optionsLoading = false,
  disabled = false,
  saving = false,
  onSave,
}: InlineAssigneeEditorProps) {
  const current = findOption(options, assignee);
  const currentValue = current ? assigneeValue(current) : assignee ?? "";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(currentValue);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setDraft(currentValue);
  }, [open, currentValue]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const optionItems = useMemo(() => {
    const items = options
      .filter((option) => assigneeValue(option) !== "")
      .map((option) => ({
        value: assigneeValue(option),
        label: option.name?.trim() || option.login || option.id || "Unknown",
        login: option.login,
      }));

    if (assignee && !items.some((item) => item.login === assignee || item.value === assignee)) {
      items.unshift({ value: assignee, label: assignee, login: assignee });
    }

    return items;
  }, [assignee, options]);

  async function commit() {
    const nextIds = draft ? [draft] : [];
    const currentIds = currentValue ? [currentValue] : [];
    const unchanged =
      nextIds.length === currentIds.length && nextIds.every((id) => currentIds.includes(id));
    if (unchanged) {
      setOpen(false);
      return;
    }
    const saved = await onSave(nextIds);
    if (saved) setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled || saving}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "group inline-flex w-full items-center gap-1.5 rounded-lg border border-transparent px-1 py-1 text-left transition-colors",
          "hover:border-border/60 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
          open && "border-border/60 bg-muted/20",
          disabled ? "cursor-default opacity-70" : "cursor-pointer",
        )}
      >
        <AssigneeAvatar login={assignee} />
        <span className="text-sm">{assignee || "Unassigned"}</span>
      </button>

      {open ? (
        <div className="absolute left-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-border/70 bg-popover p-2 shadow-lg">
          <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Assignee
          </div>
          {optionsLoading ? (
            <p className="px-1 text-xs text-muted-foreground">Loading users…</p>
          ) : (
            <div className="max-h-40 space-y-0.5 overflow-y-auto">
              <button
                type="button"
                aria-pressed={draft === ""}
                onClick={() => setDraft("")}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  draft === "" ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
                )}
              >
                <UserRound className="h-4 w-4 opacity-70" />
                Unassigned
              </button>
              {optionItems.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={draft === item.value}
                  onClick={() => setDraft(item.value)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    draft === item.value ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
                  )}
                >
                  <AssigneeAvatar login={item.login} />
                  {item.label}
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5 border-t border-border/60 pt-2">
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
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
