import { describe, expect, it } from "vitest";

import { buildWorkflowConfig, workflowConfigToForm } from "@/lib/workflowConfig";

describe("workflowConfig converters", () => {
  it("reads an existing config into form state, defaulting absent collections to empty", () => {
    const form = workflowConfigToForm({
      tracker: { active_states: ["Todo", "In Progress"], terminal_states: ["Done"] },
      agent: { max_turns: 40, completion_transitions: { "In Review": "Done" } },
    });

    expect(form.tracker.active_states).toEqual(["Todo", "In Progress"]);
    expect(form.tracker.dispatch_states).toEqual([]);
    expect(form.agent.max_turns).toBe(40);
    expect(form.agent.completion_transitions).toEqual({ "In Review": "Done" });
    expect(form.agent.max_concurrent_agents_by_state).toEqual({});
    expect(form.editor.enabled).toBe(false);
  });

  it("builds a config that omits empty strings, empty arrays, empty maps, and undefined numbers", () => {
    const form = workflowConfigToForm({});
    form.tracker.active_states = ["Todo"];
    form.agent.max_turns = 25;

    const built = buildWorkflowConfig(form);

    expect(built).toEqual({
      tracker: { active_states: ["Todo"] },
      agent: { max_turns: 25 },
    });
    expect(built.hooks).toBeUndefined();
    expect(built.editor).toBeUndefined();
  });

  it("round-trips a populated config without inventing defaults", () => {
    const original = {
      tracker: { active_states: ["Todo"], dispatch_states: ["Todo"] },
      hooks: { after_create: "echo hi" },
      editor: { enabled: true, port: 8443, auth: "password" as const },
    };

    expect(buildWorkflowConfig(workflowConfigToForm(original))).toEqual(original);
  });

  it("parses dev_server.port_range, filtering junk and non-positive entries", () => {
    const form = workflowConfigToForm({});
    form.dev_server.enabled = true;
    form.dev_server.port_range = "4100, 4101, abc, -5";
    form.dev_server.auto_start_on = ["pull_request"];

    const built = buildWorkflowConfig(form);

    expect(built.dev_server).toEqual({
      enabled: true,
      port_range: [4100, 4101],
      auto_start_on: ["pull_request"],
    });
  });

  it("prunes whitespace-only string fields", () => {
    const form = workflowConfigToForm({});
    form.workspace.root = "   ";

    const built = buildWorkflowConfig(form);

    expect(built.workspace).toBeUndefined();
  });

  it("drops a false editor.enabled while keeping a real port", () => {
    const form = workflowConfigToForm({});
    form.editor.enabled = false;
    form.editor.port = 8443;

    const built = buildWorkflowConfig(form);

    expect(built).toEqual({ editor: { port: 8443 } });
  });
});
