import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { type OrchestratorSettings, updateOrchestratorSettings } from "@/services/settings";

interface OrchestrationRulesCardProps {
  initial: OrchestratorSettings | null;
  loadError: boolean;
}

type BooleanRuleKey = "require_symphony_label" | "require_assignee_match";

interface RuleDescriptor {
  key: BooleanRuleKey;
  title: string;
  description: string;
}

export function OrchestrationRulesCard({ initial, loadError }: OrchestrationRulesCardProps) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<OrchestratorSettings | null>(initial);
  const [budgetDraft, setBudgetDraft] = useState("");
  const [savingKey, setSavingKey] = useState<BooleanRuleKey | "agent_token_budget_enabled" | "agent_token_budget" | null>(
    null,
  );

  const ruleDescriptors = useMemo<RuleDescriptor[]>(
    () => [
      {
        key: "require_symphony_label",
        title: t("settings.orchestration.rules.requireSymphonyLabel.title"),
        description: t("settings.orchestration.rules.requireSymphonyLabel.description"),
      },
      {
        key: "require_assignee_match",
        title: t("settings.orchestration.rules.requireAssigneeMatch.title"),
        description: t("settings.orchestration.rules.requireAssigneeMatch.description"),
      },
    ],
    [t],
  );

  useEffect(() => {
    setRules(initial);
    setBudgetDraft(initial ? String(initial.agent_token_budget) : "");
  }, [initial]);

  async function toggleBoolean(key: BooleanRuleKey) {
    if (!rules || savingKey) return;
    const next = !rules[key];
    setSavingKey(key);
    setRules({ ...rules, [key]: next });
    try {
      const updated = await updateOrchestratorSettings({ [key]: next });
      setRules(updated);
      setBudgetDraft(String(updated.agent_token_budget));
    } catch {
      setRules((current) => (current ? { ...current, [key]: !next } : current));
      toast.error(t("settings.orchestration.saveFailed"));
    } finally {
      setSavingKey(null);
    }
  }

  async function toggleTokenBudgetEnabled() {
    if (!rules || savingKey) return;
    const next = !rules.agent_token_budget_enabled;
    setSavingKey("agent_token_budget_enabled");
    setRules({ ...rules, agent_token_budget_enabled: next });
    try {
      const updated = await updateOrchestratorSettings({ agent_token_budget_enabled: next });
      setRules(updated);
      setBudgetDraft(String(updated.agent_token_budget));
    } catch {
      setRules((current) =>
        current ? { ...current, agent_token_budget_enabled: !next } : current,
      );
      toast.error(t("settings.orchestration.saveFailed"));
    } finally {
      setSavingKey(null);
    }
  }

  async function saveTokenBudget() {
    if (!rules || savingKey || !rules.agent_token_budget_enabled) return;

    const parsed = Number.parseInt(budgetDraft.replace(/\D/g, ""), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      toast.error(t("settings.orchestration.tokenBudget.invalid"));
      setBudgetDraft(String(rules.agent_token_budget));
      return;
    }

    if (parsed === rules.agent_token_budget) return;

    setSavingKey("agent_token_budget");
    setRules({ ...rules, agent_token_budget: parsed });
    try {
      const updated = await updateOrchestratorSettings({ agent_token_budget: parsed });
      setRules(updated);
      setBudgetDraft(String(updated.agent_token_budget));
    } catch {
      setRules((current) => (current ? { ...current, agent_token_budget: rules.agent_token_budget } : current));
      setBudgetDraft(String(rules.agent_token_budget));
      toast.error(t("settings.orchestration.saveFailed"));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.orchestration.title")}</CardTitle>
        <CardDescription>{t("settings.orchestration.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loadError ? (
          <p className="text-xs text-muted-foreground">{t("settings.orchestration.loadFailed")}</p>
        ) : !rules ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <>
            <div className="space-y-4">
              {ruleDescriptors.map((rule) => (
                <div key={rule.key} className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{rule.title}</p>
                    <p className="text-xs text-muted-foreground">{rule.description}</p>
                  </div>
                  <Switch
                    checked={rules[rule.key]}
                    disabled={savingKey !== null}
                    onClick={() => void toggleBoolean(rule.key)}
                    label={rule.title}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-3 border-t pt-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{t("settings.orchestration.tokenBudget.title")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.orchestration.tokenBudget.description")}
                  </p>
                </div>
                <Switch
                  checked={rules.agent_token_budget_enabled}
                  disabled={savingKey !== null}
                  onClick={() => void toggleTokenBudgetEnabled()}
                  label={t("settings.orchestration.tokenBudget.title")}
                />
              </div>

              {rules.agent_token_budget_enabled ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="text-xs text-muted-foreground sm:w-40" htmlFor="agent-token-budget">
                    {t("settings.orchestration.tokenBudget.amountLabel")}
                  </label>
                  <Input
                    id="agent-token-budget"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="max-w-xs"
                    value={budgetDraft}
                    disabled={savingKey !== null}
                    onChange={(event) => setBudgetDraft(event.target.value)}
                    onBlur={() => void saveTokenBudget()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveTokenBudget();
                      }
                    }}
                  />
                </div>
              ) : null}
            </div>
          </>
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
