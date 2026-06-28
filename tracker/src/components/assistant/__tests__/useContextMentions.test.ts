import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useContextMentions } from "@/components/assistant/useContextMentions";

describe("useContextMentions", () => {
  it("opens the menu on an @ token and tracks the query", () => {
    const value = "... @log";
    const { result } = renderHook(({ v }) => useContextMentions(v), {
      initialProps: { v: value },
    });

    act(() => {
      result.current.handleChange(value, value.length);
    });

    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe("log");
    expect(result.current.mentionStart).toBe(4);
  });

  it("splices a typed mention token into the value", () => {
    const value = "... @log";
    const { result } = renderHook(({ v }) => useContextMentions(v), {
      initialProps: { v: value },
    });

    act(() => {
      result.current.handleChange(value, value.length);
    });

    let next: string | null = null;
    act(() => {
      next = result.current.selectMention({ type: "file", id: "lib/log.ex" });
    });

    expect(next).toBe("... @file:lib/log.ex ");
    expect(result.current.open).toBe(false);
  });

  it("closes when the prefix is not an @ token", () => {
    const value = "no mention here";
    const { result } = renderHook(({ v }) => useContextMentions(v), {
      initialProps: { v: value },
    });

    act(() => {
      result.current.handleChange(value, value.length);
    });

    expect(result.current.open).toBe(false);
    expect(result.current.selectMention({ type: "issue", id: "X" })).toBeNull();
  });
});
