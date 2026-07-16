import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MaestroHost } from "@/components/maestro/MaestroHost";
import { MaestroExtraContextProvider } from "@/components/maestro/MaestroExtraContext";

const ensureActiveFreeformThread = vi.fn(async () => ({ id: 42, scope: "freeform" }));

vi.mock("@/services/assistantThreads", () => ({
  ensureActiveFreeformThread: () => ensureActiveFreeformThread(),
}));

vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: (props: Record<string, unknown>) => (
    <div
      data-testid="assistant-panel"
      data-thread={props.threadId == null ? "" : String(props.threadId)}
      data-project={props.projectSlug == null ? "" : String(props.projectSlug)}
      data-issue={props.issueIdentifier == null ? "" : String(props.issueIdentifier)}
      data-mode={String(props.assistantMode ?? "")}
    />
  ),
}));

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <MaestroExtraContextProvider>
        <MaestroHost />
      </MaestroExtraContextProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  ensureActiveFreeformThread.mockClear();
  window.localStorage.clear();
});

describe("MaestroHost", () => {
  it("shows the launcher on /projects", async () => {
    renderAt("/projects");
    expect(await screen.findByRole("button", { name: /maestro/i })).toBeInTheDocument();
  });

  it("renders nothing on workspaces routes", () => {
    const { container } = renderAt("/projects/acme/workspaces/12");
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on the full-page assistant route", () => {
    const { container } = renderAt("/assistant/9");
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the freeform panel on home and binds the ensured thread", async () => {
    const user = userEvent.setup();
    renderAt("/projects");

    await user.click(await screen.findByRole("button", { name: /maestro/i }));

    const panel = await screen.findByTestId("assistant-panel");
    await waitFor(() => expect(panel).toHaveAttribute("data-thread", "42"));
    expect(ensureActiveFreeformThread).toHaveBeenCalledTimes(1);
  });

  it("binds the project context on a board route", async () => {
    const user = userEvent.setup();
    renderAt("/projects/acme/board");

    await user.click(await screen.findByRole("button", { name: /maestro/i }));

    const panel = await screen.findByTestId("assistant-panel");
    expect(panel).toHaveAttribute("data-project", "acme");
    expect(panel).toHaveAttribute("data-mode", "project");
    expect(ensureActiveFreeformThread).not.toHaveBeenCalled();
  });

  it("binds the issue context when a drawer is open", async () => {
    const user = userEvent.setup();
    renderAt("/projects/acme/board/issues/ACME-7/summary");

    await user.click(await screen.findByRole("button", { name: /maestro/i }));

    const panel = await screen.findByTestId("assistant-panel");
    expect(panel).toHaveAttribute("data-project", "acme");
    expect(panel).toHaveAttribute("data-issue", "ACME-7");
  });
});
