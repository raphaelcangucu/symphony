import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProjectAssistantRoute } from "@/components/workspace/ProjectAssistantRoute";
import type { WorkspaceView } from "@/lib/workspaceRoutes";

let workspaceValue: {
  projectSlug: string;
  view: WorkspaceView;
};

const projectAssistantPanel = vi.fn(
  ({
    projectSlug,
    onKbDocumentReferencesChanged,
  }: {
    projectSlug?: string;
    onKbDocumentReferencesChanged?: (paths: string[]) => void;
  }) => {
    const [clicks, setClicks] = useState(0);

    return (
      <section aria-label="mock project assistant">
        <div>assistant:{projectSlug}</div>
        <div>clicks:{clicks}</div>
        <button type="button" onClick={() => setClicks((current) => current + 1)}>
          increment local state
        </button>
        <button type="button" onClick={() => onKbDocumentReferencesChanged?.(["market/spec.md"])}>
          emit kb reference
        </button>
      </section>
    );
  },
);

const assistantKbDocumentsPanel = vi.fn(({ citedPaths }: { citedPaths: string[] }) => (
  <section aria-label="mock kb documents">cited:{citedPaths.join(",")}</section>
));

vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: (props: Parameters<typeof projectAssistantPanel>[0]) => projectAssistantPanel(props),
}));

vi.mock("@/components/assistant/AssistantKbDocumentsPanel", () => ({
  AssistantKbDocumentsPanel: (props: Parameters<typeof assistantKbDocumentsPanel>[0]) =>
    assistantKbDocumentsPanel(props),
}));

vi.mock("@/components/layout/WorkspaceContext", () => ({
  useWorkspace: () => workspaceValue,
}));

describe("ProjectAssistantRoute", () => {
  it("opens the KB panel for cited docs without remounting the assistant", () => {
    workspaceValue = { projectSlug: "macro-markets", view: "board" };

    render(<ProjectAssistantRoute />);

    act(() => {
      screen.getByRole("button", { name: "increment local state" }).click();
    });
    expect(screen.getByText("clicks:1")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "mock kb documents" })).toBeNull();

    act(() => {
      screen.getByRole("button", { name: "emit kb reference" }).click();
    });

    expect(screen.getByText("clicks:1")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "mock kb documents" })).toHaveTextContent("cited:market/spec.md");
  });
});
