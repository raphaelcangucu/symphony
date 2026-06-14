import { Check, Plus, Search, Tag, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { labelDotClass } from "@/components/board/label-colors";
import { resolveLabelColor, resolveLabelDisplay } from "@/lib/labelDisplay";
import { isSymphonyLabelName, matchesPickerSearch, sortLabelPickerItems } from "@/lib/pickerOptions";
import { cn } from "@/lib/utils";
import type { IssueLabelOption } from "@/types/issue";

interface InlineLabelEditorProps {
  labels: string[];
  options: IssueLabelOption[];
  optionsLoading?: boolean;
  disabled?: boolean;
  saving?: boolean;
  onSave: (labelIds: string[]) => Promise<boolean>;
}

function labelValue(label: IssueLabelOption): string {
  return label.id ?? label.name;
}

function canonicalizeDraftLabels(draft: string[], options: IssueLabelOption[]): string[] {
  const byId = new Map(options.map((option) => [labelValue(option), labelValue(option)]));
  const byName = new Map(options.map((option) => [option.name.trim().toLowerCase(), labelValue(option)]));

  return draft.map((label) => {
    if (byId.has(label)) return label;
    const canonical = byName.get(label.trim().toLowerCase());
    return canonical ?? label;
  });
}

function normalizeHexColor(color: string | null | undefined): string | null {
  if (!color) return null;
  const trimmed = color.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(trimmed)) return null;
  return `#${trimmed}`;
}

export function InlineLabelEditor({
  labels,
  options,
  optionsLoading = false,
  disabled = false,
  saving = false,
  onSave,
}: InlineLabelEditorProps) {
  const selectedLabels = useMemo(
    () => labels.filter((label) => label.trim() !== ""),
    [labels],
  );
  // Stable value-key so the sync effect below only runs when label content changes.
  const selectedLabelsKey = selectedLabels.join("\u0000");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selectedLabels);
  const [searchQuery, setSearchQuery] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setDraft(selectedLabels);
      setSearchQuery("");
      setCustomLabel("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedLabelsKey]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const optionItems = useMemo(() => {
    const seen = new Set<string>();
    const items = options.map((option) => {
      const value = labelValue(option);
      seen.add(value);
      return { value, label: option.name, color: option.color };
    });

    for (const label of draft) {
      if (!seen.has(label)) {
        items.push({ value: label, label, color: null });
        seen.add(label);
      }
    }

    return sortLabelPickerItems(items);
  }, [draft, options]);

  const filteredOptionItems = useMemo(
    () => optionItems.filter((item) => matchesPickerSearch(searchQuery, item.label, item.value)),
    [optionItems, searchQuery],
  );

  function toggle(value: string) {
    setDraft((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  function addCustomLabel() {
    const trimmed = customLabel.trim();
    if (!trimmed) return;
    setDraft((current) => (current.includes(trimmed) ? current : [...current, trimmed]));
    setCustomLabel("");
  }

  async function commit() {
    const next = canonicalizeDraftLabels([...draft], options);
    const current = canonicalizeDraftLabels(selectedLabels, options);
    const unchanged = next.length === current.length && next.every((label) => current.includes(label));
    if (unchanged) {
      setOpen(false);
      return;
    }
    const saved = await onSave(next);
    if (saved) setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled || saving}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "group w-full rounded-lg border border-transparent px-1 py-1 text-left transition-colors",
          "hover:border-border/60 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
          open && "border-border/60 bg-muted/20",
          disabled ? "cursor-default opacity-70" : "cursor-pointer",
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedLabels.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Tag className="h-3.5 w-3.5" />
              Add labels
            </span>
          ) : (
            selectedLabels.map((label) => {
              const displayName = resolveLabelDisplay(label, options);
              const hex = normalizeHexColor(resolveLabelColor(label, options));
              const symphony = isSymphonyLabelName(displayName) || isSymphonyLabelName(label);
              return (
                <span
                  key={label}
                  title={displayName}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                    symphony
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/60 bg-card text-foreground",
                  )}
                >
                  {hex ? (
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: hex }} aria-hidden="true" />
                  ) : (
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", labelDotClass(displayName))} />
                  )}
                  <span className="truncate">{displayName}</span>
                </span>
              );
            })
          )}
          {!disabled ? (
            <span className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border/70 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
              <Plus className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </div>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-xl border border-border/70 bg-popover p-3 shadow-lg">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Labels</div>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={searchQuery}
              placeholder="Search labels…"
              aria-label="Search labels"
              className="h-8 w-full rounded-md border border-border/70 bg-background pl-8 pr-2.5 text-xs outline-none ring-0 focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          {optionsLoading ? (
            <p className="text-xs text-muted-foreground">Loading labels…</p>
          ) : filteredOptionItems.length === 0 ? (
            <p className="mb-3 text-xs text-muted-foreground">
              {searchQuery.trim() ? "No labels match your search." : "Type a label name below to add one."}
            </p>
          ) : (
            <div className="mb-3 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
              {filteredOptionItems.map((item) => {
                const active = draft.includes(item.value);
                const hex = normalizeHexColor(item.color);
                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggle(item.value)}
                    style={hex ? { borderColor: hex } : undefined}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                      active
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "bg-background text-foreground hover:bg-muted",
                    )}
                  >
                    {hex ? (
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: hex }} aria-hidden="true" />
                    ) : (
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", labelDotClass(item.label))} aria-hidden="true" />
                    )}
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={customLabel}
              placeholder="New label"
              aria-label="New label"
              className="h-8 flex-1 rounded-md border border-border/70 bg-background px-2.5 text-xs outline-none ring-0 focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"
              onChange={(event) => setCustomLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustomLabel();
                }
              }}
            />
            <button
              type="button"
              onClick={addCustomLabel}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border/70 px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
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
