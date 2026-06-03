import { useId } from "react";

import { Input } from "@/components/ui/input";

export interface ScalarDescriptor {
  key: string;
  label: string;
  kind: "string" | "number" | "boolean" | "enum";
  options?: string[];
  placeholder?: string;
  description?: string;
}

type ScalarValue = string | number | boolean | undefined;

interface ScalarFieldProps {
  descriptor: ScalarDescriptor;
  value: ScalarValue;
  onChange: (next: ScalarValue) => void;
}

export function ScalarField({ descriptor, value, onChange }: ScalarFieldProps) {
  const id = useId();

  if (descriptor.kind === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={descriptor.label}
        />
        {descriptor.label}
      </label>
    );
  }

  if (descriptor.kind === "enum") {
    return (
      <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
        <span className="font-medium">{descriptor.label}</span>
        <select
          id={id}
          aria-label={descriptor.label}
          className="h-9 rounded-md border bg-background px-2"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        >
          {(descriptor.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const isNumber = descriptor.kind === "number";
  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
      <span className="font-medium">{descriptor.label}</span>
      {descriptor.description ? <span className="text-xs text-muted-foreground">{descriptor.description}</span> : null}
      <Input
        id={id}
        aria-label={descriptor.label}
        type={isNumber ? "number" : "text"}
        min={isNumber ? 0 : undefined}
        placeholder={descriptor.placeholder}
        value={value === undefined ? "" : String(value)}
        onChange={(event) => {
          const raw = event.target.value;
          if (!isNumber) {
            onChange(raw);
            return;
          }
          if (raw.trim() === "") {
            onChange(undefined);
            return;
          }
          const parsed = Number.parseInt(raw, 10);
          onChange(Number.isInteger(parsed) ? parsed : undefined);
        }}
      />
    </label>
  );
}
