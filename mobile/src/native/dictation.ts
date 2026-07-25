export type DictationSubscription = {
  remove(): void;
};

export type DictationPort = {
  available(): boolean;
  requestPermission(): Promise<boolean>;
  addListener(event: "result" | "error", listener: (event: unknown) => void): DictationSubscription;
  start(options: {
    addsPunctuation: boolean;
    continuous: boolean;
    interimResults: boolean;
    lang: string;
  }): void;
  abort(): void;
};

export function appendTranscript(draft: string, transcript: string): string {
  const current = draft.trimEnd();
  const addition = transcript.trim();
  if (!addition) return draft;
  return current ? `${current} ${addition}` : addition;
}

export async function captureDictation(port: DictationPort, lang: string): Promise<string> {
  if (!port.available()) throw new Error("Speech recognition is unavailable on this device");
  if (!(await port.requestPermission())) throw new Error("Microphone permission was denied");

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const subscriptions: DictationSubscription[] = [];
    const timeout = setTimeout(() => finish(new Error("Dictation timed out")), 30_000);
    const cleanup = () => {
      clearTimeout(timeout);
      subscriptions.forEach((subscription) => subscription.remove());
    };
    const finish = (result: string | Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      port.abort();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    subscriptions.push(
      port.addListener("result", (event) => {
        const record = asRecord(event);
        if (record.isFinal !== true) return;
        const results = Array.isArray(record.results) ? record.results : [];
        const first = asRecord(results[0]);
        const transcript = typeof first.transcript === "string" ? first.transcript.trim() : "";
        finish(transcript || new Error("No speech was recognized"));
      }),
      port.addListener("error", (event) => {
        const record = asRecord(event);
        const message =
          typeof record.message === "string" && record.message.trim()
            ? record.message
            : "Speech recognition failed";
        finish(new Error(message));
      }),
    );

    port.start({
      addsPunctuation: true,
      continuous: false,
      interimResults: true,
      lang,
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
