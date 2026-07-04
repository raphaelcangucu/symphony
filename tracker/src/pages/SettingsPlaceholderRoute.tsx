import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { SettingsPlaceholderPage } from "@/pages/SettingsPlaceholderPage";
import { findPlaceholder } from "@/lib/settingsPlaceholders";

interface SettingsPlaceholderRouteProps {
  section?: string;
}

export function SettingsPlaceholderRoute({ section }: SettingsPlaceholderRouteProps) {
  const { t } = useTranslation();
  const { tool } = useParams();
  const key = section ?? tool ?? "";
  const descriptor = findPlaceholder(key);

  if (!descriptor) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {t("settings.placeholder.unknown.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("settings.placeholder.unknown.description")}</p>
      </div>
    );
  }

  return (
    <SettingsPlaceholderPage
      titleKey={descriptor.titleKey}
      descriptionKey={descriptor.descriptionKey}
      bodyKey={descriptor.bodyKey}
      icon={descriptor.icon}
      statusKey={descriptor.statusKey}
    />
  );
}
