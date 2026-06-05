import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AGENT_ICONS, AgentChip } from "@/components/shared/AgentChip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type AgentAvailability,
  fetchAgentAvailability,
  fetchSettings,
  updateAgentSettings,
} from "@/services/settings";
import type { AgentKind } from "@/types/issue";

const AGENT_LABELS: Record<AgentKind, string> = { codex: "Codex", claude: "Claude Code" };

export function SettingsPage() {
  const [defaultAgent, setDefaultAgent] = useState<AgentKind | null>(null);
  const [availability, setAvailability] = useState<AgentAvailability | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [availabilityError, setAvailabilityError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchSettings()
      .then((settings) => {
        if (!cancelled) setDefaultAgent(settings.agents.default_agent_kind);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    void fetchAgentAvailability()
      .then((result) => {
        if (!cancelled) setAvailability(result);
      })
      .catch(() => {
        if (!cancelled) setAvailabilityError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function selectAgent(kind: AgentKind) {
    if (saving || kind === defaultAgent) return;
    setSaving(true);
    const previous = defaultAgent;
    setDefaultAgent(kind);
    try {
      await updateAgentSettings({ default_agent_kind: kind });
      toast.success(`Default coding agent set to ${AGENT_LABELS[kind]}`);
    } catch {
      setDefaultAgent(previous);
      toast.error("Failed to save the default coding agent");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Operator-level defaults for this Symphony instance.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coding agent</CardTitle>
          <CardDescription>
            Default agent for new work. Projects and tasks can override it (task &gt; project &gt; this default).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadError ? (
            <p className="text-xs text-muted-foreground">Failed to load settings — refresh to retry.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {defaultAgent === null && (
                <p className="text-xs text-muted-foreground">Loading…</p>
              )}
              {(Object.keys(AGENT_LABELS) as AgentKind[]).map((kind) => {
                const Icon = AGENT_ICONS[kind];
                return (
                  <AgentChip
                    key={kind}
                    label={AGENT_LABELS[kind]}
                    icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined}
                    active={defaultAgent === kind}
                    disabled={saving || defaultAgent === null}
                    onClick={() => void selectAgent(kind)}
                  />
                );
              })}
            </div>
          )}

          {availabilityError ? (
            <p className="text-xs text-muted-foreground">Could not check agent availability.</p>
          ) : availability ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {(Object.keys(AGENT_LABELS) as AgentKind[]).map((kind) => {
                const entry = availability[kind];
                return (
                  <li key={kind}>
                    {entry.available
                      ? `✓ ${entry.version ?? entry.command}`
                      : `✗ ${entry.command} not found — install it or pick the other agent`}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
