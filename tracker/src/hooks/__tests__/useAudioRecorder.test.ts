import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAudioRecorder } from "@/hooks/useAudioRecorder";

class MockMediaRecorder {
  static isTypeSupported = () => true;
  state: RecordingState = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    _stream: MediaStream,
    _options?: MediaRecorderOptions,
  ) {}

  start() {
    this.state = "recording";
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["audio-bytes"], { type: "audio/webm" }) });
    });
  }

  requestData() {
    this.ondataavailable?.({ data: new Blob(["audio-bytes"], { type: "audio/webm" }) });
  }

  stop() {
    this.state = "inactive";
    queueMicrotask(() => this.onstop?.());
  }
}

describe("useAudioRecorder", () => {
  beforeEach(() => {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal(
      "MediaRecorder",
      MockMediaRecorder as unknown as typeof MediaRecorder,
    );

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }],
        })),
      },
    });

    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn(async () => ({
          state: "prompt",
          onchange: null,
        })),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests microphone permission and returns recorded audio", async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      const started = await result.current.start(onComplete);
      expect(started).toBe(true);
    });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      result.current.stop();
    });

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][0]).toBeInstanceOf(Blob);
  });

  it("surfaces permission denied errors", async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
      new DOMException("denied", "NotAllowedError"),
    );

    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      const started = await result.current.start(vi.fn());
      expect(started).toBe(false);
    });

    expect(result.current.permission).toBe("denied");
    expect(result.current.error).toContain("permission denied");
  });
});
