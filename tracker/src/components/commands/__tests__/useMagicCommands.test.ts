import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMagicCommands } from "@/components/commands/useMagicCommands";
import type { RunPromptTemplateResult } from "@/services/magicCommands";
import type { PromptTemplate } from "@/types/prompt-template";

const listPromptTemplatesMock = vi.hoisted(() => vi.fn());
const runPromptTemplateMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/promptTemplates", () => ({
  listPromptTemplates: (...args: unknown[]) => listPromptTemplatesMock(...args),
}));

vi.mock("@/services/magicCommands", async () => {
  const actual = await vi.importActual<typeof import("@/services/magicCommands")>("@/services/magicCommands");
  return {
    ...actual,
    runPromptTemplate: (...args: unknown[]) => runPromptTemplateMock(...args),
  };
});

describe("useMagicCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPromptTemplatesMock.mockResolvedValue([]);
  });

  it("loads enabled templates sorted by category and position", async () => {
    listPromptTemplatesMock.mockResolvedValue([
      makeTemplate({ slug: "disabled", category: "analysis", position: 0, enabled: false }),
      makeTemplate({ slug: "summarize", category: "analysis", position: 2 }),
      makeTemplate({ slug: "review", category: "analysis", position: 1 }),
      makeTemplate({ slug: "ship", category: "build", position: 1 }),
    ]);

    const { result } = renderHook(() =>
      useMagicCommands({
        projectSlug: "  macro-markets  ",
        identifier: "MAC-1",
      }),
    );

    await waitFor(() => expect(listPromptTemplatesMock).toHaveBeenCalledWith("macro-markets"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.commands.map((command) => command.slug)).toEqual(["review", "summarize", "ship"]);
    expect(result.current.error).toBeNull();
  });

  it("runs a command, tracks running state, and notifies on success", async () => {
    const onRan = vi.fn();
    const deferred = createDeferred<RunPromptTemplateResult>();
    runPromptTemplateMock.mockReturnValue(deferred.promise);

    const { result } = renderHook(() =>
      useMagicCommands({
        projectSlug: "macro-markets",
        identifier: "  MAC-1  ",
        onRan,
      }),
    );

    await waitFor(() => expect(listPromptTemplatesMock).toHaveBeenCalled());

    let runPromise!: Promise<RunPromptTemplateResult>;
    act(() => {
      runPromise = result.current.run("code-review", { mode: "build" });
    });

    expect(result.current.isRunning).toBe(true);
    expect(runPromptTemplateMock).toHaveBeenCalledWith("macro-markets", "MAC-1", "code-review", { mode: "build" });

    const response = makeRunResult();
    await act(async () => {
      deferred.resolve(response);
      await runPromise;
    });

    expect(onRan).toHaveBeenCalledWith(response);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("exposes errors when running a command fails", async () => {
    runPromptTemplateMock.mockRejectedValue(new Error("run failed"));
    const onRan = vi.fn();

    const { result } = renderHook(() =>
      useMagicCommands({
        projectSlug: "macro-markets",
        identifier: "MAC-1",
        onRan,
      }),
    );

    await waitFor(() => expect(listPromptTemplatesMock).toHaveBeenCalled());

    let runPromise!: Promise<RunPromptTemplateResult>;
    act(() => {
      runPromise = result.current.run("code-review");
    });

    await expect(runPromise).rejects.toThrow("run failed");
    await waitFor(() => expect(result.current.error?.message).toBe("run failed"));
    expect(result.current.isRunning).toBe(false);
    expect(onRan).not.toHaveBeenCalled();
  });

  it("skips loading and fails fast when required identifiers are missing", async () => {
    const { result } = renderHook(() =>
      useMagicCommands({
        projectSlug: "   ",
        identifier: "  ",
      }),
    );

    expect(listPromptTemplatesMock).not.toHaveBeenCalled();
    expect(result.current.commands).toEqual([]);
    expect(result.current.isLoading).toBe(false);

    await expect(result.current.run("code-review")).rejects.toThrow("projectSlug is required");
    await expect(result.current.run("  ")).rejects.toThrow("projectSlug is required");
  });
});

function makeTemplate(overrides: Partial<PromptTemplate>): PromptTemplate {
  return {
    id: overrides.id ?? `id-${overrides.slug ?? "template"}`,
    slug: overrides.slug ?? "template",
    name: overrides.name ?? "Template",
    description: overrides.description ?? null,
    category: overrides.category ?? "analysis",
    body: overrides.body ?? "body",
    agentKind: overrides.agentKind ?? "codex",
    model: overrides.model ?? null,
    effort: overrides.effort ?? null,
    mode: overrides.mode ?? null,
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
      id: "1",
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
      groupLeadIdentifier: null,
      groupMemberIdentifiers: [],
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}
