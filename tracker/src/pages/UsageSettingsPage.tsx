import { useTranslation } from "react-i18next";

import { AgentUsagePanel } from "@/components/settings/AgentUsagePanel";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";

export function UsageSettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t("settings.sections.usage.label")}
        description={t("settings.usage.pageDescription")}
      />

      <AgentUsagePanel />
    </div>
  );
}
