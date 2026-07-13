import { fireEvent, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ProjectAgentSelect } from "@/components/projects/ProjectAgentSelect";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import { i18n } from "@/i18n";

describe("ProjectAgentSelect", () => {
  beforeAll(async () => {
    await initTestI18n("en");
  });

  it("shows Inherit with the effective agent and fires null agent", () => {
    const onChange = vi.fn();
    renderWithI18n(
      <ProjectAgentSelect
        value="claude"
        model={null}
        effort={null}
        effectiveDefault="codex"
        onChange={onChange}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: i18n.t("issue.sessionLog.agentLabels.claude") }),
    );
    fireEvent.click(
      screen.getByRole("menuitemradio", {
        name: i18n.t("project.wizard.agent.inherit", {
          agent: i18n.t("issue.sessionLog.agentLabels.codex"),
        }),
      }),
    );
    expect(onChange).toHaveBeenCalledWith({ agent: null, model: null, effort: null });
  });
});
