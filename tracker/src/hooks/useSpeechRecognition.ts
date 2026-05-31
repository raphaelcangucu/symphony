import { useCallback, useRef, useState } from "react";

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;

  const win = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

function speechErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
      return "Speech recognition needs microphone permission.";
    case "service-not-allowed":
      return "Speech recognition is blocked in this browser.";
    case "network":
      return "Speech recognition needs an internet connection.";
    case "no-speech":
      return "No speech was detected.";
    case "audio-capture":
      return "Could not capture audio for speech recognition.";
    case "aborted":
      return "Speech recognition was interrupted.";
    default:
      return "Speech recognition is unavailable in this browser.";
  }
}

export function useSpeechRecognition(lang = "pt-BR") {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false);
  const onTranscriptRef = useRef<((text: string, isFinal: boolean) => void) | null>(null);

  const [supported] = useState(() => getSpeechRecognitionConstructor() !== null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    activeRef.current = false;
    onTranscriptRef.current = null;

    const recognition = recognitionRef.current;
    recognitionRef.current = null;

    if (!recognition) {
      setListening(false);
      return;
    }

    try {
      recognition.abort();
    } catch {
      // ignore
    }

    setListening(false);
  }, []);

  const start = useCallback(
    (onTranscript: (text: string, isFinal: boolean) => void) => {
      const Recognition = getSpeechRecognitionConstructor();
      if (!Recognition) {
        setError("Live captions are not supported in this browser.");
        return;
      }

      stop();

      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang;
      recognitionRef.current = recognition;
      activeRef.current = true;
      onTranscriptRef.current = onTranscript;
      setError(null);

      recognition.onresult = (event) => {
        let interim = "";
        let finalText = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result[0]?.transcript ?? "";
          if (result.isFinal) finalText += transcript;
          else interim += transcript;
        }

        const callback = onTranscriptRef.current;
        if (!callback) return;

        if (finalText.trim()) callback(finalText.trim(), true);
        else if (interim.trim()) callback(interim.trim(), false);
      };

      recognition.onerror = (event) => {
        if (!activeRef.current) return;
        setError(speechErrorMessage(event.error));
        stop();
      };

      recognition.onend = () => {
        if (!activeRef.current) {
          setListening(false);
          return;
        }

        // Chrome stops after silence; restart while the user is still recording.
        try {
          recognition.start();
        } catch {
          setListening(false);
          activeRef.current = false;
        }
      };

      try {
        recognition.start();
        setListening(true);
      } catch {
        setError("Could not start speech recognition.");
        stop();
      }
    },
    [lang, stop],
  );

  return { supported, listening, error, start, stop };
}
