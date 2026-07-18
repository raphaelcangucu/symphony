import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarContextMenu } from "@/components/layout/sidebar/SidebarContextMenu";
import type { SidebarActionResult } from "@/hooks/useSidebarActions";
import { initTestI18n } from "@/i18n/testUtils";
import { getIssueFormOptions } from "@/services/issues";
import type {
  SidebarCapabilityContext,
  SidebarNode,
  SidebarProjectNode,
  SidebarSessionNode,
  SidebarWorkspaceNode,
} from "@/types/sidebar";

const CONTEXT: SidebarCapabilityContext = {
  editorTarget: "vscode://file/tmp/acme",
  terminalTarget: "/tmp/acme",
  workspacePath: "/tmp/acme",
  branchName: "feature/acme",
  workspaceRemovable: true,
  issueCapabilities: { canRename: true, canManageLabels: true },
  threadCapabilities: {
    canRename: true,
    canManageLabels: true,
    canReview: true,
    canArchive: true,
    canDelete: true,
    local: true,
    active: false,
    closed: true,
  },
};

function project(overrides: Partial<SidebarProjectNode> = {}): SidebarProjectNode {
  return {
    kind: "project",
    id: "acme",
    projectSlug: "acme",
    title: "Acme",
    subtitle: "",
    href: "/projects/acme/board",
    archived: false,
    aggregateStatus: "idle",
    updatedAt: "",
    loadState: "ready",
    error: null,
    sessions: [],
    overflowSessions: [],
    nextCursor: null,
    workspaces: [],
    overflowWorkspaces: [],
    unassignedSessions: [],
    pinned: false,
    ...overrides,
  };
}

function workspace(overrides: Partial<SidebarWorkspaceNode> = {}): SidebarWorkspaceNode {
  return {
    kind: "workspace",
    id: "workspace:acme:standalone",
    projectSlug: "acme",
    workspaceKind: "standalone",
    title: "Workbench",
    subtitle: "",
    href: "/projects/acme/workspaces",
    branchSummary: "feature/acme",
    aggregateStatus: "idle",
    updatedAt: "",
    inventory: null,
    issueIdentifier: null,
    sessions: [],
    overflowSessions: [],
    pinned: false,
    ...overrides,
  };
}

function session(overrides: Partial<SidebarSessionNode> = {}): SidebarSessionNode {
  return {
    kind: "session",
    id: "thread:7",
    projectSlug: "acme",
    workspaceId: "workspace:acme:standalone",
    sessionKind: "chat",
    title: "Review API",
    subtitle: "",
    href: "/projects/acme/workspaces/7",
    statusKind: "closed",
    aggregateStatus: "idle",
    agentKind: "claude",
    updatedAt: "",
    threadId: 7,
    issueIdentifier: null,
    archived: true,
    unread: false,
    needsReview: true,
    labels: ["bug"],
    issueLabelNames: null,
    pinned: false,
    ...overrides,
  };
}

function Harness({
  node,
  context = CONTEXT,
  runAction = vi.fn().mockResolvedValue({ ok: true }),
  loadOptions = vi.fn().mockResolvedValue({
    labels: [
      { id: "L1", name: "Bug", color: null },
      { id: "L2", name: "UI", color: null },
    ],
    assignees: [],
    statuses: [],
    agents: [],
    effectiveAgent: "codex",
  }),
  onCommittedWarning,
}: {
  node: SidebarNode;
  context?: SidebarCapabilityContext;
  runAction?: (request: never) => Promise<SidebarActionResult>;
  loadOptions?: typeof getIssueFormOptions;
  onCommittedWarning?: (warning: string) => void;
}) {
  return (
    <div
      role="treeitem"
      tabIndex={0}
      data-sidebar-tree-row-id={node.id}
      aria-label={node.title}
    >
      <SidebarContextMenu
        node={node}
        capabilityContext={context}
        loadIssueFormOptions={loadOptions}
        onRunAction={runAction}
        onUtilityAction={vi.fn()}
        onCommittedWarning={onCommittedWarning ?? vi.fn()}
      >
        <button
          type="button"
          tabIndex={-1}
          data-sidebar-tree-owner-id={node.id}
          aria-label={`More actions for ${node.title}`}
        >
          More
        </button>
      </SidebarContextMenu>
    </div>
  );
}

function openMenu(label: string) {
  fireEvent.pointerDown(screen.getByRole("button", { name: label }));
}

