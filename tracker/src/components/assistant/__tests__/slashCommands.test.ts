import { describe, expect, it } from "vitest";

import {
  defaultSkillCommands,
  matchingSlashCommands,
  parseSlashCommand,
} from "../slashCommands";

describe("parseSlashCommand", () => {
  it("parses /goal with its objective", () => {
    expect(parseSlashCommand("/goal ship the feature")).toEqual({ kind: "goal", argument: "ship the feature" });
  });

  it("parses /goal with no objective", () => {
    expect(parseSlashCommand("/goal")).toEqual({ kind: "goal", argument: "" });
  });

  it("parses /infer with its argument", () => {
    expect(parseSlashCommand("/infer focus on tests")).toEqual({ kind: "infer", argument: "focus on tests" });
  });

  it("parses /btw with its argument", () => {
    expect(parseSlashCommand("/btw what's the diff")).toEqual({ kind: "btw", argument: "what's the diff" });
  });

  it("returns a plain message for non-commands", () => {
    expect(parseSlashCommand("hello there")).toEqual({ kind: "message", argument: "hello there" });
  });

  it("treats an unknown slash token as a plain message", () => {
    expect(parseSlashCommand("/unknown thing")).toEqual({ kind: "message", argument: "/unknown thing" });
  });

  it("trims the command argument", () => {
    expect(parseSlashCommand("/infer   spaced  ")).toEqual({ kind: "infer", argument: "spaced" });
  });
});

describe("matchingSlashCommands", () => {
  it("lists authoring commands when input is just a slash", () => {
    expect(matchingSlashCommands("/").map((c) => c.name)).toEqual(["/goal", "/infer", "/btw"]);
  });

  it("filters by prefix", () => {
    expect(matchingSlashCommands("/in").map((c) => c.name)).toEqual(["/infer"]);
  });

  it("filters /g to the goal command", () => {
    expect(matchingSlashCommands("/g").map((c) => c.name)).toEqual(["/goal"]);
  });

  it("returns nothing when input does not start with a slash", () => {
    expect(matchingSlashCommands("hello")).toEqual([]);
  });
});

describe("execution skill commands", () => {
  it("includes skill commands like /plan via fuzzy match in execution context", () => {
    const names = matchingSlashCommands("/pl", undefined, "execution").map((c) => c.name);
    expect(names).toContain("/plan");
  });

  it("uses provided extras instead of static execution skill fallback", () => {
    const names = matchingSlashCommands("/rel", undefined, "execution", [
      {
        name: "/release",
        kind: "message",
        description: "Prepare a release",
        insertText: "Use /release skill",
      },
    ]).map((c) => c.name);
    expect(names).toEqual(["/release"]);
    expect(names).not.toContain("/plan");
  });

  it("still resolves built-ins in execution context", () => {
    const names = matchingSlashCommands("/inf", undefined, "execution").map((c) => c.name);
    expect(names).toContain("/infer");
  });

  it("ranks exact-prefix matches first", () => {
    const names = matchingSlashCommands("/p", undefined, "execution").map((c) => c.name);
    expect(names[0]?.startsWith("/p")).toBe(true);
  });

  it("omits skill commands in the authoring context", () => {
    const names = matchingSlashCommands("/pl", undefined, "authoring").map((c) => c.name);
    expect(names).not.toContain("/plan");
  });

  it("treats implementation profiles like the execution slash bucket", () => {
    const names = matchingSlashCommands("/pl", undefined, "implementation").map((c) => c.name);
    expect(names).toContain("/plan");
  });

  it("treats planning profiles like the authoring slash bucket", () => {
    const names = matchingSlashCommands("/pl", undefined, "planning").map((c) => c.name);
    expect(names).not.toContain("/plan");
  });
});
