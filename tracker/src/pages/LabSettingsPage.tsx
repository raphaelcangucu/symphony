import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { LabOrchestrationCard } from "@/components/settings/LabOrchestrationCard";
import { type LabSettings, fetchSettings } from "@/services/settings";

export function LabSettingsPage() {
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
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("settings.sections.lab.label")}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">{t("settings.lab.pageDescription")}</p>
      </div>

      <LabOrchestrationCard initial={lab} loadError={loadError} />
    </div>
  );
}
