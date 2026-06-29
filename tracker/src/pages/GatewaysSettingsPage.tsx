import { useTranslation } from "react-i18next";

import { TelegramGatewaySettingsCard } from "@/components/settings/TelegramGatewaySettingsCard";

export function GatewaysSettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("settings.sections.gateways.label")}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">{t("settings.gateways.subtitle")}</p>
      </div>
      <TelegramGatewaySettingsCard />
    </div>
  );
}
