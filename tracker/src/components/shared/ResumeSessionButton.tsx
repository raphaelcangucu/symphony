import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SessionRowActionButton } from "@/components/shared/SessionRowActionButton";

interface ResumeSessionButtonProps {
  onResume: () => void;
  pending?: boolean;
  className?: string;
}

/**
 * Resume control for a stopped/aborted session row. Mirrors ArchiveChatButton's
 * ghost icon styling so resume and archive read as the same family of row
 * actions across the session and assistant screens.
 */
export function ResumeSessionButton({ onResume, pending = false, className }: ResumeSessionButtonProps) {
  const { t } = useTranslation();
  const label = pending ? t("sessions.resuming") : t("sessions.resume");

  return (
    <SessionRowActionButton label={label} onClick={onResume} disabled={pending} className={className}>
      <Play className="h-3 w-3" strokeWidth={1.5} />
    </SessionRowActionButton>
  );
}
