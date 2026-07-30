import { describe, expect, it, vi } from "vitest";

import { appendTranscript, captureDictation, startDictation } from "./dictation";

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
      stop: vi.fn(),
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

  it("lets the composer explicitly stop and receive the final transcription", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const port = {
      available: vi.fn().mockReturnValue(true),
      requestPermission: vi.fn().mockResolvedValue(true),
      addListener: vi.fn((event: string, listener: (event: unknown) => void) => {
        listeners.set(event, listener);
        return { remove: vi.fn() };
      }),
      start: vi.fn(),
      stop: vi.fn(() => {
        listeners.get("result")?.({
          isFinal: true,
          results: [{ transcript: "a complete sentence" }],
        });
      }),
      abort: vi.fn(),
    };

    const session = await startDictation(port, "pt-BR");
    expect(port.start).toHaveBeenCalledWith({
      addsPunctuation: true,
      continuous: true,
      interimResults: true,
      lang: "pt-BR",
    });
    session.stop();

    await expect(session.result).resolves.toBe("a complete sentence");
    expect(port.stop).toHaveBeenCalledTimes(1);
    expect(port.abort).not.toHaveBeenCalled();
  });

  it("returns a useful error when the recognizer ends without speech", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const port = {
      available: vi.fn().mockReturnValue(true),
      requestPermission: vi.fn().mockResolvedValue(true),
      addListener: vi.fn((event: string, listener: (event: unknown) => void) => {
        listeners.set(event, listener);
        return { remove: vi.fn() };
      }),
      start: vi.fn(() => listeners.get("end")?.(null)),
      stop: vi.fn(),
      abort: vi.fn(),
    };

    const session = await startDictation(port, "pt-BR");
    await expect(session.result).rejects.toThrow("No speech was recognized");
  });
});