describe("SidebarContextMenu", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [
      project(),
      [
        "New workspace",
        "New session",
        "Open board",
        "Open docs",
        "Open settings",
        "Rename",
        "Archive",
        "Remove",
      ],
    ],
    [
      workspace(),
      [
        "New session",
        "Open in editor",
        "Open terminal",
        "Pin",
        "Rename",
        "Copy branch",
        "Copy path",
        "Remove workspace",
      ],
    ],
    [
      session(),
      [
        "Rename",
        "Manage labels",
        "Generate name",
        "Remove review marker",
        "Pin",
        "Archive",
        "Delete",
      ],
    ],
    [
      session({
        id: "exec:ACME-1",
        sessionKind: "execution",
        statusKind: "done",
        aggregateStatus: "idle",
        threadId: null,
        issueIdentifier: "ACME-1",
        needsReview: false,
        archived: false,
      }),
      ["Copy resume link", "Pin", "Archive", "Remove"],
    ],
  ] as const)("renders immutable capability order and one destructive separator", (node, labels) => {
    render(<Harness node={node} />);
    openMenu(`More actions for ${node.title}`);
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(labels);
    expect(within(menu).getAllByRole("separator")).toHaveLength(1);
  });

  it("exposes disabled reasons and refuses disabled dispatch", async () => {
    const onRunAction = vi.fn();
    render(
      <Harness
        node={workspace()}
        context={{ ...CONTEXT, editorTarget: null }}
        runAction={onRunAction}
      />,
    );
    openMenu("More actions for Workbench");
    const item = screen.getByRole("menuitem", { name: "Open in editor" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item.getAttribute("title")?.trim()).not.toBe("");
    fireEvent.click(item);
    expect(onRunAction).not.toHaveBeenCalled();
  });

  it.each([
    [false, "Mark for review", true],
    [true, "Remove review marker", false],
  ] as const)(
    "renders and submits the review-only toggle for needsReview=%s without stale labels",
    async (needsReview, actionLabel, expectedNeedsReview) => {
      const onRunAction = vi.fn().mockResolvedValue({ ok: true });
      render(
        <Harness
          node={session({ needsReview })}
          runAction={onRunAction}
        />,
      );
      openMenu("More actions for Review API");
      await userEvent.click(screen.getByRole("menuitem", { name: actionLabel }));
      expect(onRunAction).toHaveBeenCalledWith({
        action: "update-thread-review",
        projectSlug: "acme",
        threadId: 7,
        needsReview: expectedNeedsReview,
        canReview: true,
      });
      expect(onRunAction.mock.calls[0][0]).not.toHaveProperty("labels");
    },
  );

  it("anchors from pointer and Shift+F10 and restores focus after Escape and outside close", async () => {
    const triggerLabel = "More actions for Workbench";
    const { rerender } = render(<Harness node={workspace()} />);
    const owner = screen.getByRole("treeitem");
    const trigger = screen.getByRole("button", { name: triggerLabel });
    owner.focus();
    openMenu(triggerLabel);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveFocus();

    rerender(<Harness node={workspace()} />);
    owner.focus();
    fireEvent.keyDown(screen.getByRole("button", { name: triggerLabel }), {
      key: "F10",
      shiftKey: true,
    });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      fireEvent.pointerDown(owner, { button: 0, pointerType: "mouse" });
    });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("keeps focus out of the row while a dialog is open and returns it when closed", async () => {
    render(<Harness node={project()} />);
    const owner = screen.getByRole("treeitem");
    owner.focus();
    openMenu("More actions for Acme");
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(owner).not.toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "More actions for Acme" })).toHaveFocus();
  });

  it("validates rename blank and 120/160 boundaries and keeps service errors visible", async () => {
    const onRunAction = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, committed: false, error: "Rename failed" })
      .mockResolvedValue({ ok: true });
    const { unmount } = render(<Harness node={project()} runAction={onRunAction} />);
    openMenu("More actions for Acme");
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Name" });
    await userEvent.clear(input);
    await userEvent.type(input, " ");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "a".repeat(121));
    expect(screen.getByText(/120/)).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "Valid");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Rename failed");

    unmount();
    render(<Harness node={session()} runAction={vi.fn().mockResolvedValue({ ok: true })} />);
    openMenu("More actions for Review API");
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const threadTitle = screen.getByRole("textbox", { name: "Name" });
    await userEvent.clear(threadTitle);
    await userEvent.type(threadTitle, "a".repeat(161));
    expect(screen.getByText(/160/)).toBeInTheDocument();
  });

  it("enforces thread label count and grapheme boundaries before dispatch", async () => {
    const onRunAction = vi.fn().mockResolvedValue({ ok: true });
    const { unmount } = render(<Harness node={session()} runAction={onRunAction} />);
    openMenu("More actions for Review API");
    await userEvent.click(screen.getByRole("menuitem", { name: "Manage labels" }));
    const labels = screen.getByRole("textbox", { name: "Labels" });
    await userEvent.clear(labels);
    await userEvent.type(
      labels,
      Array.from({ length: 13 }, (_, index) => `label-${index}`).join(","),
    );
    expect(screen.getByText(/at most 12/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onRunAction).not.toHaveBeenCalled();

    unmount();
    render(<Harness node={session()} runAction={onRunAction} />);
    openMenu("More actions for Review API");
    await userEvent.click(screen.getByRole("menuitem", { name: "Manage labels" }));
    const longLabel = screen.getByRole("textbox", { name: "Labels" });
    await userEvent.clear(longLabel);
    await userEvent.type(longLabel, "a".repeat(41));
    expect(screen.getByText(/40/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("hides unauthorized review editing while preserving authoritative labels", async () => {
    const onRunAction = vi.fn().mockResolvedValue({ ok: true });
    render(
      <Harness
        node={session({ labels: ["server-state"], needsReview: true })}
        context={{
          ...CONTEXT,
          threadCapabilities: {
            ...CONTEXT.threadCapabilities!,
            canReview: false,
          },
        }}
        runAction={onRunAction}
      />,
    );
    openMenu("More actions for Review API");
    await userEvent.click(screen.getByRole("menuitem", { name: "Manage labels" }));
    expect(screen.queryByRole("checkbox", { name: "Needs review" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Labels" })).toHaveValue("server-state");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onRunAction).toHaveBeenCalledWith({
      action: "update-thread-metadata",
      projectSlug: "acme",
      threadId: 7,
      labels: ["server-state"],
      needsReview: null,
      canReview: false,
    });
  });

  it("does not treat unloaded metadata or failed issue options as empty", async () => {
    const { unmount } = render(<Harness node={session({ labels: null })} />);
    openMenu("More actions for Review API");
    await userEvent.click(screen.getByRole("menuitem", { name: "Manage labels" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/not loaded/i);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    unmount();
    render(
      <Harness
        node={session({
          issueIdentifier: "ACME-1",
          issueLabelNames: ["Bug"],
        })}
        loadOptions={vi.fn().mockRejectedValue(new Error("offline"))}
      />,
    );
    openMenu("More actions for Review API");
    await userEvent.click(screen.getByRole("menuitem", { name: "Manage labels" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("preserves explicit empty thread labels and false review and supports issue IDs", async () => {
    const onRunAction = vi.fn().mockResolvedValue({ ok: true });
    const { unmount } = render(<Harness node={session()} runAction={onRunAction} />);
    openMenu("More actions for Review API");
    await userEvent.click(screen.getByRole("menuitem", { name: "Manage labels" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Labels" }));
    const review = screen.getByRole("checkbox", { name: "Needs review" });
    if (review.matches(":checked")) await userEvent.click(review);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onRunAction).toHaveBeenCalledWith({
      action: "update-thread-metadata",
      projectSlug: "acme",
      threadId: 7,
      labels: [],
      needsReview: false,
      canReview: true,
    });
    expect(onRunAction).toHaveBeenCalledTimes(1);

    unmount();
    const issueRun = vi.fn().mockResolvedValue({ ok: true });
    render(
      <Harness
        node={session({
          issueIdentifier: "ACME-1",
          issueLabelNames: ["Bug"],
          threadId: 7,
        })}
        runAction={issueRun}
      />,
    );
    openMenu("More actions for Review API");
    await userEvent.click(screen.getByRole("menuitem", { name: "Manage labels" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "UI" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Needs review" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(issueRun).toHaveBeenCalledWith({
      action: "update-issue-thread-metadata",
      projectSlug: "acme",
      identifier: "ACME-1",
      labelIds: ["L1", "L2"],
      threadId: 7,
      needsReview: false,
      canReview: true,
    });
    expect(issueRun).toHaveBeenCalledTimes(1);
  });

  it("requires explicit archive confirmation and exact case-sensitive names for removals", async () => {
    const archiveRun = vi.fn().mockResolvedValue({ ok: true });
    const { unmount } = render(<Harness node={project()} runAction={archiveRun} />);
    openMenu("More actions for Acme");
    await userEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(archiveRun).toHaveBeenCalledWith({
      action: "archive-project",
      projectSlug: "acme",
    });
    openMenu("More actions for Acme");
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Type Acme to confirm" }),
      "Acme",
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(archiveRun).toHaveBeenCalledWith({
      action: "remove-project",
      projectSlug: "acme",
      archived: false,
      canArchive: true,
    });

    unmount();
    const removeRun = vi.fn().mockResolvedValue({ ok: true });
    render(
      <Harness
        node={project({ archived: true })}
        runAction={removeRun}
      />,
    );
    openMenu("More actions for Acme");
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    const confirmation = screen.getByRole("textbox", { name: "Type Acme to confirm" });
    await userEvent.type(confirmation, "acme");
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    await userEvent.clear(confirmation);
    await userEvent.type(confirmation, " Acme ");
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeRun).toHaveBeenCalledTimes(1);
  });

  it("allows active chat archive by capability and blocks active execution archive", async () => {
    const chatRun = vi.fn().mockResolvedValue({ ok: true });
    const { unmount } = render(
      <Harness
        node={session({ statusKind: "active", archived: false })}
        context={{
          ...CONTEXT,
          threadCapabilities: {
            ...CONTEXT.threadCapabilities!,
            active: true,
            canArchive: true,
          },
        }}
        runAction={chatRun}
      />,
    );
    openMenu("More actions for Review API");
    await userEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(chatRun).toHaveBeenCalledWith({
      action: "archive-thread",
      projectSlug: "acme",
      threadId: 7,
      canArchive: true,
    });

    unmount();
    const executionRun = vi.fn();
    render(
      <Harness
        node={session({
          id: "exec:ACME-1",
          sessionKind: "execution",
          statusKind: "active",
          aggregateStatus: "active",
          threadId: null,
          issueIdentifier: "ACME-1",
        })}
        runAction={executionRun}
      />,
    );
    openMenu("More actions for Review API");
    const archive = screen.getByRole("menuitem", { name: "Archive" });
    expect(archive).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(archive);
    expect(executionRun).not.toHaveBeenCalled();
  });

  it("prevents repeat confirmation and leaves mutation errors visible", async () => {
    let resolve!: (result: SidebarActionResult) => void;
    const onRunAction = vi.fn(
      () =>
        new Promise<SidebarActionResult>((done) => {
          resolve = done;
        }),
    );
    render(<Harness node={session()} runAction={onRunAction} />);
    openMenu("More actions for Review API");
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Type Review API to confirm" }),
      "Review API",
    );
    const submit = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onRunAction).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
    resolve({ ok: false, committed: false, error: "Delete failed" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Delete failed");
  });

  it("closes committed destructive warnings without allowing resubmission", async () => {
    const warning = vi.fn();
    const onRunAction = vi.fn().mockResolvedValue({
      ok: false,
      committed: true,
      warning: "Archived, but removal failed.",
    });
    render(
      <Harness
        node={project({ archived: true })}
        runAction={onRunAction}
        onCommittedWarning={warning}
      />,
    );
    const trigger = screen.getByRole("button", { name: "More actions for Acme" });
    openMenu("More actions for Acme");
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Type Acme to confirm" }),
      "Acme",
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(warning).toHaveBeenCalledWith("Archived, but removal failed.");
    expect(onRunAction).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
  });

  it.each(["Copy branch", "Pin", "Open in editor"])(
    "keeps failed %s direct actions open with an accessible retry error",
    async (actionLabel) => {
    const onRunAction = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        committed: false,
        error: "Action unavailable. Try again.",
      })
      .mockResolvedValueOnce({ ok: true });
    render(<Harness node={workspace()} runAction={onRunAction} />);
    const trigger = screen.getByRole("button", { name: "More actions for Workbench" });
    openMenu("More actions for Workbench");
    await userEvent.click(screen.getByRole("menuitem", { name: actionLabel }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Action unavailable. Try again.",
    );
    expect(screen.getByRole("menu")).not.toContainElement(alert);
    await userEvent.click(screen.getByRole("menuitem", { name: actionLabel }));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(onRunAction).toHaveBeenCalledTimes(2);
    expect(trigger).toHaveFocus();
    },
  );

  it("fails closed for malformed nodes and capabilities", () => {
    render(
      <Harness
        node={{ ...project(), archived: "no" } as never}
        context={{ ...CONTEXT, threadCapabilities: { canDelete: true } } as never}
      />,
    );
    openMenu("More actions for Acme");
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("renders Task 9 actions and dialog controls from the pt-BR locale", async () => {
    await initTestI18n("pt-BR");
    render(<Harness node={project()} />);
    openMenu("More actions for Acme");
    expect(screen.getByRole("menuitem", { name: "Arquivar" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Remover" }));
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
  });
});
