import { useEffect, useMemo, useState } from "react";
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
        <CardTitle>Provider tokens</CardTitle>
        <CardDescription>
          Tokens saved here are encrypted at rest and override the matching environment variable.
          Leave a secret blank to keep the current value, or clear it to fall back to the environment.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loadError ? (
          <p className="text-xs text-muted-foreground">Failed to load credentials — refresh to retry.</p>
        ) : !providers ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
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
  const [draft, setDraft] = useState(field.secret ? "" : (field.value ?? ""));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(field.secret ? "" : (field.value ?? ""));
  }, [field.secret, field.value]);

  const placeholder = useMemo(() => {
    if (!field.secret) return field.label;
    return field.configured && field.hint ? `${field.hint} — enter a new value to replace` : "Not set";
  }, [field]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await updateCredential(providerKey, field.key, draft.trim());
      onUpdated(updated);
      if (field.secret) setDraft("");
      toast.success(`${field.label} saved`);
    } catch {
      toast.error(`Failed to save ${field.label}`);
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
      toast.success(`${field.label} cleared`);
    } catch {
      toast.error(`Failed to clear ${field.label}`);
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
          Save
        </Button>
        {field.source === "db" ? (
          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void clear()}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SourceBadge({ field }: { field: CredentialField }) {
  if (field.source === "db") {
    return <Badge variant="secondary">Saved here</Badge>;
  }
  if (field.source === "env") {
    return <Badge variant="muted">From environment</Badge>;
  }
  return <Badge variant="outline">Not set</Badge>;
}
