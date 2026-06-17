import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  type CredentialField,
  type CredentialProvider,
  clearCredential,
  fetchCredentials,
  updateCredential,
} from "@/services/settings";

export function ProviderCredentialsCard() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<CredentialProvider[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchCredentials()
      .then((result) => {
        if (!cancelled) setProviders(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function replaceProvider(updated: CredentialProvider) {
    setProviders((current) =>
      current ? current.map((p) => (p.provider === updated.provider ? updated : p)) : current,
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.credentials.title")}</CardTitle>
        <CardDescription>{t("settings.credentials.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loadError ? (
          <p className="text-xs text-muted-foreground">{t("settings.credentials.loadFailed")}</p>
        ) : !providers ? (
          <p className="text-xs text-muted-foreground">{t("settings.credentials.loading")}</p>
        ) : (
          providers.map((provider) => (
            <ProviderSection key={provider.provider} provider={provider} onUpdated={replaceProvider} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

interface ProviderSectionProps {
  provider: CredentialProvider;
  onUpdated: (updated: CredentialProvider) => void;
}

function ProviderSection({ provider, onUpdated }: ProviderSectionProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{provider.label}</p>
      <div className="space-y-3">
        {provider.fields.map((field) => (
          <CredentialFieldRow
            key={field.key}
            providerKey={provider.provider}
            field={field}
            onUpdated={onUpdated}
          />
        ))}
      </div>
    </div>
  );
}

interface CredentialFieldRowProps {
  providerKey: string;
  field: CredentialField;
  onUpdated: (updated: CredentialProvider) => void;
}

function CredentialFieldRow({ providerKey, field, onUpdated }: CredentialFieldRowProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(field.secret ? "" : (field.value ?? ""));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(field.secret ? "" : (field.value ?? ""));
  }, [field.secret, field.value]);

  const placeholder = useMemo(() => {
    if (!field.secret) return field.label;
    return field.configured && field.hint
      ? t("settings.credentials.placeholderReplace", { hint: field.hint })
      : t("settings.credentials.placeholderNotSet");
  }, [field, t]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await updateCredential(providerKey, field.key, draft.trim());
      onUpdated(updated);
      if (field.secret) setDraft("");
      toast.success(t("settings.credentials.toasts.saved", { label: field.label }));
    } catch {
      toast.error(t("settings.credentials.toasts.saveFailed", { label: field.label }));
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await clearCredential(providerKey, field.key);
      onUpdated(updated);
      setDraft("");
      toast.success(t("settings.credentials.toasts.cleared", { label: field.label }));
    } catch {
      toast.error(t("settings.credentials.toasts.clearFailed", { label: field.label }));
    } finally {
      setSaving(false);
    }
  }

  const saveDisabled = saving || (field.secret && draft.trim() === "");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-muted-foreground">{field.label}</label>
        <SourceBadge field={field} />
      </div>
      <div className="flex gap-2">
        <Input
          type={field.secret ? "password" : "text"}
          value={draft}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="button" size="sm" variant="secondary" disabled={saveDisabled} onClick={() => void save()}>
          {t("settings.credentials.save")}
        </Button>
        {field.source === "db" ? (
          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void clear()}>
            {t("settings.credentials.clear")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SourceBadge({ field }: { field: CredentialField }) {
  const { t } = useTranslation();

  if (field.source === "db") {
    return <Badge variant="secondary">{t("settings.credentials.source.savedHere")}</Badge>;
  }
  if (field.source === "env") {
    return <Badge variant="muted">{t("settings.credentials.source.fromEnv")}</Badge>;
  }
  return <Badge variant="outline">{t("settings.credentials.source.notSet")}</Badge>;
}
