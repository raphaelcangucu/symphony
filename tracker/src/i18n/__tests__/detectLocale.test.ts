import { describe, expect, it, vi } from "vitest";

import en from "../../../locales/en/tracker.json";
import ptBR from "../../../locales/pt-BR/tracker.json";
import { detectBrowserLocale, resolveLocale } from "@/i18n/detectLocale";

describe("detectBrowserLocale", () => {
  it("maps pt languages to pt-BR", () => {
    vi.stubGlobal("navigator", { language: "pt-BR" });
    expect(detectBrowserLocale()).toBe("pt-BR");
    vi.unstubAllGlobals();
  });

  it("falls back to en for other languages", () => {
    vi.stubGlobal("navigator", { language: "de-DE" });
    expect(detectBrowserLocale()).toBe("en");
    vi.unstubAllGlobals();
  });
});

describe("resolveLocale", () => {
  it("uses browser when setting is auto", () => {
    vi.stubGlobal("navigator", { language: "pt-PT" });
    expect(resolveLocale("auto")).toBe("pt-BR");
    vi.unstubAllGlobals();
  });

  it("uses explicit setting when not auto", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("pt-BR")).toBe("pt-BR");
  });
});

describe("Goal Mode locale contract", () => {
  it.each([
    ["en", en],
    ["pt-BR", ptBR],
  ])("provides the shared Goal presentation keys in %s", (_locale, messages) => {
    expect(messages.assistant.goalDock).toMatchObject({
      ariaLabel: expect.any(String),
      providerCodex: expect.any(String),
      providerClaude: expect.any(String),
      providerUnsupported: expect.any(String),
      starting: expect.any(String),
      running: expect.any(String),
      paused: expect.any(String),
      completed: expect.any(String),
      blocked: expect.any(String),
      failed: expect.any(String),
      budgetLimited: expect.any(String),
      usageLimited: expect.any(String),
      noObjective: expect.any(String),
      stop: expect.any(String),
      pause: expect.any(String),
      resume: expect.any(String),
      edit: expect.any(String),
      remove: expect.any(String),
    });
  });
});
