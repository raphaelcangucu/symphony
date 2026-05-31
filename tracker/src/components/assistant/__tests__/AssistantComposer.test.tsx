import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantComposer } from "@/components/assistant/AssistantComposer";
import { mockAssistantCodexCatalog } from "@/test-fixtures/assistantCatalog";

const audioMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  refreshPermission: vi.fn(),
}));

const speechMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/hooks/useAudioRecorder", () => ({
  useAudioRecorder: () => ({
    permission: "prompt",
    recording: false,
    error: null,
    supported: true,
    start: audioMock.start,
    stop: audioMock.stop,
    refreshPermission: audioMock.refreshPermission,
  }),
}));

vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({
    supported: false,
    listening: false,
    error: null,
    start: speechMock.start,
    stop: speechMock.stop,
  }),
}));

vi.mock("@/services/assistant", async () => {
  const actual = await vi.importActual<typeof import("@/services/assistant")>("@/services/assistant");
  return {
    ...actual,
    uploadAssistantAttachment: vi.fn(async () => ({
      id: "upload-1",
      type: "image" as const,
      name: "diagram.png",
      mediaType: "image/png",
      path: "uploads/upload-1.png",
    })),
  };
});

describe("AssistantComposer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioMock.start.mockImplementation(async (onComplete: (blob: Blob, durationMs: number) => void) => {
      onComplete(new Blob(["audio-bytes"], { type: "audio/webm" }), 1000);
      return true;
    });
  });

  it("sends on Enter and exposes model and effort controls", () => {
    const onSubmit = vi.fn();

    render(
      <AssistantComposer projectSlug="macro-markets" catalog={mockAssistantCodexCatalog} onSubmit={onSubmit} />,
    );

    expect(screen.getByText("Codex CLI")).toBeTruthy();
    expect(screen.getByText("GPT-5.3 Codex")).toBeTruthy();
    expect(screen.getByText("Low")).toBeTruthy();

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "Hello assistant" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hello assistant",
        settings: expect.objectContaining({ model: "gpt-5.3-codex", effort: "low" }),
        attachments: [],
      }),
    );
  });

  it("does not send on Shift+Enter", () => {
    const onSubmit = vi.fn();

    render(
      <AssistantComposer projectSlug="macro-markets" catalog={mockAssistantCodexCatalog} onSubmit={onSubmit} />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "Line one" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true, code: "Enter" });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not stop audio recording on unrelated re-render", () => {
    render(
      <AssistantComposer projectSlug="macro-markets" catalog={mockAssistantCodexCatalog} onSubmit={vi.fn()} />,
    );

    fireEvent.change(screen.getByPlaceholderText("Write a message..."), {
      target: { value: "typing should not stop recording" },
    });

    expect(audioMock.stop).not.toHaveBeenCalled();
    expect(speechMock.stop).not.toHaveBeenCalled();
  });

  it("can submit an audio-only message after recording", async () => {
    const onSubmit = vi.fn();

    render(
      <AssistantComposer projectSlug="macro-markets" catalog={mockAssistantCodexCatalog} onSubmit={onSubmit} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Record audio" }));

    await waitFor(() => expect(screen.getByText(/recording-/)).toBeTruthy());

    fireEvent.keyDown(screen.getByPlaceholderText("Write a message..."), { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "",
          attachments: [
            expect.objectContaining({
              type: "audio",
              data: expect.any(String),
            }),
          ],
        }),
      ),
    );
  });
});
