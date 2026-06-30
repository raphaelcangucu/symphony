import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantComposer } from "@/components/assistant/AssistantComposer";
import { uploadAssistantAttachment } from "@/services/assistant";
import { i18n } from "@/i18n";
import { mockAssistantCodexCatalog } from "@/test-fixtures/assistantCatalog";
import { fallbackCatalogBundle } from "@/lib/assistantSettings";

const mockBundle = fallbackCatalogBundle();
// Override codex catalog with the mock for predictable model/effort names
mockBundle.agents = [
  { ...mockAssistantCodexCatalog },
  ...mockBundle.agents.filter((a) => a.agent !== "codex"),
];

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
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={onSubmit} />,
    );

    expect(screen.getByText(i18n.t("issue.sessionLog.agentLabels.codex"))).toBeTruthy();
    expect(screen.getByText("GPT-5.3 Codex")).toBeTruthy();
    expect(screen.getByText(i18n.t("assistant.effort.low"))).toBeTruthy();

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

  it("renders a thinking/effort icon for each reasoning-effort option", () => {
    render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={vi.fn()} />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: i18n.t("assistant.effort.low") }));

    expect(screen.getByTestId("effort-icon-low")).toBeTruthy();
    expect(screen.getByTestId("effort-icon-high")).toBeTruthy();
  });

  it("sends with the send button", () => {
    const onSubmit = vi.fn();

    render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={onSubmit} />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "Hello from button" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "message",
        message: "Hello from button",
        settings: expect.objectContaining({ model: "gpt-5.3-codex", effort: "low" }),
        attachments: [],
      }),
    );
  });

  it("submits a default kind of 'message' with the typed text", () => {
    const onSubmit = vi.fn();
    render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={onSubmit} />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "message", message: "hello" }));
  });

  it("submits kind 'infer' when the message starts with /infer", () => {
    const onSubmit = vi.fn();
    render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={onSubmit} />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "/infer look at the tests" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "infer", message: "look at the tests" }),
    );
  });

  it("submits kind 'goal' with its objective when the message starts with /goal", () => {
    const onSubmit = vi.fn();
    render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={onSubmit} />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "/goal ship the feature" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "goal", message: "ship the feature" }),
    );
  });

  it("submits kind 'goal' even without an objective", () => {
    const onSubmit = vi.fn();
    render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={onSubmit} />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "/goal" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", message: "" }));
  });

  it("shows the slash-command palette when the input starts with a slash", () => {
    render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={vi.fn()} />,
    );
    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "/" } });

    expect(screen.getByText("/goal")).toBeInTheDocument();
    expect(screen.getByText("/infer")).toBeInTheDocument();
    expect(screen.getByText("/btw")).toBeInTheDocument();
  });

  it("completes the slash command on Tab from the palette", () => {
    render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={vi.fn()} />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "/b" } });
    fireEvent.keyDown(textarea, { key: "Tab", code: "Tab" });

    expect(textarea).toHaveValue("/btw ");
  });

  it("forces the oldest queued message when Enter is pressed on an empty input", () => {
    const onSubmit = vi.fn();
    const onForceQueued = vi.fn();
    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        hasQueued
        onForceQueued={onForceQueued}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onForceQueued).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not force a queued message when there is text to submit", () => {
    const onSubmit = vi.fn();
    const onForceQueued = vi.fn();
    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        hasQueued
        onForceQueued={onForceQueued}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "a real message" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onForceQueued).not.toHaveBeenCalled();
  });

  it("keeps the textarea enabled while the assistant is running", () => {
    render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} disabled onSubmit={vi.fn()} />,
    );

    expect(screen.getByPlaceholderText("Write a message...")).not.toBeDisabled();
  });

  it("does not send on Shift+Enter", () => {
    const onSubmit = vi.fn();

    render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={onSubmit} />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "Line one" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true, code: "Enter" });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the textarea scrolled to the bottom as text grows", () => {
    render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={vi.fn()} />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...") as HTMLTextAreaElement;
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 1200 });
    textarea.scrollTop = 0;

    fireEvent.change(textarea, {
      target: { value: Array.from({ length: 40 }, (_, index) => `Line ${index}`).join("\n") },
    });

    expect(textarea.scrollTop).toBe(1200);
  });

  it("does not stop voice dictation on unrelated re-render", () => {
    render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={vi.fn()} />,
    );

    fireEvent.change(screen.getByPlaceholderText("Write a message..."), {
      target: { value: "typing should not stop recording" },
    });

    expect(speechMock.stop).not.toHaveBeenCalled();
  });

  it("transcribes voice dictation into text without creating an audio attachment", () => {
    const onSubmit = vi.fn();

    render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={onSubmit} />,
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

  it("uploads pasted images and attaches them to the next message", async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();

    try {
      const onSubmit = vi.fn();
      render(<AssistantComposer projectSlug="gamba" bundle={mockBundle} onSubmit={onSubmit} />);

      const textarea = screen.getByPlaceholderText("Write a message...");
      const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });

      fireEvent.paste(textarea, {
        clipboardData: {
          items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
          files: [file],
        },
      });

      const removeButton = await screen.findByRole("button", { name: "Remove diagram.png" });
      expect(removeButton).toBeTruthy();

      fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

      await waitFor(() =>
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            attachments: [
              expect.objectContaining({ type: "image", name: "diagram.png", path: "uploads/upload-1.png" }),
            ],
          }),
        ),
      );
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("uploads dropped files (e.g. markdown) and attaches them to the next message", async () => {
    vi.mocked(uploadAssistantAttachment).mockResolvedValueOnce({
      id: "upload-md",
      type: "file",
      name: "notes.md",
      mediaType: "text/markdown",
      path: "uploads/upload-md.md",
    });

    const onSubmit = vi.fn();
    const { container } = render(
      <AssistantComposer projectSlug="gamba" bundle={mockBundle} onSubmit={onSubmit} />,
    );

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    const file = new File(["# Notes"], "notes.md", { type: "text/markdown" });
    fireEvent.drop(form as HTMLFormElement, {
      dataTransfer: { files: [file], types: ["Files"] },
    });

    const removeButton = await screen.findByRole("button", { name: "Remove notes.md" });
    expect(removeButton).toBeTruthy();

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({ type: "file", name: "notes.md", path: "uploads/upload-md.md" }),
          ],
        }),
      ),
    );
  });

  it("uploads files dropped anywhere in the configured drop target, not only the form", async () => {
    vi.mocked(uploadAssistantAttachment).mockResolvedValueOnce({
      id: "upload-md",
      type: "file",
      name: "notes.md",
      mediaType: "text/markdown",
      path: "uploads/upload-md.md",
    });

    const onSubmit = vi.fn();

    function PanelWrapper() {
      const dropRef = useRef<HTMLElement | null>(null);
      return (
        <section ref={dropRef} data-testid="panel" style={{ height: 400 }}>
          <div data-testid="messages" style={{ height: 200 }}>
            messages area
          </div>
          <AssistantComposer
            projectSlug="gamba"
            bundle={mockBundle}
            onSubmit={onSubmit}
            dropTargetRef={dropRef}
          />
        </section>
      );
    }

    render(<PanelWrapper />);

    // Drop over the messages area (outside the composer form).
    const messages = screen.getByTestId("messages");
    const file = new File(["# Notes"], "notes.md", { type: "text/markdown" });
    fireEvent.drop(messages, { dataTransfer: { files: [file], types: ["Files"] } });

    const removeButton = await screen.findByRole("button", { name: "Remove notes.md" });
    expect(removeButton).toBeTruthy();

    fireEvent.keyDown(screen.getByPlaceholderText("Write a message..."), { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({ type: "file", name: "notes.md", path: "uploads/upload-md.md" }),
          ],
        }),
      ),
    );
  });

  it("shows a red stop button while recording", () => {
    speechMock.listening = true;

    const { container } = render(
      <AssistantComposer projectSlug="macro-markets" bundle={mockBundle} onSubmit={vi.fn()} />,
    );

    const stopButton = screen.getByRole("button", { name: "Stop recording" });

    expect(stopButton.className).toContain("text-red-600");
    expect(container.querySelector(".lucide-square")).toBeTruthy();
    expect(container.querySelector(".motion-safe\\:animate-ping")).toBeTruthy();
    expect(container.querySelector(".motion-safe\\:animate-pulse")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record audio" })).toBeNull();
  });

  it("renders mention options in document flow so they are not clipped by overflow-hidden cards", () => {
    const mentionOptions = [{ type: "issue" as const, id: "SYM-1", label: "Test issue" }];

    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        mentionsEnabled
        mentionOptions={mentionOptions}
        onSubmit={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "@sym" } });

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(listbox.className).not.toContain("absolute");
    expect(screen.getByText("SYM-1")).toBeInTheDocument();
  });
});
