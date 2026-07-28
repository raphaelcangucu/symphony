import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createAgentAccount,
  deleteAgentAccount,
  setDefaultAgentAccount,
  type AgentAccount,
} from "@/services/settings";
import type { AgentKind } from "@/types/issue";

interface AgentAccountsCardProps {
  agent: AgentKind;
  initialAccounts: AgentAccount[];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function AgentAccountsCard({ agent, initialAccounts }: AgentAccountsCardProps) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function makeDefault(account: AgentAccount) {
    if (saving || account.default) return;
    setSaving(true);
    setError(null);
    try {
      await setDefaultAgentAccount(agent, account.id);
      setAccounts((current) =>
        current.map((entry) => ({ ...entry, default: entry.id === account.id })),
      );
    } catch (reason) {
      setError(errorMessage(reason, t("settings.agentTool.accounts.actionFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function addAccount() {
    if (saving || !id.trim() || !label.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createAgentAccount(agent, {
        id: id.trim(),
        label: label.trim(),
        authentication_status: "unauthenticated",
      });
      setAccounts((current) => [...current, created]);
      setId("");
      setLabel("");
    } catch (reason) {
      setError(errorMessage(reason, t("settings.agentTool.accounts.actionFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function removeAccount(account: AgentAccount) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await deleteAgentAccount(agent, account.id);
      setAccounts((current) => current.filter((entry) => entry.id !== account.id));
    } catch (reason) {
      setError(errorMessage(reason, t("settings.agentTool.accounts.actionFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.agentTool.accounts.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("settings.agentTool.accounts.empty")}
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{account.label}</span>
                    {account.default ? (
                      <Badge variant="secondary">{t("settings.agentTool.accounts.default")}</Badge>
                    ) : null}
                    <Badge variant="outline">
                      {t(`settings.agentTool.accounts.status.${account.authentication_status}`)}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{account.id}</span>
                    {account.usage?.plan ? <span>{account.usage.plan}</span> : null}
                    {account.usage?.stale ? (
                      <span className="font-medium text-amber-600 dark:text-amber-400">
                        {t("settings.agentTool.accounts.stale")}
                      </span>
                    ) : null}
                    {account.usage?.windows[0]?.used_percent != null ? (
                      <span>
                        {t("settings.agentTool.accounts.used", {
                          percent: account.usage.windows[0].used_percent,
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!account.default ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={saving || account.authentication_status !== "authenticated"}
                      aria-label={t("settings.agentTool.accounts.useDefaultLabel", {
                        name: account.label,
                      })}
                      onClick={() => void makeDefault(account)}
                    >
                      {t("settings.agentTool.accounts.useDefault")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={saving}
                    aria-label={t("settings.agentTool.accounts.deleteLabel", {
                      name: account.label,
                    })}
                    onClick={() => void removeAccount(account)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-2 border-t pt-4 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            aria-label={t("settings.agentTool.accounts.id")}
            placeholder={t("settings.agentTool.accounts.id")}
            value={id}
            disabled={saving}
            onChange={(event) => setId(event.target.value)}
          />
          <Input
            aria-label={t("settings.agentTool.accounts.label")}
            placeholder={t("settings.agentTool.accounts.label")}
            value={label}
            disabled={saving}
            onChange={(event) => setLabel(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            className="h-10"
            disabled={saving || !id.trim() || !label.trim()}
            onClick={() => void addAccount()}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.agentTool.accounts.add")}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("settings.agentTool.accounts.credentialsHelp")}
        </p>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
