import { useTranslation } from "react-i18next";

import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/lib/statusPresentation";

type EvidenceStatusKey = "passed" | "blocked" | "failed";

const STATUS_TONES: Record<EvidenceStatusKey, StatusTone> = {
  passed: "success",
  blocked: "warning",
  failed: "destructive",
};

function normalizeStatusKey(status: string): EvidenceStatusKey {
  const normalized = status.trim().toLowerCase();
  if (normalized in STATUS_TONES) return normalized as EvidenceStatusKey;
  if (normalized.includes("pass")) return "passed";
  if (normalized.includes("block")) return "blocked";
  return "failed";
}

export function EvidenceStatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  const statusKey = normalizeStatusKey(status);

  return (
    <StatusPill tone={STATUS_TONES[statusKey]} className="font-semibold">
      {t(`issue.evidence.status.${statusKey}`)}
    </StatusPill>
  );
}
