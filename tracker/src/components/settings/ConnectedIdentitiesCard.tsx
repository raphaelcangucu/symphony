import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type IdentityStatus, fetchIdentities } from "@/services/settings";

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  jira: "Jira",
  linear: "Linear",
};

export function ConnectedIdentitiesCard() {
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
        <CardTitle>Connected identities</CardTitle>
        <CardDescription>
          Who Symphony authenticates as on each provider. The orchestrator&apos;s &quot;assigned to
          me&quot; rule matches against these identities.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadError ? (
          <p className="text-xs text-muted-foreground">Failed to load identities — refresh to retry.</p>
        ) : !identities ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
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
  const label = PROVIDER_LABELS[status.provider] ?? status.provider;

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border/60 px-3 py-2">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{describe(status)}</p>
      </div>
      <StatusBadge status={status} />
    </div>
  );
}

function StatusBadge({ status }: { status: IdentityStatus }) {
  if (!status.configured) {
    return <Badge variant="outline">Not configured</Badge>;
  }
  if (status.connected) {
    return <Badge variant="secondary">Connected</Badge>;
  }
  return <Badge variant="destructive">Error</Badge>;
}

function describe(status: IdentityStatus): string {
  if (!status.configured) {
    return "Add a token below to connect this provider.";
  }
  if (status.connected && status.identity) {
    const { name, login, email } = status.identity;
    return [name ?? login, email].filter(Boolean).join(" · ") || "Connected";
  }
  return status.error ? `Could not verify: ${status.error}` : "Could not verify the token.";
}
