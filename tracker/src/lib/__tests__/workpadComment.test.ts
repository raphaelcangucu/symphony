import { describe, expect, it } from "vitest";

import {
  isWorkpadComment,
  parseWorkpadSections,
  stripSymphonyPrsBlock,
  workpadPullRequestLabel,
} from "@/lib/workpadComment";

const JSON_BLOCK = `## Codex Workpad

### Validation
Pending rework validation.

<!-- symphony:prs {"repo":"civitaslearning/advising","prs":[{"number":9455,"url":"https://github.com/civitaslearning/advising/pull/9455","base":"pre-release","head":"feature/lti-group-sharing-CDE-1106","status":"active"},{"number":9599,"url":"https://github.com/civitaslearning/advising/pull/9599","status":"closed_superseded_unlinked"}]} -->`;

const YAML_BLOCK = `## Codex Workpad

### Plan
- [x] implement

<!-- symphony:prs
- repo: civitaslearning/advising
  number: 9455
  branch: feature/lti-group-sharing-CDE-1106
  url: https://github.com/civitaslearning/advising/pull/9455
-->`;

describe("workpadComment", () => {
  it("detects workpad comments by kind or heading", () => {
    expect(isWorkpadComment(JSON_BLOCK, "workpad")).toBe(true);
    expect(isWorkpadComment(JSON_BLOCK, null)).toBe(true);
    expect(isWorkpadComment("Hello world", "comment")).toBe(false);
  });

  it("strips the symphony:prs block and parses JSON entries", () => {
    const { displayBody, pullRequests } = stripSymphonyPrsBlock(JSON_BLOCK);

    expect(displayBody).not.toContain("symphony:prs");
    expect(displayBody).toContain("Pending rework validation.");
    expect(pullRequests).toHaveLength(2);
    expect(pullRequests[0]).toMatchObject({
      repo: "civitaslearning/advising",
      number: 9455,
      branch: "feature/lti-group-sharing-CDE-1106",
      base: "pre-release",
      status: "active",
    });
  });

  it("parses YAML-style symphony:prs blocks", () => {
    const { pullRequests } = stripSymphonyPrsBlock(YAML_BLOCK);

    expect(pullRequests).toEqual([
      {
        repo: "civitaslearning/advising",
        number: 9455,
        branch: "feature/lti-group-sharing-CDE-1106",
        base: null,
        url: "https://github.com/civitaslearning/advising/pull/9455",
        status: null,
      },
    ]);
  });

  it("parses structured workpad sections", () => {
    const sections = parseWorkpadSections(YAML_BLOCK);

    expect(sections).toEqual([
      { title: "Plan", body: "- [x] implement" },
    ]);
  });

  it("formats pull request labels", () => {
    expect(workpadPullRequestLabel({ repo: "civitaslearning/advising", number: 9455, branch: null, base: null, url: null, status: null })).toBe(
      "civitaslearning/advising#9455",
    );
  });
});
