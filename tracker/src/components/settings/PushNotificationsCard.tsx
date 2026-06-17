import { Bell, BellOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePushNotifications } from "@/hooks/usePushNotifications";

export function PushNotificationsCard() {
  const { t } = useTranslation();
  const { supported, config, subscribed, loading, busy, error, enable, disable, sendTest } =
    usePushNotifications();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {subscribed ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          {t("settings.push.title")}
        </CardTitle>
        <CardDescription>{t("settings.push.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported ? (
          <p className="text-xs text-muted-foreground">{t("settings.push.unsupported")}</p>
        ) : loading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : !config?.enabled ? (
          <p className="text-xs text-muted-foreground">{t("settings.push.notConfigured")}</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {subscribed ? t("settings.push.enabled") : t("settings.push.prompt")}
            </p>
            <div className="flex flex-wrap gap-2">
              {subscribed ? (
                <>
                  <Button variant="outline" disabled={busy} onClick={() => void disable()}>
                    {t("settings.push.disable")}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void sendTest()}>
                    {t("settings.push.sendTest")}
                  </Button>
                </>
              ) : (
                <Button disabled={busy} onClick={() => void enable()}>
                  {t("settings.push.enable")}
                </Button>
              )}
            </div>
          </>
        )}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
