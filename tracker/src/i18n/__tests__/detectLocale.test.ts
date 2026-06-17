import { describe, expect, it, vi } from "vitest";

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
