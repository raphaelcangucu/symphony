import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type LabSettings, updateLabSettings } from "@/services/settings";

interface LabOrchestrationCardProps {
  initial: LabSettings | null;
  loadError: boolean;
}

type RuleKey = keyof LabSettings;

interface RuleDescriptor {
  key: RuleKey;
  title: string;
  description: string;
}

export function LabOrchestrationCard({ initial, loadError }: LabOrchestrationCardProps) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<LabSettings | null>(initial);
  const [savingKey, setSavingKey] = useState<RuleKey | null>(null);

  const ruleDescriptors = useMemo<RuleDescriptor[]>(
    () => [
      {
        key: "bundle_child_orchestration",
        title: t("settings.lab.bundleChildOrchestration.title"),
        description: t("settings.lab.bundleChildOrchestration.description"),
      },
    ],
    [t],
  );

  useEffect(() => {
    setRules(initial);
  }, [initial]);

  async function toggle(key: RuleKey) {
    if (!rules || savingKey) return;
    const next = !rules[key];
    setSavingKey(key);
    setRules({ ...rules, [key]: next });
    try {
      const updated = await updateLabSettings({ [key]: next });
      setRules(updated);
    } catch {
      setRules((current) => (current ? { ...current, [key]: !next } : current));
      toast.error(t("settings.lab.saveFailed"));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.lab.title")}</CardTitle>
        <CardDescription>{t("settings.lab.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError ? (
          <p className="text-xs text-muted-foreground">{t("settings.lab.loadFailed")}</p>
        ) : !rules ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : (
          ruleDescriptors.map((rule) => (
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
