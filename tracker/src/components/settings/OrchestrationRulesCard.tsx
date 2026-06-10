import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type OrchestratorSettings, updateOrchestratorSettings } from "@/services/settings";

interface OrchestrationRulesCardProps {
  initial: OrchestratorSettings | null;
  loadError: boolean;
}

type RuleKey = keyof OrchestratorSettings;

interface RuleDescriptor {
  key: RuleKey;
  title: string;
  description: string;
}

const RULES: RuleDescriptor[] = [
  {
    key: "require_symphony_label",
    title: "Require a Symphony label",
    description:
      "Only auto-start issues tagged symphony, symphony:codex, or symphony:claude. Manual dispatch from the board is never affected.",
  },
  {
    key: "require_assignee_match",
    title: "Require assignment to me",
    description:
      "Only auto-start issues assigned to the connected provider identity (GitHub login, Jira account, or Linear user).",
  },
];

export function OrchestrationRulesCard({ initial, loadError }: OrchestrationRulesCardProps) {
  const [rules, setRules] = useState<OrchestratorSettings | null>(initial);
  const [savingKey, setSavingKey] = useState<RuleKey | null>(null);

  useEffect(() => {
    setRules(initial);
  }, [initial]);

  async function toggle(key: RuleKey) {
    if (!rules || savingKey) return;
    const next = !rules[key];
    setSavingKey(key);
    setRules({ ...rules, [key]: next });
    try {
      const updated = await updateOrchestratorSettings({ [key]: next });
      setRules(updated);
    } catch {
      setRules((current) => (current ? { ...current, [key]: !next } : current));
      toast.error("Failed to save orchestration rule");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orchestration rules</CardTitle>
        <CardDescription>
          What the orchestrator is allowed to start on its own. Defaults are conservative so it never
          grabs unlabeled or unassigned work.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError ? (
          <p className="text-xs text-muted-foreground">Failed to load rules — refresh to retry.</p>
        ) : !rules ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          RULES.map((rule) => (
            <div key={rule.key} className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{rule.title}</p>
                <p className="text-xs text-muted-foreground">{rule.description}</p>
              </div>
              <Switch
                checked={rules[rule.key]}
                disabled={savingKey !== null}
                onClick={() => void toggle(rule.key)}
                label={rule.title}
              />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}

function Switch({ checked, disabled, label, onClick }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
