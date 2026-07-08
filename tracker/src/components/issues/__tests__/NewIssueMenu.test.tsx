import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NewIssueMenu } from "@/components/issues/NewIssueMenu";
import type { Issue } from "@/types/issue";
import type { WorkflowStatusName } from "@/types/workflow-status";

const createdIssue: Issue = {
  id: "issue-1",
  identifier: "MAC-1",
  projectSlug: "macro-markets",
  status: "In Progress",
  title: "Draft launch checklist",
  description: null,
  priority: null,
  position: 0,
  labels: [],
  blockedBy: [],
  assignee: null,
  creator: null,
  url: null,
  branchName: null,
  createdAt: "2026-05-31T00:00:00Z",
  updatedAt: "2026-05-31T00:00:00Z",
  attachments: [],
};

const issueCreateDialog = vi.fn(
  ({
    projectSlug,
    defaultStatus,
    open,
    onCreated,
    onOpenChange,
  }: {
    projectSlug: string;
    defaultStatus?: WorkflowStatusName;
    open?: boolean;
    onCreated?: (issue: Issue) => void;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <section aria-label="mock quick create dialog">
        <p>project:{projectSlug}</p>
        <p>status:{defaultStatus ?? "none"}</p>
        <button
          type="button"
          onClick={() => {
            onCreated?.(createdIssue);
            onOpenChange?.(false);
          }}
        >
          emit created issue
        </button>
      </section>
    ) : null,
);

vi.mock("@/components/issues/IssueCreateDialog", () => ({
  IssueCreateDialog: (props: Parameters<typeof issueCreateDialog>[0]) => issueCreateDialog(props),
}));

const issueSessionPickerDialog = vi.fn(
  ({
    projectSlug,
    open,
    onOpenChange,
  }: {
    projectSlug: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <section aria-label="mock issue session picker">
        <p>project:{projectSlug}</p>
        <button type="button" onClick={() => onOpenChange?.(false)}>
          close picker
        </button>
      </section>
    ) : null,
);

vi.mock("@/components/sessions/IssueSessionPickerDialog", () => ({
  IssueSessionPickerDialog: (props: Parameters<typeof issueSessionPickerDialog>[0]) =>
    issueSessionPickerDialog(props),
}));

describe("NewIssueMenu", () => {
  beforeEach(() => {
    issueCreateDialog.mockClear();
    issueSessionPickerDialog.mockClear();
  });

  it("navigates to the assistant new issue route from the primary action", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route
            path="/projects/macro-markets/board"
            element={<NewIssueMenu projectSlug="macro-markets" />}
          />
          <Route path="/projects/macro-markets/assistant/new-issue" element={<div>Assistant issue authoring</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: "New issue" }));

    expect(await screen.findByText("Assistant issue authoring")).toBeInTheDocument();
  });

  it("opens quick create from the menu with the seeded status", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <NewIssueMenu projectSlug="macro-markets" status="In Progress" />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "New issue options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Quick create" }));

    expect(screen.getByRole("region", { name: "mock quick create dialog" })).toBeInTheDocument();
    expect(screen.getByText("project:macro-markets")).toBeInTheDocument();
    expect(screen.getByText("status:In Progress")).toBeInTheDocument();
  });

  it("opens the project sessions page from the menu", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route
            path="/projects/macro-markets/board"
            element={<NewIssueMenu projectSlug="macro-markets" />}
          />
          <Route path="/projects/macro-markets/workspaces" element={<div>Project sessions</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "New issue options" }));
    await user.click(await screen.findByRole("menuitem", { name: "New project session" }));

    expect(await screen.findByText("Project sessions")).toBeInTheDocument();
  });

  it("opens the issue session picker from the menu", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <NewIssueMenu projectSlug="macro-markets" />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "New issue options" }));
    await user.click(await screen.findByRole("menuitem", { name: "New issue session" }));

    expect(screen.getByRole("region", { name: "mock issue session picker" })).toBeInTheDocument();
    expect(screen.getByText("project:macro-markets")).toBeInTheDocument();
  });

  it("opens the project terminal from the menu", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route
            path="/projects/macro-markets/board"
            element={<NewIssueMenu projectSlug="macro-markets" />}
          />
          <Route path="/projects/macro-markets/terminal" element={<div>Project terminal</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "New issue options" }));
    await user.click(await screen.findByRole("menuitem", { name: "New project terminal" }));

    expect(await screen.findByText("Project terminal")).toBeInTheDocument();
  });

  it("exposes assistant and quick create from the icon variant", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route
            path="/projects/macro-markets/board"
            element={<NewIssueMenu projectSlug="macro-markets" status="Backlog" variant="icon" />}
          />
          <Route path="/projects/macro-markets/assistant/new-issue" element={<div>Assistant issue authoring</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Add issue to Backlog" }));

    expect(await screen.findByRole("menuitem", { name: "New issue with assistant" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Quick create" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "New issue with assistant" }));

    expect(await screen.findByText("Assistant issue authoring")).toBeInTheDocument();
  });

  it("opens quick create from the dashed empty-state variant", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <NewIssueMenu projectSlug="macro-markets" status="Backlog" variant="dashed" />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Add issue to Backlog" }));
    await user.click(await screen.findByRole("menuitem", { name: "Quick create" }));

    expect(screen.getByRole("region", { name: "mock quick create dialog" })).toBeInTheDocument();
    expect(screen.getByText("status:Backlog")).toBeInTheDocument();
  });

  it("invokes onCreated and closes the quick create dialog after creation", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();

    render(
      <MemoryRouter>
        <NewIssueMenu projectSlug="macro-markets" status="In Progress" onCreated={onCreated} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "New issue options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Quick create" }));
    await user.click(screen.getByRole("button", { name: "emit created issue" }));

    expect(onCreated).toHaveBeenCalledWith(createdIssue);
    expect(screen.queryByRole("region", { name: "mock quick create dialog" })).toBeNull();
  });
});
