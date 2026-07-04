import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { LabOrchestrationCard } from "@/components/settings/LabOrchestrationCard";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { type LabSettings, fetchSettings } from "@/services/settings";

export function ExperimentalSettingsPage() {
  const { t } = useTranslation();
  const [lab, setLab] = useState<LabSettings | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchSettings()
      .then((settings) => {
        if (!cancelled) setLab(settings.lab);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t("settings.sections.experimental.label")}
        description={t("settings.experimental.pageDescription")}
      />

      <LabOrchestrationCard initial={lab} loadError={loadError} />
    </div>
  );
}
