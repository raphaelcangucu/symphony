import { describe, expect, it, vi } from "vitest";

import { appendTranscript, captureDictation } from "./dictation";

describe("appendTranscript", () => {
  it("appends speech without replacing the existing draft", () => {
    expect(appendTranscript("Keep this draft", "and add voice")).toBe(
      "Keep this draft and add voice",
    );
    expect(appendTranscript("", "  first words  ")).toBe("first words");
  });
});

describe("captureDictation", () => {
  it("requests permission and resolves the final transcript", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const port = {
      available: vi.fn().mockReturnValue(true),
      requestPermission: vi.fn().mockResolvedValue(true),
      addListener: vi.fn((event: string, listener: (event: unknown) => void) => {
        listeners.set(event, listener);
        return { remove: vi.fn() };
      }),
      start: vi.fn(() => {
        listeners.get("result")?.({
          isFinal: true,
          results: [{ transcript: "spoken text" }],
        });
      }),
      abort: vi.fn(),
    };

    await expect(captureDictation(port, "pt-BR")).resolves.toBe("spoken text");
    expect(port.start).toHaveBeenCalledWith({
      addsPunctuation: true,
      continuous: false,
      interimResults: true,
      lang: "pt-BR",
    });
  });
});
