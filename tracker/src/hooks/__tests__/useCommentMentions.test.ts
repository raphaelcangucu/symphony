import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCommentMentions } from "@/hooks/useCommentMentions";
import type { IssueAssigneeOption } from "@/types/issue";

describe("useCommentMentions", () => {
  const assignees: IssueAssigneeOption[] = [
    { id: "U1", login: "raphael", name: "Raphael", avatarUrl: null },
    { id: "U2", login: "bob", name: "Bob", avatarUrl: null },
  ];

  it("detects an active @mention token", () => {
    const body = "Hi @ra";
    const { result } = renderHook(({ value }) => useCommentMentions(value, assignees), {
      initialProps: { value: body },
    });

    act(() => {
      result.current.handleChange(body, body.length);
    });

    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe("ra");
    expect(result.current.filteredAssignees.map((option) => option.login)).toEqual(["raphael"]);
  });

  it("replaces the mention token with @login", () => {
    const body = "Hi @ra";
    const { result, rerender } = renderHook(({ value }) => useCommentMentions(value, assignees), {
      initialProps: { value: body },
    });

    act(() => {
      result.current.handleChange(body, body.length);
    });

    const next = result.current.selectMention("raphael");
    expect(next).toBe("Hi @raphael ");

    rerender({ value: next ?? body });
    expect(result.current.open).toBe(false);
  });
});
