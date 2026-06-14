import { describe, expect, it } from "vitest";

import {
  assigneeMatchesMe,
  isSymphonyLabelName,
  matchesPickerSearch,
  sortAssigneePickerItems,
  sortLabelPickerItems,
} from "@/lib/pickerOptions";
import type { IssueAssigneeOption } from "@/types/issue";

describe("pickerOptions", () => {
  it("detects symphony labels", () => {
    expect(isSymphonyLabelName("symphony")).toBe(true);
    expect(isSymphonyLabelName("symphony:codex")).toBe(true);
    expect(isSymphonyLabelName("bug")).toBe(false);
  });

  it("filters by search term", () => {
    expect(matchesPickerSearch("cod", "symphony:codex", "symphony")).toBe(true);
    expect(matchesPickerSearch("cod", "bug")).toBe(false);
    expect(matchesPickerSearch("", "bug")).toBe(true);
  });

  it("sorts symphony labels first", () => {
    const sorted = sortLabelPickerItems([
      { label: "bug", value: "1" },
      { label: "symphony:codex", value: "2" },
      { label: "symphony", value: "3" },
      { label: "frontend", value: "4" },
    ]);
    expect(sorted.map((item) => item.label)).toEqual(["symphony", "symphony:codex", "bug", "frontend"]);
  });

  it("matches assignee to me identities", () => {
    const option: IssueAssigneeOption = {
      id: "64078f0a284786631000bbbb",
      login: "raphael.cangucu",
      name: "Raphael Cangucu",
      avatarUrl: null,
    };
    expect(assigneeMatchesMe(option, ["Raphael Cangucu"])).toBe(true);
    expect(assigneeMatchesMe(option, ["bob"])).toBe(false);
  });

  it("sorts me assignee first", () => {
    const sorted = sortAssigneePickerItems(
      [
        { label: "Bob", login: "bob", value: "b" },
        { label: "Raphael Cangucu", login: "raphael", value: "r" },
      ],
      ["Raphael Cangucu"],
    );
    expect(sorted[0].label).toBe("Raphael Cangucu");
  });
});
