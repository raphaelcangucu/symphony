import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useStableValue } from "@/hooks/useStableValue";

describe("useStableValue", () => {
  it("keeps the previous reference when the new value is deeply equal", () => {
    const first = { tasks: [{ id: "a", status: "running" }] };
    const equalButNew = { tasks: [{ id: "a", status: "running" }] };

    const { result, rerender } = renderHook(({ value }) => useStableValue(value), {
      initialProps: { value: first },
    });

    expect(result.current).toBe(first);

    rerender({ value: equalButNew });
    expect(result.current).toBe(first);
  });

  it("returns the new reference when the value actually changes", () => {
    const first = { tasks: [{ id: "a", status: "running" }] };
    const changed = { tasks: [{ id: "a", status: "completed" }] };

    const { result, rerender } = renderHook(({ value }) => useStableValue(value), {
      initialProps: { value: first },
    });

    rerender({ value: changed });
    expect(result.current).toBe(changed);
  });

  it("passes primitives through unchanged", () => {
    const { result, rerender } = renderHook(({ value }) => useStableValue(value), {
      initialProps: { value: 1 as number | null },
    });

    expect(result.current).toBe(1);
    rerender({ value: null });
    expect(result.current).toBeNull();
  });
});
