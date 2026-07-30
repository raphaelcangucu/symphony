export type DictationSubscription = {
  remove(): void;
};

export type DictationPort = {
  available(): boolean;
  requestPermission(): Promise<boolean>;
  addListener(
    event: "result" | "error" | "end",
    listener: (event: unknown) => void,
  ): DictationSubscription;
  start(options: {
    addsPunctuation: boolean;
    continuous: boolean;
    interimResults: boolean;
    lang: string;
  }): void;
  stop(): void;
  abort(): void;
};

export type DictationSession = {
  /** Resolves with the final transcription after the recognizer stops. */
  result: Promise<string>;
  /** Ask the recognizer for a final transcription of the captured audio. */
  stop(): void;
  /** Discard the current capture without adding a partial message. */
  cancel(): void;
};

export function appendTranscript(draft: string, transcript: string): string {
  const current = draft.trimEnd();
  const addition = transcript.trim();
  if (!addition) return draft;
  return current ? `${current} ${addition}` : addition;
}

export async function captureDictation(port: DictationPort, lang: string): Promise<string> {
  return (await createDictation(port, lang, false)).result;
}

/**
 * Starts a dictation which the caller can explicitly stop.  A single tap used
 * to leave the recognizer waiting for Android's silence heuristic, with no
 * visible way to finish a longer sentence.  Keeping the session handle lets
 * the composer behave like a normal record/stop control instead.
 */
export async function startDictation(port: DictationPort, lang: string): Promise<DictationSession> {
  return createDictation(port, lang, true);
}

async function createDictation(
  port: DictationPort,
  lang: string,
  continuous: boolean,
): Promise<DictationSession> {
  if (!port.available()) throw new Error("Speech recognition is unavailable on this device");
  if (!(await port.requestPermission())) throw new Error("Microphone permission was denied");

  let stopRequested = false;
  let cancelRequested = false;
  let latestTranscript = "";
  let stopRecognition = () => undefined;
  let cancelRecognition = () => undefined;
  const result = new Promise<string>((resolve, reject) => {
    let settled = false;
    const subscriptions: DictationSubscription[] = [];
    const timeout = setTimeout(() => finish(new Error("Dictation timed out"), true), 30_000);
    const cleanup = () => {
      clearTimeout(timeout);
      subscriptions.forEach((subscription) => subscription.remove());
    };
    const finish = (value: string | Error, abort = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (abort) port.abort();
      if (value instanceof Error) reject(value);
      else resolve(value);
    };
    stopRecognition = () => {
      if (settled || stopRequested) return;
      stopRequested = true;
      port.stop();
    };
    cancelRecognition = () => {
      if (settled || cancelRequested) return;
      cancelRequested = true;
      finish(new Error("Dictation cancelled"), true);
    };

    subscriptions.push(
      port.addListener("result", (event) => {
        const record = asRecord(event);
        if (record.isFinal !== true) return;
        const results = Array.isArray(record.results) ? record.results : [];
        const first = asRecord(results[0]);
        const transcript = typeof first.transcript === "string" ? first.transcript.trim() : "";
        if (!transcript) return;
        latestTranscript = transcript;
        // The compact entry points keep their single-tap behavior.  The chat
        // uses continuous recognition and only commits once the user presses
        // Stop, so a sentence is never cut off after its first final fragment.
        if (!continuous || stopRequested) finish(transcript);
      }),
      port.addListener("error", (event) => {
        const record = asRecord(event);
        const message =
          typeof record.message === "string" && record.message.trim()
            ? record.message
            : "Speech recognition failed";
        finish(new Error(message), true);
      }),
      port.addListener("end", () => {
        // Android may end before yielding a final result (for example after a
        // very short tap).  Surface that outcome instead of leaving the chat
        // composer in an indeterminate listening state until its timeout.
        finish(latestTranscript || new Error("No speech was recognized"));
      }),
    );

    port.start({
      addsPunctuation: true,
      continuous,
      interimResults: true,
      lang,
    });
  });

  return {
    result,
    stop: () => stopRecognition(),
    cancel: () => cancelRecognition(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
