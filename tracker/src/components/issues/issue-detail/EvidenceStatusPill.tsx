import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

type EvidenceStatusKey = "passed" | "blocked" | "failed";

const STATUS_STYLES: Record<EvidenceStatusKey, string> = {
  passed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  blocked: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
};

function normalizeStatusKey(status: string): EvidenceStatusKey {
  const normalized = status.trim().toLowerCase();
  if (normalized in STATUS_STYLES) return normalized as EvidenceStatusKey;
  if (normalized.includes("pass")) return "passed";
  if (normalized.includes("block")) return "blocked";
  return "failed";
}

export function EvidenceStatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  const statusKey = normalizeStatusKey(status);
  const style = STATUS_STYLES[statusKey];
  const label = t(`issue.evidence.status.${statusKey}`);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        style,
      )}
    >
      {label}
    </span>
  );
}
