import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ValueKind = "state" | "number";

interface KeyValueMapEditorProps {
  label: string;
  description?: string;
  keyOptions: string[];
  valueKind: ValueKind;
  valueOptions?: string[];
  value: Record<string, string | number>;
  onChange: (next: Record<string, string | number>) => void;
}

export function KeyValueMapEditor({
  label,
  description,
  keyOptions,
  valueKind,
  valueOptions = [],
  value,
  onChange,
}: KeyValueMapEditorProps) {
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const usedKeys = new Set(Object.keys(value));
  const availableKeys = keyOptions.filter((key) => !usedKeys.has(key));

  function remove(key: string) {
    const next = { ...value };
    delete next[key];
    onChange(next);
  }

  function add() {
    if (!draftKey) return;
    if (valueKind === "number") {
      const parsed = Number.parseInt(draftValue, 10);
      if (!Number.isInteger(parsed) || parsed < 1) return;
      onChange({ ...value, [draftKey]: parsed });
    } else {
      if (!draftValue) return;
      onChange({ ...value, [draftKey]: draftValue });
    }
    setDraftKey("");
    setDraftValue("");
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}

      <div className="space-y-1">
        {Object.entries(value).map(([key, entryValue]) => (
          <div key={key} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
            <span className="font-medium">{key}</span>
            <span className="text-muted-foreground">&rarr; {String(entryValue)}</span>
            <button
              type="button"
              aria-label={`remove ${key}`}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              onClick={() => remove(key)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span>Add key</span>
          <select
            aria-label="add key"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
          >
            <option value="">Select state&hellip;</option>
            {availableKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>

        {valueKind === "state" ? (
          <label className="flex flex-col gap-1 text-xs">
            <span>New value</span>
            <select
              aria-label="new value"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
            >
              <option value="">Select state&hellip;</option>
              {valueOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs">
            <span>New value</span>
            <Input
              aria-label="new value"
              type="number"
              min={1}
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              className="h-9 w-24"
            />
          </label>
        )}

        <Button type="button" variant="secondary" size="sm" onClick={add}>
          Add entry
        </Button>
      </div>
    </div>
  );
}
