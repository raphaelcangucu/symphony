import { useTranslation } from "react-i18next";

import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SettingsIcon } from "@/lib/settingsAgents";

interface SettingsPlaceholderPageProps {
  titleKey: string;
  descriptionKey: string;
  bodyKey: string;
  icon: SettingsIcon;
  statusKey?: string;
}

export function SettingsPlaceholderPage({
  titleKey,
  descriptionKey,
  bodyKey,
  icon: Icon,
  statusKey = "settings.placeholder.status.comingSoon",
}: SettingsPlaceholderPageProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <SettingsPageHeader title={t(titleKey)} description={t(descriptionKey)} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4" aria-hidden />
            {t(titleKey)}
          </CardTitle>
          <Badge variant="muted">{t(statusKey)}</Badge>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t(bodyKey)}</p>
        </CardContent>
      </Card>
    </div>
  );
}
