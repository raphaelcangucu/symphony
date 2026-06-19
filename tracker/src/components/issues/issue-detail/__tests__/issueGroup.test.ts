import { describe, expect, it } from "vitest";

import type { Issue } from "@/types/issue";

import { resolveIssueGroup } from "../issueGroup";

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: overrides.id ?? overrides.identifier ?? "issue-id",
    identifier: overrides.identifier ?? "CDE-1",
    projectSlug: overrides.projectSlug ?? "advising",
    status: overrides.status ?? "Todo",
    title: overrides.title ?? "Issue",
    description: overrides.description ?? null,
    priority: overrides.priority ?? null,
    position: overrides.position ?? 0,
    labels: overrides.labels ?? [],
    blockedBy: overrides.blockedBy ?? [],
    assignee: overrides.assignee ?? null,
    creator: overrides.creator ?? null,
    url: overrides.url ?? null,
    branchName: overrides.branchName ?? null,
    createdAt: overrides.createdAt ?? "2026-05-27T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-05-27T00:00:00Z",
    attachments: overrides.attachments ?? [],
    groupLeadIdentifier: overrides.groupLeadIdentifier ?? null,
    groupMemberIdentifiers: overrides.groupMemberIdentifiers ?? [],
  };
}

describe("resolveIssueGroup", () => {
  const lead = issue({ identifier: "CDE-1139", groupMemberIdentifiers: ["CDE-1141", "CDE-1140"] });
  const memberA = issue({ identifier: "CDE-1141", groupLeadIdentifier: "CDE-1139" });
  const memberB = issue({ identifier: "CDE-1140", groupLeadIdentifier: "CDE-1139" });
  const all = [lead, memberA, memberB, issue({ identifier: "CDE-1200" })];

  it("returns null for an ungrouped issue", () => {
    expect(resolveIssueGroup(issue({ identifier: "CDE-1200" }), all)).toBeNull();
  });

  it("resolves the full group from the lead, lead first", () => {
    const group = resolveIssueGroup(lead, all);
    expect(group?.leadIdentifier).toBe("CDE-1139");
    expect(group?.members.map((member) => member.identifier)).toEqual(["CDE-1139", "CDE-1141", "CDE-1140"]);
    expect(group?.members[0].isLead).toBe(true);
    expect(group?.members[1].isLead).toBe(false);
  });

  it("resolves siblings when viewing a member", () => {
    const group = resolveIssueGroup(memberA, all);
    expect(group?.leadIdentifier).toBe("CDE-1139");
    expect(group?.members.map((member) => member.identifier)).toEqual(["CDE-1139", "CDE-1141", "CDE-1140"]);
    expect(group?.members.find((member) => member.identifier === "CDE-1141")?.isLead).toBe(false);
  });

  it("still links the lead when siblings are outside the loaded list", () => {
    const group = resolveIssueGroup(memberB, [memberB]);
    expect(group?.leadIdentifier).toBe("CDE-1139");
    expect(group?.members.map((member) => member.identifier)).toEqual(["CDE-1139", "CDE-1140"]);
    expect(group?.members.find((member) => member.identifier === "CDE-1139")?.issue).toBeNull();
  });
});
