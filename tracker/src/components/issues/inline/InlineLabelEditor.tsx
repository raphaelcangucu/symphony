import { Check, Plus, Tag, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { labelDotClass } from "@/components/board/label-colors";
import { cn } from "@/lib/utils";
import { userVisibleLabels } from "@/lib/symphonyLabels";
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
  const visibleLabels = useMemo(() => userVisibleLabels(labels), [labels]);
  // Stable value-key so the sync effect below only runs when the labels' content
  // changes — depending on `visibleLabels` (a fresh array each render) would make
  // the effect call setDraft on every render and loop infinitely.
  const visibleLabelsKey = visibleLabels.join("\u0000");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(visibleLabels);
  const [customLabel, setCustomLabel] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setDraft(visibleLabels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, visibleLabelsKey]);

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

    return items;
  }, [draft, options]);

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
    const next = [...draft];
    const unchanged =
      next.length === visibleLabels.length && next.every((label) => visibleLabels.includes(label));
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
          {visibleLabels.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Tag className="h-3.5 w-3.5" />
              Add labels
            </span>
          ) : (
            visibleLabels.map((label) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-0.5 text-xs font-medium text-foreground"
              >
                <span className={cn("h-2 w-2 rounded-full", labelDotClass(label))} />
                {label}
              </span>
            ))
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
          {optionsLoading ? (
            <p className="text-xs text-muted-foreground">Loading labels…</p>
          ) : optionItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">Type a label name below to add one.</p>
          ) : (
            <div className="mb-3 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
              {optionItems.map((item) => {
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
