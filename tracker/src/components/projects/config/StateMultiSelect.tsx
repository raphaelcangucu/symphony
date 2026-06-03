interface StateMultiSelectProps {
  label: string;
  description?: string;
  available: string[];
  value: string[];
  onChange: (next: string[]) => void;
}

export function StateMultiSelect({ label, description, available, value, onChange }: StateMultiSelectProps) {
  const selected = new Set(value);

  function toggle(state: string) {
    const next = selected.has(state) ? value.filter((item) => item !== state) : [...value, state];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {available.length === 0 ? (
        <p className="text-xs text-muted-foreground">No statuses defined for this project yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {available.map((state) => {
            const isSelected = selected.has(state);
            return (
              <button
                key={state}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggle(state)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  isSelected ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {state}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
