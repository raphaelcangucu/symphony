import { useTranslation } from "react-i18next";

import type { TrackerKind } from "@/types/project";

interface TrackerSourcePickerProps {
  value: TrackerKind;
  onChange: (kind: TrackerKind) => void;
}

const OPTION_KINDS: TrackerKind[] = ["local", "github", "linear", "jira"];

export function TrackerSourcePicker({ value, onChange }: TrackerSourcePickerProps) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label={t("project.tracker.source.aria")}>
      {OPTION_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          role="radio"
          aria-checked={value === kind}
          onClick={() => onChange(kind)}
          className={`rounded-md border p-3 text-left transition hover:bg-muted/50 ${
            value === kind ? "border-primary bg-muted/40" : ""
          }`}
        >
          <span className="block text-sm font-medium">{t(`project.tracker.source.${kind}.title`)}</span>
          <span className="block text-xs text-muted-foreground">{t(`project.tracker.source.${kind}.description`)}</span>
        </button>
      ))}
    </div>
  );
}
