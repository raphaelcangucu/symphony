import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AssistantComposer,
  COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
} from "@/components/assistant/AssistantComposer";
import { uploadAssistantAttachment } from "@/services/assistant";
import { i18n } from "@/i18n";
import {
  createMockAssistantCatalogBundle,
  mockAssistantCodexCatalog,
} from "@/test-fixtures/assistantCatalog";
import { LG_MEDIA_QUERY } from "@/hooks/useMediaQuery";

const mockBundle = createMockAssistantCatalogBundle();
// Override codex catalog with the mock for predictable model/effort names
mockBundle.agents = [
  { ...mockAssistantCodexCatalog },
  ...mockBundle.agents.filter((a) => a.agent !== "codex"),
];

const provenanceBundle = {
  agents: [
    {
      agent: "codex" as const,
      agentLabel: "Codex CLI",
      command: "codex app-server",
      defaultModel: "gpt-5.3-codex",
      models: [
        {
          id: "gpt-5.5",
          model: "gpt-5.5",
          label: "GPT-5.5",
          isDefault: false,
          defaultEffort: "medium",
          efforts: [
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
        },
        {
          id: "gpt-5.3-codex",
          model: "gpt-5.3-codex",
          label: "GPT-5.3 Codex",
          isDefault: true,
          defaultEffort: "low",
          efforts: [{ id: "low", label: "Low" }],
        },
      ],
    },
  ],
  defaultAgent: "codex" as const,
};

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
  const actual = await vi.importActual<typeof import("@/services/assistant")>(
    "@/services/assistant",
  );
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

const originalMatchMedia = window.matchMedia;

/** Forces `useIsLgUp()` to a fixed value so the split-minimal overflow behavior is testable regardless of viewport. */
function mockLgUp(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === LG_MEDIA_QUERY ? matches : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
      onchange: null,
    })),
  });
}

