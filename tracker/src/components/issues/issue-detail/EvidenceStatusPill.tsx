import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  passed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  blocked: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export function EvidenceStatusPill({ status }: { status: string }) {
  const normalized = status.trim().toLowerCase();
  const style =
    STATUS_STYLES[normalized] ??
    (normalized.includes("pass")
      ? STATUS_STYLES.passed
      : normalized.includes("block")
        ? STATUS_STYLES.blocked
        : STATUS_STYLES.failed);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
        style,
      )}
    >
      {status}
    </span>
  );
}
