import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantComposer } from "@/components/assistant/AssistantComposer";
import { mockAssistantCodexCatalog } from "@/test-fixtures/assistantCatalog";

const speechMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  listening: false,
}));

vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({
    supported: true,
    listening: speechMock.listening,
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
    speechMock.listening = false;
    speechMock.start.mockImplementation((onTranscript: (text: string, isFinal: boolean) => void) => {
      onTranscript("texto ditado", true);
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

  it("does not stop voice dictation on unrelated re-render", () => {
    render(
      <AssistantComposer projectSlug="macro-markets" catalog={mockAssistantCodexCatalog} onSubmit={vi.fn()} />,
    );

    fireEvent.change(screen.getByPlaceholderText("Write a message..."), {
      target: { value: "typing should not stop recording" },
    });

    expect(speechMock.stop).not.toHaveBeenCalled();
  });

  it("transcribes voice dictation into text without creating an audio attachment", () => {
    const onSubmit = vi.fn();

    render(
      <AssistantComposer projectSlug="macro-markets" catalog={mockAssistantCodexCatalog} onSubmit={onSubmit} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Record audio" }));

    expect(screen.getByPlaceholderText("Write a message...")).toHaveValue("texto ditado");
    expect(screen.queryByText(/recording-/)).toBeNull();

    fireEvent.keyDown(screen.getByPlaceholderText("Write a message..."), { key: "Enter", code: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "texto ditado",
        attachments: [],
      }),
    );
  });

  it("shows a red stop button while recording", () => {
    speechMock.listening = true;

    const { container } = render(
      <AssistantComposer projectSlug="macro-markets" catalog={mockAssistantCodexCatalog} onSubmit={vi.fn()} />,
    );

    const stopButton = screen.getByRole("button", { name: "Stop recording" });

    expect(stopButton.className).toContain("text-red-600");
    expect(container.querySelector(".lucide-square")).toBeTruthy();
    expect(container.querySelector(".motion-safe\\:animate-ping")).toBeTruthy();
    expect(container.querySelector(".motion-safe\\:animate-pulse")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record audio" })).toBeNull();
  });
});
