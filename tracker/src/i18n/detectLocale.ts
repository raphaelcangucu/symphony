export type LocalePreference = "auto" | "en" | "pt-BR";
export type ResolvedLocale = "en" | "pt-BR";

export function detectBrowserLocale(): ResolvedLocale {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language.toLowerCase();
  return lang.startsWith("pt") ? "pt-BR" : "en";
}

export function resolveLocale(preference: LocalePreference): ResolvedLocale {
  if (preference === "auto") return detectBrowserLocale();
  return preference;
}
