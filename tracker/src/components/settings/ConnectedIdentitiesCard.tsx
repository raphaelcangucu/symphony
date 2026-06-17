import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type IdentityStatus, fetchIdentities } from "@/services/settings";

export function ConnectedIdentitiesCard() {
  const { t } = useTranslation();
  const [identities, setIdentities] = useState<IdentityStatus[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchIdentities()
      .then((result) => {
        if (!cancelled) setIdentities(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.identities.title")}</CardTitle>
        <CardDescription>{t("settings.identities.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadError ? (
          <p className="text-xs text-muted-foreground">{t("settings.identities.loadFailed")}</p>
        ) : !identities ? (
          <p className="text-xs text-muted-foreground">{t("settings.identities.loading")}</p>
        ) : (
          identities.map((status) => (
            <IdentityRow key={status.provider} status={status} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function IdentityRow({ status }: { status: IdentityStatus }) {
  const { t } = useTranslation();
  const label =
    t(`settings.identities.providers.${status.provider}`, { defaultValue: status.provider }) ?? status.provider;

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border/60 px-3 py-2">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{describeIdentity(status, t)}</p>
      </div>
      <StatusBadge status={status} />
    </div>
  );
}

function StatusBadge({ status }: { status: IdentityStatus }) {
  const { t } = useTranslation();

  if (!status.configured) {
    return <Badge variant="outline">{t("settings.identities.status.notConfigured")}</Badge>;
  }
  if (status.connected) {
    return <Badge variant="secondary">{t("settings.identities.status.connected")}</Badge>;
  }
  return <Badge variant="destructive">{t("settings.identities.status.error")}</Badge>;
}

function describeIdentity(status: IdentityStatus, t: TFunction): string {
  if (!status.configured) {
    return t("settings.identities.describe.addToken");
  }
  if (status.connected && status.identity) {
    const { name, login, email } = status.identity;
    return [name ?? login, email].filter(Boolean).join(" · ") || t("settings.identities.describe.connected");
  }
  return status.error
    ? t("settings.identities.describe.verifyFailed", { error: status.error })
    : t("settings.identities.describe.verifyTokenFailed");
}
