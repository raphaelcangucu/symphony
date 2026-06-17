import { OctagonAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

const BLOCKED_LABEL = "symphony:blocked";

interface BlockedBannerProps {
  labels: string[] | undefined;
}

export function BlockedBanner({ labels }: BlockedBannerProps) {
  const { t } = useTranslation();

  if (!labels?.includes(BLOCKED_LABEL)) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">{t("issue.blockedBanner.title")}</p>
        <p className="mt-0.5">{t("issue.blockedBanner.body")}</p>
      </div>
    </div>
  );
}
