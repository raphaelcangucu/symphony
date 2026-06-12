import { Bell, BellOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePushNotifications } from "@/hooks/usePushNotifications";

export function PushNotificationsCard() {
  const { supported, config, subscribed, loading, busy, error, enable, disable } = usePushNotifications();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {subscribed ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          Browser notifications
        </CardTitle>
        <CardDescription>
          Get notified when an issue needs human review or when validation evidence is generated — even
          when this tab is in the background.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported ? (
          <p className="text-xs text-muted-foreground">Web Push is not supported in this browser.</p>
        ) : loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : !config?.enabled ? (
          <p className="text-xs text-muted-foreground">
            Push is not configured on the server. Set{" "}
            <code className="rounded bg-muted px-1 py-0.5">SYMPHONY_VAPID_PUBLIC_KEY</code> and{" "}
            <code className="rounded bg-muted px-1 py-0.5">SYMPHONY_VAPID_PRIVATE_KEY</code>, then restart
            Symphony.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {subscribed
                ? "Notifications are enabled for this browser."
                : "Enable notifications to receive Human Review and evidence alerts."}
            </p>
            <div className="flex flex-wrap gap-2">
              {subscribed ? (
                <Button variant="outline" disabled={busy} onClick={() => void disable()}>
                  Disable notifications
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => void enable()}>
                  Enable notifications
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
