import type { TrackerKind } from "@/types/project";

interface TrackerSourcePickerProps {
  value: TrackerKind;
  onChange: (kind: TrackerKind) => void;
}

const OPTIONS: { kind: TrackerKind; title: string; description: string }[] = [
  { kind: "local", title: "Symphony local tracker", description: "Issues live in Symphony's local board (default)." },
  { kind: "github", title: "GitHub Project v2", description: "Read and move issues on a connected GitHub board." },
  { kind: "linear", title: "Linear project", description: "Read and move issues from a connected Linear board." },
  { kind: "jira", title: "Jira project", description: "Read and move issues from a connected Jira board." },
];

export function TrackerSourcePicker({ value, onChange }: TrackerSourcePickerProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Tracker source">
      {OPTIONS.map((option) => (
        <button
          key={option.kind}
          type="button"
          role="radio"
          aria-checked={value === option.kind}
          onClick={() => onChange(option.kind)}
          className={`rounded-md border p-3 text-left transition hover:bg-muted/50 ${
            value === option.kind ? "border-primary bg-muted/40" : ""
          }`}
        >
          <span className="block text-sm font-medium">{option.title}</span>
          <span className="block text-xs text-muted-foreground">{option.description}</span>
        </button>
      ))}
    </div>
  );
}
