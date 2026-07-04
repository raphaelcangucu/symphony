import { useTranslation } from "react-i18next";

import { ConnectedIdentitiesCard } from "@/components/settings/ConnectedIdentitiesCard";
import { ProviderCredentialsCard } from "@/components/settings/ProviderCredentialsCard";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";

export function ProvidersSettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t("settings.sections.providers.label")}
        description={t("settings.providers.subtitle")}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <ConnectedIdentitiesCard />
        <ProviderCredentialsCard />
      </div>
    </div>
  );
}