describe("AssistantComposer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    speechMock.listening = false;
    speechMock.start.mockImplementation(
      (onTranscript: (text: string, isFinal: boolean) => void) => {
        onTranscript("texto ditado", true);
      },
    );
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("sends on Enter and exposes model and effort controls", () => {
    const onSubmit = vi.fn();

    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={onSubmit}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: i18n.t("assistant.composer.modelChipAria"),
      }),
    ).toHaveAttribute("title", "Codex · GPT-5.3 Codex · Low");

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "Hello assistant" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hello assistant",
        settings: expect.objectContaining({
          model: "gpt-5.3-codex",
          effort: "low",
        }),
        attachments: [],
      }),
    );
  });

  it("submits the exact canonical settings seed", () => {
    const onSubmit = vi.fn();

    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={provenanceBundle}
        settingsSeed={{ agent: "codex", model: "gpt-5.5", effort: "high" }}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "Execute" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: { model: "gpt-5.5", effort: "high" },
      }),
    );
  });

  it("renders a thinking/effort icon for each reasoning-effort option", () => {
    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: i18n.t("assistant.composer.modelChipAria"),
      }),
    );

    expect(screen.getByTestId("compact-effort-icon-low")).toBeTruthy();
    expect(screen.getByTestId("compact-effort-icon-high")).toBeTruthy();
  });

  it("sends with the send button", () => {
    const onSubmit = vi.fn();

    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "Hello from button" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "message",
        message: "Hello from button",
        settings: expect.objectContaining({
          model: "gpt-5.3-codex",
          effort: "low",
        }),
        attachments: [],
      }),
    );
  });

  it("submits a default kind of 'message' with the typed text", () => {
    const onSubmit = vi.fn();
    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "message", message: "hello" }),
    );
  });

  it("submits kind 'infer' when the message starts with /infer", () => {
    const onSubmit = vi.fn();
    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, {
      target: { value: "/infer look at the tests" },
    });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "infer", message: "look at the tests" }),
    );
  });

  it("submits kind 'goal' with its objective when the message starts with /goal", () => {
    const onSubmit = vi.fn();
    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={onSubmit}
      />,
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
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "/goal" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "goal", message: "" }),
    );
  });

  it("shows the slash-command palette when the input starts with a slash", () => {
    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "/" } });

    expect(screen.getByText("/goal")).toBeInTheDocument();
    expect(screen.getByText("/infer")).toBeInTheDocument();
    expect(screen.getByText("/btw")).toBeInTheDocument();
  });

  it("completes the slash command on Tab from the palette", () => {
    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "/b" } });
    fireEvent.keyDown(textarea, { key: "Tab", code: "Tab" });

    expect(textarea).toHaveValue("/btw ");
  });

  it("highlights the first slash command and moves selection with arrow keys", () => {
    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "/" } });

    const goal = screen.getByRole("option", { name: /\/goal/i });
    const infer = screen.getByRole("option", { name: /\/infer/i });
    expect(goal).toHaveAttribute("aria-selected", "true");
    expect(infer).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(textarea, { key: "ArrowDown", code: "ArrowDown" });
    expect(goal).toHaveAttribute("aria-selected", "false");
    expect(infer).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(textarea, { key: "ArrowUp", code: "ArrowUp" });
    expect(goal).toHaveAttribute("aria-selected", "true");
    expect(infer).toHaveAttribute("aria-selected", "false");
  });

  it("completes the highlighted slash command on Tab after arrow navigation", () => {
    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "/" } });
    fireEvent.keyDown(textarea, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Tab", code: "Tab" });

    expect(textarea).toHaveValue("/infer ");
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

  it("applies a draftSeed request by replacing input and context refs", () => {
    const { rerender } = render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "draft to replace" } });

    rerender(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={vi.fn()}
        draftSeed={{
          requestId: 1,
          message: "edited from queue",
          attachments: [],
          contextRefs: [
            {
              type: "issue",
              id: "MAC-9",
              label: "Queued edit",
              detail: "MAC-9",
              content: "Queued edit body",
              state: "draft",
            },
          ],
        }}
      />,
    );

    expect(textarea).toHaveValue("edited from queue");
    expect(screen.getByText("MAC-9")).toBeInTheDocument();
    expect(screen.getByText("Queued edit")).toBeInTheDocument();
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
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        disabled
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByPlaceholderText("Write a message..."),
    ).not.toBeDisabled();
  });

  it("does not send on Shift+Enter", () => {
    const onSubmit = vi.fn();

    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "Line one" } });
    fireEvent.keyDown(textarea, {
      key: "Enter",
      shiftKey: true,
      code: "Enter",
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("grows the textarea with content and caps height at the max", () => {
    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Write a message...",
    ) as HTMLTextAreaElement;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: 120,
    });
    textarea.scrollTop = 0;

    fireEvent.change(textarea, {
      target: { value: "Line one\nLine two\nLine three" },
    });

    expect(textarea.style.height).toBe("120px");
    expect(textarea.scrollTop).toBe(120);

    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: 1200,
    });
    fireEvent.change(textarea, {
      target: {
        value: Array.from({ length: 40 }, (_, index) => `Line ${index}`).join(
          "\n",
        ),
      },
    });

    expect(textarea.style.height).toBe(`${COMPOSER_TEXTAREA_MAX_HEIGHT_PX}px`);
    expect(textarea.scrollTop).toBe(1200);
  });

  it("does not stop voice dictation on unrelated re-render", () => {
    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Write a message..."), {
      target: { value: "typing should not stop recording" },
    });

    expect(speechMock.stop).not.toHaveBeenCalled();
  });

  it("transcribes voice dictation into text without creating an audio attachment", () => {
    const onSubmit = vi.fn();

    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Record audio" }));

    expect(screen.getByPlaceholderText("Write a message...")).toHaveValue(
      "texto ditado",
    );
    expect(screen.queryByText(/recording-/)).toBeNull();

    fireEvent.keyDown(screen.getByPlaceholderText("Write a message..."), {
      key: "Enter",
      code: "Enter",
    });

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
      render(
        <AssistantComposer
          projectSlug="gamba"
          bundle={mockBundle}
          onSubmit={onSubmit}
        />,
      );

      const textarea = screen.getByPlaceholderText("Write a message...");
      const file = new File([new Uint8Array([1, 2, 3])], "shot.png", {
        type: "image/png",
      });

      fireEvent.paste(textarea, {
        clipboardData: {
          items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
          files: [file],
        },
      });

      const removeButton = await screen.findByRole("button", {
        name: "Remove diagram.png",
      });
      expect(removeButton).toBeTruthy();

      fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

      await waitFor(() =>
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            attachments: [
              expect.objectContaining({
                type: "image",
                name: "diagram.png",
                path: "uploads/upload-1.png",
              }),
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
      <AssistantComposer
        projectSlug="gamba"
        bundle={mockBundle}
        onSubmit={onSubmit}
      />,
    );

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    const file = new File(["# Notes"], "notes.md", { type: "text/markdown" });
    fireEvent.drop(form as HTMLFormElement, {
      dataTransfer: { files: [file], types: ["Files"] },
    });

    const removeButton = await screen.findByRole("button", {
      name: "Remove notes.md",
    });
    expect(removeButton).toBeTruthy();

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              type: "file",
              name: "notes.md",
              path: "uploads/upload-md.md",
            }),
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
    fireEvent.drop(messages, {
      dataTransfer: { files: [file], types: ["Files"] },
    });

    const removeButton = await screen.findByRole("button", {
      name: "Remove notes.md",
    });
    expect(removeButton).toBeTruthy();

    fireEvent.keyDown(screen.getByPlaceholderText("Write a message..."), {
      key: "Enter",
      code: "Enter",
    });

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              type: "file",
              name: "notes.md",
              path: "uploads/upload-md.md",
            }),
          ],
        }),
      ),
    );
  });

  it("shows a red stop button while recording", () => {
    speechMock.listening = true;

    const { container } = render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={vi.fn()}
      />,
    );

    const stopButton = screen.getByRole("button", { name: "Stop recording" });

    expect(stopButton.className).toContain("text-red-600");
    expect(container.querySelector(".lucide-square")).toBeTruthy();
    expect(container.querySelector(".motion-safe\\:animate-ping")).toBeTruthy();
    expect(
      container.querySelector(".motion-safe\\:animate-pulse"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record audio" })).toBeNull();
  });

  it("renders mention options in document flow so they are not clipped by overflow-hidden cards", () => {
    const mentionOptions = [
      { type: "issue" as const, id: "SYM-1", label: "Test issue" },
    ];

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

  it("turns selected @ mention options into context chips submitted as contextRefs", () => {
    const onSubmit = vi.fn();
    const mentionOptions = [
      {
        type: "issue" as const,
        id: "SYM-1",
        label: "Test issue",
        detail: "Todo",
      },
    ];

    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        mentionsEnabled
        mentionOptions={mentionOptions}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "@sym" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: /SYM-1/i }));

    expect(textarea).toHaveValue("");
    expect(screen.getByText("SYM-1")).toBeInTheDocument();
    expect(screen.getByText("Test issue")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "",
        contextRefs: [
          expect.objectContaining({
            type: "issue",
            id: "SYM-1",
            label: "Test issue",
            detail: "Todo",
            state: "draft",
          }),
        ],
      }),
    );
  });

  it("adds externally requested context chips to the next submit", () => {
    const onSubmit = vi.fn();

    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        contextInsertRequest={{
          id: 1,
          ref: {
            type: "file",
            id: "tracker/src/App.tsx",
            label: "App.tsx",
            detail: "Edited by agent",
            content: "### Agent edited file\n\n- Path: tracker/src/App.tsx",
            state: "draft",
          },
        }}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText("tracker/src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("App.tsx")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "",
        contextRefs: [
          expect.objectContaining({
            type: "file",
            id: "tracker/src/App.tsx",
            content: "### Agent edited file\n\n- Path: tracker/src/App.tsx",
            state: "draft",
          }),
        ],
      }),
    );
  });

  it("split-minimal: collapses toolbarMore into the overflow (⋯) menu even at lg+ widths", () => {
    mockLgUp(true);

    render(
      <AssistantComposer
        projectSlug="macro-markets"
        bundle={mockBundle}
        onSubmit={vi.fn()}
        toolbarMore={
          <>
            <button type="button">Diff</button>
            <button type="button">KB</button>
            <button type="button">Yolo</button>
          </>
        }
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Diff" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t("assistant.composer.moreToolsAria"),
      }),
    );

    expect(screen.getByRole("button", { name: "Diff" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "KB" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yolo" })).toBeInTheDocument();
  });
});
