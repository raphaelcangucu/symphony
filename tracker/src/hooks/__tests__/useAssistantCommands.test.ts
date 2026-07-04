import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAssistantCommands } from "@/hooks/useAssistantCommands";
import type { AssistantCommand } from "@/types/assistant-command";

const listAssistantCommandsMock = vi.fn();

vi.mock("@/services/assistantCommands", () => ({
  listAssistantCommands: (...args: unknown[]) => listAssistantCommandsMock(...args),
}));

const executionCommands: AssistantCommand[] = [
  {
    slug: "goal",
    name: "Goal",
    description: "Set goal",
    kind: "builtin",
    category: "core",
    submitKind: "goal",
    source: "builtin",
  },
];

describe("useAssistantCommands", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads assistant commands on mount", async () => {
    listAssistantCommandsMock.mockResolvedValueOnce(executionCommands);

    const { result } = renderHook(() => useAssistantCommands({ context: "execution" }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listAssistantCommandsMock).toHaveBeenCalledWith("execution", undefined);
    expect(result.current.commands).toEqual(executionCommands);
    expect(result.current.error).toBeNull();
  });

  it("reloads assistant commands on demand", async () => {
    listAssistantCommandsMock.mockResolvedValue(executionCommands);

    const { result } = renderHook(() =>
      useAssistantCommands({ context: "execution", projectSlug: "macro-markets" }),
    );

    await waitFor(() => expect(listAssistantCommandsMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.reload();
    });

    expect(listAssistantCommandsMock).toHaveBeenCalledTimes(2);
    expect(listAssistantCommandsMock).toHaveBeenLastCalledWith("execution", "macro-markets");
  });

  it("falls back to empty commands when loading fails", async () => {
    listAssistantCommandsMock.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useAssistantCommands({ context: "execution" }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.commands).toEqual([]);
    expect(result.current.error?.message).toBe("boom");
  });
});
