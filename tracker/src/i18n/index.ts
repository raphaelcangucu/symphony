import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../../locales/en/tracker.json";
import ptBR from "../../locales/pt-BR/tracker.json";

import type { ResolvedLocale } from "./detectLocale";

let currentResolvedLocale: ResolvedLocale = "en";

export function getResolvedLocale(): ResolvedLocale {
  return currentResolvedLocale;
}

export function setResolvedLocale(locale: ResolvedLocale): void {
  currentResolvedLocale = locale;
}

export async function initI18n(locale: ResolvedLocale): Promise<void> {
  setResolvedLocale(locale);
  if (i18n.isInitialized) {
    await i18n.changeLanguage(locale);
    return;
  }

  await i18n.use(initReactI18next).init({
    resources: {
      en: { tracker: en },
      "pt-BR": { tracker: ptBR },
    },
    lng: locale,
    fallbackLng: "en",
    defaultNS: "tracker",
    interpolation: { escapeValue: false },
  });
}

export { i18n };
