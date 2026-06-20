import { describe, expect, it } from "vitest";

import { matchingSlashCommands, parseSlashCommand, SLASH_COMMAND_NAMES } from "../slashCommands";

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
  it("lists all commands when input is just a slash", () => {
    expect(matchingSlashCommands("/").map((c) => c.name)).toEqual(SLASH_COMMAND_NAMES);
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
