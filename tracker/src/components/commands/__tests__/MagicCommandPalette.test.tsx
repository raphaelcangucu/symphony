import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MagicCommandPalette } from "@/components/commands/MagicCommandPalette";
import { initTestI18n } from "@/i18n/testUtils";
import type { RunPromptTemplateResult } from "@/services/magicCommands";
import type { PromptTemplate } from "@/types/prompt-template";

const useMagicCommandsMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/commands/useMagicCommands", () => ({
  useMagicCommands: (...args: unknown[]) => useMagicCommandsMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe("MagicCommandPalette", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await initTestI18n("en");
    useMagicCommandsMock.mockReturnValue({
      commands: [],
      isLoading: false,
      error: null,
      isRunning: false,
      run: vi.fn(),
    });
  });

  it("groups commands by category and supports fuzzy filtering", async () => {
    const user = userEvent.setup();
    useMagicCommandsMock.mockReturnValue({
      commands: [
        makeTemplate({
          slug: "review-diff",
          name: "Review diff",
          category: "analysis",
          agentKind: "codex",
          model: "gpt-5.5",
          effort: "high",
          mode: "plan",
        }),
        makeTemplate({
          slug: "ship-changes",
          name: "Ship changes",
          category: "build",
          agentKind: "claude",
          model: "claude-opus-4-8",
          effort: "xhigh",
          mode: "build",
        }),
        makeTemplate({
          slug: "quick-note",
          name: "Quick note",
          category: null,
          agentKind: "cursor",
          model: "auto",
          effort: null,
          mode: null,
        }),
      ],
      isLoading: false,
      error: null,
      isRunning: false,
      run: vi.fn(),
    });

    render(
      <MagicCommandPalette
        open
        onOpenChange={vi.fn()}
        projectSlug="macro-markets"
        identifier="MAC-1"
      />,
    );

    expect(screen.getByText("Analysis", { selector: "[cmdk-group-heading]" })).toBeInTheDocument();
    expect(screen.getByText("Build", { selector: "[cmdk-group-heading]" })).toBeInTheDocument();
    expect(screen.getByText("Uncategorized", { selector: "[cmdk-group-heading]" })).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.5")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();

    const input = screen.getByPlaceholderText("Search magic commands…");
    await user.type(input, "claude-opus-4-8");

    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent("Ship changes");
    });
  });

  it("runs the selected command, shows pending state, and closes on success", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const deferred = createDeferred<RunPromptTemplateResult>();
    const runMock = vi.fn().mockReturnValue(deferred.promise);

    useMagicCommandsMock.mockReturnValue({
      commands: [makeTemplate({ slug: "review-diff", name: "Review diff", category: "analysis" })],
      isLoading: false,
      error: null,
      isRunning: false,
      run: runMock,
    });

    render(
      <MagicCommandPalette
        open
        onOpenChange={onOpenChange}
        projectSlug="macro-markets"
        identifier="MAC-1"
      />,
    );

    await user.type(screen.getByPlaceholderText("Search magic commands…"), "review");
    await user.keyboard("{Enter}");

    expect(runMock).toHaveBeenCalledWith("review-diff");
    expect(screen.getByText("Running…")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await deferred.resolve(makeRunResult());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows an error toast when dispatch fails", async () => {
    const user = userEvent.setup();
    const runMock = vi.fn().mockRejectedValue(new Error("dispatch failed"));
    const onOpenChange = vi.fn();

    useMagicCommandsMock.mockReturnValue({
      commands: [makeTemplate({ slug: "review-diff", name: "Review diff", category: "analysis" })],
      isLoading: false,
      error: null,
      isRunning: false,
      run: runMock,
    });

    render(
      <MagicCommandPalette
        open
        onOpenChange={onOpenChange}
        projectSlug="macro-markets"
        identifier="MAC-1"
      />,
    );

    await user.type(screen.getByPlaceholderText("Search magic commands…"), "review");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("dispatch failed"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes when escape is pressed", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    useMagicCommandsMock.mockReturnValue({
      commands: [makeTemplate({ slug: "review-diff", name: "Review diff", category: "analysis" })],
      isLoading: false,
      error: null,
      isRunning: false,
      run: vi.fn(),
    });

    render(
      <MagicCommandPalette
        open
        onOpenChange={onOpenChange}
        projectSlug="macro-markets"
        identifier="MAC-1"
      />,
    );

    await user.keyboard("{Escape}");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

function makeTemplate(overrides: Partial<PromptTemplate>): PromptTemplate {
  return {
    id: overrides.id ?? `template-${overrides.slug ?? "default"}`,
    slug: overrides.slug ?? "default",
    name: overrides.name ?? "Default command",
    description: overrides.description ?? null,
    category: overrides.category === undefined ? "analysis" : overrides.category,
    body: overrides.body ?? "body",
    agentKind: overrides.agentKind === undefined ? "codex" : overrides.agentKind,
    model: overrides.model === undefined ? "gpt-5.5" : overrides.model,
    effort: overrides.effort === undefined ? "medium" : overrides.effort,
    mode: overrides.mode === undefined ? "build" : overrides.mode,
    scope: overrides.scope ?? "global",
    builtIn: overrides.builtIn ?? true,
    enabled: overrides.enabled ?? true,
    position: overrides.position ?? 0,
    insertedAt: overrides.insertedAt ?? null,
    updatedAt: overrides.updatedAt ?? null,
  };
}

function makeRunResult(): RunPromptTemplateResult {
  return {
    ok: true,
    action: "resume",
    message: "started",
    issue: {
      id: "issue-1",
      identifier: "MAC-1",
      projectSlug: "macro-markets",
      status: "Todo",
      title: "Magic command",
      description: null,
      priority: null,
      position: 0,
      labels: [],
      blockedBy: [],
      assignee: null,
      creator: null,
      url: null,
      branchName: null,
      createdAt: "2026-06-30T00:00:00Z",
      updatedAt: "2026-06-30T00:00:00Z",
      attachments: [],
    },
  };
}

function createDeferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: (value: T) => Promise.resolve(resolvePromise(value)),
    reject: (reason?: unknown) => Promise.resolve(rejectPromise(reason)),
  };
}
