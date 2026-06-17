import { useCallback, useEffect, useRef, useState } from "react";

import { i18n } from "@/i18n";

export type MicrophonePermission = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

const RECORDING_TIMESLICE_MS = 250;
const MIN_RECORDING_MS = 400;

export function isMicrophoneSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}

function pickRecordingMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function mapPermissionState(state: PermissionState): MicrophonePermission {
  if (state === "granted") return "granted";
  if (state === "denied") return "denied";
  return "prompt";
}

function microphoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return i18n.t("assistant.audio.errors.notAllowed");
    }
    if (error.name === "NotFoundError") {
      return i18n.t("assistant.audio.errors.notFound");
    }
    if (error.name === "NotReadableError") {
      return i18n.t("assistant.audio.errors.notReadable");
    }
    if (error.name === "SecurityError") {
      return i18n.t("assistant.audio.errors.security");
    }
  }

  return i18n.t("assistant.audio.errors.accessFailed");
}

export function useAudioRecorder() {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const onCompleteRef = useRef<((blob: Blob, durationMs: number) => void) | null>(null);

  const [permission, setPermission] = useState<MicrophonePermission>(() =>
    isMicrophoneSupported() ? "unknown" : "unsupported",
  );
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPermission = useCallback(async () => {
    if (!isMicrophoneSupported()) {
      setPermission("unsupported");
      return;
    }

    if (!navigator.permissions?.query) {
      setPermission("prompt");
      return;
    }

    try {
      const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
      setPermission(mapPermissionState(status.state));
      status.onchange = () => setPermission(mapPermissionState(status.state));
    } catch {
      setPermission("prompt");
    }
  }, []);

  useEffect(() => {
    void refreshPermission();
    return () => {
      cleanupStream();
    };
  }, [refreshPermission]);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    startedAtRef.current = null;
    onCompleteRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setRecording(false);
      cleanupStream();
      return;
    }

    if (recorder.state === "recording") {
      try {
        recorder.requestData();
      } catch {
        // ignore — requestData is best-effort before stop
      }
      recorder.stop();
    }

    setRecording(false);
  }, [cleanupStream]);

  const start = useCallback(
    async (onComplete: (blob: Blob, durationMs: number) => void): Promise<boolean> => {
      if (!isMicrophoneSupported()) {
        const message = i18n.t("assistant.audio.errors.unsupported");
        setError(message);
        setPermission("unsupported");
        return false;
      }

      if (recording) return false;

      setError(null);
      onCompleteRef.current = onComplete;
      chunksRef.current = [];

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        });

        streamRef.current = stream;
        setPermission("granted");

        const mimeType = pickRecordingMimeType();
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        recorderRef.current = recorder;
        startedAtRef.current = Date.now();

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        };

        recorder.onerror = () => {
          setError(i18n.t("assistant.audio.errors.recordingFailed"));
          setRecording(false);
          cleanupStream();
        };

        recorder.onstop = () => {
          const chunks = chunksRef.current;
          const startedAt = startedAtRef.current ?? Date.now();
          const durationMs = Date.now() - startedAt;
          const callback = onCompleteRef.current;

          cleanupStream();
          setRecording(false);

          if (!callback) return;

          if (chunks.length === 0 || durationMs < MIN_RECORDING_MS) {
            setError(i18n.t("assistant.audio.errors.tooShort"));
            return;
          }

          const blob = new Blob(chunks, { type: chunks[0]?.type || mimeType || "audio/webm" });
          callback(blob, durationMs);
        };

        recorder.start(RECORDING_TIMESLICE_MS);
        setRecording(true);
        return true;
      } catch (cause) {
        const message = microphoneErrorMessage(cause);
        setError(message);
        if (cause instanceof DOMException && cause.name === "NotAllowedError") {
          setPermission("denied");
        }
        cleanupStream();
        setRecording(false);
        return false;
      }
    },
    [cleanupStream, recording],
  );

  return {
    permission,
    recording,
    error,
    start,
    stop,
    refreshPermission,
    supported: isMicrophoneSupported(),
  };
}
