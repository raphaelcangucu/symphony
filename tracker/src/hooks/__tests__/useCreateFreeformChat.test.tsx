import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCreateFreeformChat } from "@/hooks/useCreateFreeformChat";

const navigate = vi.fn();
const createFreeformThread = vi.fn();
const toastError = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
}));

vi.mock("@/services/assistantThreads", () => ({
  createFreeformThread: (...args: unknown[]) => createFreeformThread(...(args as [])),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...(args as [])) },
}));

describe("useCreateFreeformChat", () => {
  beforeEach(() => {
    navigate.mockClear();
    createFreeformThread.mockClear();
    toastError.mockClear();
  });

  it("creates a thread, calls onCreated, and navigates to it", async () => {
    createFreeformThread.mockResolvedValueOnce({ id: 42 });
    const onCreated = vi.fn();
    const { result } = renderHook(() => useCreateFreeformChat(onCreated));

    await act(async () => {
      await result.current.createChat();
    });

    expect(createFreeformThread).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/assistant/42");
  });

  it("surfaces a toast and does not navigate on failure", async () => {
    createFreeformThread.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useCreateFreeformChat());

    await act(async () => {
      await result.current.createChat();
    });

    expect(toastError).toHaveBeenCalledWith("boom");
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.creating).toBe(false));
  });
});
