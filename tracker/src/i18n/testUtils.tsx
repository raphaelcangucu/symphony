import { render, type RenderOptions } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";

import { initI18n, i18n } from "@/i18n";
import type { ResolvedLocale } from "@/i18n/detectLocale";

export async function initTestI18n(locale: ResolvedLocale = "en"): Promise<void> {
  await initI18n(locale);
}

export function renderWithI18n(
  ui: React.ReactElement,
  locale: ResolvedLocale = "en",
  options?: RenderOptions,
) {
  void initTestI18n(locale);
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>, options);
}
