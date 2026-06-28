import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createTelegramGroupPairingCode,
  getGatewaySettings,
  updateTelegramGatewaySettings,
  type GatewayPairingCode,
} from "@/services/gateways";
import { updateCredential } from "@/services/settings";
import type { TelegramGatewaySettings } from "@/types/gateways";

const emptySettings: TelegramGatewaySettings = {
  enabled: false,
  botUsername: null,
  botTokenConfigured: false,
  groupChatId: null,
  allowedUserIds: [],
  dmPolicy: "allowlist",
  dmAllowedUserIds: [],
  requireMention: true,
  pollingEnabled: false,
};

export function TelegramGatewaySettingsCard() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<TelegramGatewaySettings>(emptySettings);
  const [botToken, setBotToken] = useState("");
  const [allowedUserIds, setAllowedUserIds] = useState("");
  const [dmAllowedUserIds, setDmAllowedUserIds] = useState("");
  const [pairingCode, setPairingCode] = useState<GatewayPairingCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getGatewaySettings()
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded.telegram);
        setAllowedUserIds(loaded.telegram.allowedUserIds.join("\n"));
        setDmAllowedUserIds(loaded.telegram.dmAllowedUserIds.join("\n"));
      })
      .catch(() => {
        if (!cancelled) toast.error(t("settings.gateways.telegram.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function save() {
    setSaving(true);
    try {
      const updated = await updateTelegramGatewaySettings({
        enabled: settings.enabled,
        pollingEnabled: settings.pollingEnabled,
        groupChatId: settings.groupChatId,
        allowedUserIds: lines(allowedUserIds),
        dmAllowedUserIds: lines(dmAllowedUserIds),
        requireMention: settings.requireMention,
      });
      setSettings(updated.telegram);
      toast.success(t("settings.gateways.telegram.saved"));
    } catch {
      toast.error(t("settings.gateways.telegram.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function saveBotToken() {
    const trimmed = botToken.trim();
    if (!trimmed) return;

    setSaving(true);
    try {
      await updateCredential("telegram", "bot_token", trimmed);
      setBotToken("");
      setSettings((current) => ({ ...current, botTokenConfigured: true }));
      toast.success(t("settings.gateways.telegram.tokenSaved"));
    } catch {
      toast.error(t("settings.gateways.telegram.tokenSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function generatePairingCode() {
    const code = await createTelegramGroupPairingCode();
    setPairingCode(code);
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Telegram</CardTitle>
        <CardDescription>{t("settings.gateways.telegram.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))}
            aria-label="Enable Telegram gateway"
          />
          {t("settings.gateways.telegram.enabled")}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.pollingEnabled}
            onChange={(event) => setSettings((current) => ({ ...current, pollingEnabled: event.target.checked }))}
          />
          {t("settings.gateways.telegram.pollingEnabled")}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("settings.gateways.telegram.botToken")}
          <div className="flex gap-2">
            <Input
              type="password"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
              aria-label={t("settings.gateways.telegram.botToken")}
              placeholder={
                settings.botTokenConfigured
                  ? t("settings.gateways.telegram.tokenReplacePlaceholder")
                  : t("settings.gateways.telegram.tokenMissing")
              }
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="button" variant="secondary" onClick={() => void saveBotToken()} disabled={saving || botToken.trim() === ""}>
              {t("settings.gateways.telegram.saveToken")}
            </Button>
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("settings.gateways.telegram.groupChatId")}
          <Input
            value={settings.groupChatId ?? ""}
            onChange={(event) => setSettings((current) => ({ ...current, groupChatId: event.target.value }))}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("settings.gateways.telegram.allowedUserIds")}
          <Textarea value={allowedUserIds} onChange={(event) => setAllowedUserIds(event.target.value)} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("settings.gateways.telegram.dmAllowedUserIds")}
          <Textarea value={dmAllowedUserIds} onChange={(event) => setDmAllowedUserIds(event.target.value)} />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.requireMention}
            onChange={(event) => setSettings((current) => ({ ...current, requireMention: event.target.checked }))}
          />
          {t("settings.gateways.telegram.requireMention")}
        </label>

        <p className="text-xs text-muted-foreground">
          {settings.botTokenConfigured
            ? t("settings.gateways.telegram.tokenConfigured")
            : t("settings.gateways.telegram.tokenMissing")}
          {settings.botUsername ? ` · @${settings.botUsername}` : ""}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {t("settings.gateways.telegram.save")}
          </Button>
          <Button type="button" variant="outline" onClick={() => void generatePairingCode()}>
            {t("settings.gateways.telegram.generatePairing")}
          </Button>
        </div>

        {pairingCode ? <p className="rounded-md bg-muted px-3 py-2 font-mono text-sm">{pairingCode.command}</p> : null}
      </CardContent>
    </Card>
  );
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
