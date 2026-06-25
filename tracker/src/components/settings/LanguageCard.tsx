import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveLocale, type LocalePreference } from "@/i18n/detectLocale";
import { initI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { updateUiSettings } from "@/services/settings";

const OPTIONS: LocalePreference[] = ["auto", "en", "pt-BR"];

interface LanguageCardProps {
  initial: LocalePreference | null;
  loadError: boolean;
  onLocaleChange?: (preference: LocalePreference) => void;
}

export function LanguageCard({ initial, loadError, onLocaleChange }: LanguageCardProps) {
  const { t } = useTranslation();
  const [locale, setLocale] = useState<LocalePreference | null>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocale(initial);
  }, [initial]);

  async function selectLocale(next: LocalePreference) {
    if (saving || next === locale || locale === null) return;
    setSaving(true);
    const previous = locale;
    setLocale(next);
    try {
      await updateUiSettings({ locale: next });
      await initI18n(resolveLocale(next));
      onLocaleChange?.(next);
      toast.success(t("settings.language.saved"));
    } catch {
      setLocale(previous);
      toast.error(t("settings.language.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function labelFor(option: LocalePreference): string {
    return t(`settings.language.${option}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.language.title")}</CardTitle>
        <CardDescription>{t("settings.language.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loadError ? (
          <p className="text-xs text-muted-foreground">{t("settings.language.loadFailed")}</p>
        ) : locale === null ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                disabled={saving}
                onClick={() => void selectLocale(option)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  locale === option
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border/70 bg-background/60 text-muted-foreground hover:text-foreground",
                )}
              >
                {labelFor(option)}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
