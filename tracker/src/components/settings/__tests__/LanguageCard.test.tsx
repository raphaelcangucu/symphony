import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LanguageCard } from "@/components/settings/LanguageCard";
import { initTestI18n } from "@/i18n/testUtils";
import * as settingsService from "@/services/settings";
import { I18nextProvider } from "react-i18next";
import { i18n } from "@/i18n";

describe("LanguageCard", () => {
  it("saves pt-BR locale on selection", async () => {
    await initTestI18n("en");
    vi.spyOn(settingsService, "updateUiSettings").mockResolvedValue({ locale: "pt-BR" });
    const onChange = vi.fn();

    render(
      <I18nextProvider i18n={i18n}>
        <LanguageCard initial="auto" loadError={false} onLocaleChange={onChange} />
      </I18nextProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /Português \(Brasil\)/ }));
    expect(settingsService.updateUiSettings).toHaveBeenCalledWith({ locale: "pt-BR" });
  });
});
