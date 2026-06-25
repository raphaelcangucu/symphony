import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { I18nextProvider } from "react-i18next";

import { resolveLocale, type LocalePreference } from "@/i18n/detectLocale";
import { fetchSettings } from "@/services/settings";

import { i18n, initI18n } from "./index";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let preference: LocalePreference = "auto";
      try {
        const settings = await fetchSettings();
        preference = settings.ui.locale;
      } catch {
        // settings unavailable — treat as auto
      }

      const locale = resolveLocale(preference);
      await initI18n(locale);
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
