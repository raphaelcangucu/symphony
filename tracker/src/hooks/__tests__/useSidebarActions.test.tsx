import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type SidebarActionRequest,
  useSidebarActions,
} from "@/hooks/useSidebarActions";
import { initTestI18n } from "@/i18n/testUtils";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  archiveAssistantThread,
  deleteAssistantThread,
  updateAssistantThread,
} from "@/services/assistantThreads";
import { archiveIssue, deleteIssue, updateIssue } from "@/services/issues";
import {
  archiveProject,
  deleteProject,
  restoreProject,
  updateProject,
} from "@/services/projects";
import {
  removeWorkspaces,
  updateWorkspaceDisplayName,
} from "@/services/worktrees";

vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: vi.fn() }));
vi.mock("@/services/assistantThreads", () => ({
  archiveAssistantThread: vi.fn(),
  deleteAssistantThread: vi.fn(),
  updateAssistantThread: vi.fn(),
}));
vi.mock("@/services/issues", () => ({
  archiveIssue: vi.fn(),
  deleteIssue: vi.fn(),
  updateIssue: vi.fn(),
}));
vi.mock("@/services/projects", () => ({
  archiveProject: vi.fn(),
  deleteProject: vi.fn(),
  restoreProject: vi.fn(),
  updateProject: vi.fn(),
}));
vi.mock("@/services/worktrees", () => ({
  removeWorkspaces: vi.fn(),
  updateWorkspaceDisplayName: vi.fn(),
}));

const services = {
  archiveAssistantThread: vi.mocked(archiveAssistantThread),
  deleteAssistantThread: vi.mocked(deleteAssistantThread),
  updateAssistantThread: vi.mocked(updateAssistantThread),
  archiveIssue: vi.mocked(archiveIssue),
  deleteIssue: vi.mocked(deleteIssue),
  updateIssue: vi.mocked(updateIssue),
  archiveProject: vi.mocked(archiveProject),
  deleteProject: vi.mocked(deleteProject),
  restoreProject: vi.mocked(restoreProject),
  updateProject: vi.mocked(updateProject),
  removeWorkspaces: vi.mocked(removeWorkspaces),
  updateWorkspaceDisplayName: vi.mocked(updateWorkspaceDisplayName),
  copyTextToClipboard: vi.mocked(copyTextToClipboard),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const onProjectChanged = vi.fn().mockResolvedValue(undefined);
  const onPreferenceAction = vi.fn().mockResolvedValue(undefined);
  const onCallbackAction = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() =>
    useSidebarActions({
      onProjectChanged,
      onPreferenceAction,
      onCallbackAction,
    }),
  );
  return { ...hook, onProjectChanged, onPreferenceAction, onCallbackAction };
}

async function run(
  result: ReturnType<typeof setup>["result"],
  request: SidebarActionRequest,
) {
  let response!: Awaited<ReturnType<typeof result.current.runAction>>;
  await act(async () => {
    response = await result.current.runAction(request);
  });
  return response;
}

describe("useSidebarActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const service of Object.values(services)) service.mockResolvedValue(undefined as never);
    services.copyTextToClipboard.mockResolvedValue(true);
    services.removeWorkspaces.mockResolvedValue([
      { path: "/tmp/acme", status: "removed", reason: null },
    ]);
  });

  it.each([
    [
      { action: "rename-project", projectSlug: " acme ", name: " New name " },
      services.updateProject,
      ["acme", { name: "New name" }],
    ],
    [
      { action: "archive-project", projectSlug: "acme" },
      services.archiveProject,
      ["acme"],
    ],
    [
      { action: "restore-project", projectSlug: "acme" },
      services.restoreProject,
      ["acme"],
    ],
    [
      {
        action: "rename-workspace",
        projectSlug: "acme",
        path: "/tmp/acme",
        name: "Workbench",
        workspaceKind: "standalone",
      },
      services.updateWorkspaceDisplayName,
      ["acme", "/tmp/acme", "Workbench"],
    ],
    [
      {
        action: "rename-thread",
        projectSlug: "acme",
        threadId: 7,
        title: "Thread",
      },
      services.updateAssistantThread,
      [7, { title: "Thread" }],
    ],
    [
      {
        action: "update-thread-metadata",
        projectSlug: "acme",
        threadId: 7,
        labels: [" bug ", "bug", " ui "],
        needsReview: false,
        canReview: true,
      },
      services.updateAssistantThread,
      [7, { labels: ["bug", "ui"], needsReview: false }],
    ],
    [
      {
        action: "update-thread-review",
        projectSlug: "acme",
        threadId: 7,
        needsReview: true,
        canReview: true,
      },
      services.updateAssistantThread,
      [7, { needsReview: true }],
    ],
    [
      {
        action: "archive-thread",
        projectSlug: "acme",
        threadId: 7,
        canArchive: true,
      },
      services.archiveAssistantThread,
      [7],
    ],
    [
      {
        action: "delete-thread",
        projectSlug: "acme",
        threadId: 7,
        sessionKind: "chat",
        local: true,
        archived: false,
        closed: false,
      },
      services.deleteAssistantThread,
      [7],
    ],
    [
      {
        action: "rename-issue",
        projectSlug: "acme",
        identifier: "ACME-1",
        title: "Issue",
      },
      services.updateIssue,
      ["acme", "ACME-1", { title: "Issue" }],
    ],
    [
      {
        action: "update-issue-labels",
        projectSlug: "acme",
        identifier: "ACME-1",
        labelIds: [" L1 ", "L1", "L2"],
      },
      services.updateIssue,
      ["acme", "ACME-1", { labelIds: ["L1", "L2"] }],
    ],
    [
      {
        action: "archive-issue",
        projectSlug: "acme",
        identifier: "ACME-1",
        active: false,
      },
      services.archiveIssue,
      ["acme", "ACME-1"],
    ],
    [
      {
        action: "delete-issue",
        projectSlug: "acme",
        identifier: "ACME-1",
        active: false,
      },
      services.deleteIssue,
      ["acme", "ACME-1"],
    ],
  ] as const)(
    "dispatches %s and refreshes the affected project once",
    async (request, service, expectedArguments) => {
      const { result, onProjectChanged } = setup();
      expect(await run(result, request as SidebarActionRequest)).toEqual({ ok: true });
      expect(service).toHaveBeenCalledWith(...expectedArguments);
      expect(onProjectChanged).toHaveBeenCalledTimes(1);
      expect(onProjectChanged).toHaveBeenCalledWith("acme");
    },
  );

  it("removes an archived project without archiving again", async () => {
    const { result, onProjectChanged } = setup();
    expect(
      await run(result, {
        action: "remove-project",
        projectSlug: "acme",
        archived: true,
        canArchive: false,
      }),
    ).toEqual({ ok: true });
    expect(services.archiveProject).not.toHaveBeenCalled();
    expect(services.deleteProject).toHaveBeenCalledWith("acme");
    expect(onProjectChanged).toHaveBeenCalledTimes(1);
  });

  it("archives an explicitly unarchived project before removing it", async () => {
    const { result } = setup();
    expect(
      await run(result, {
        action: "remove-project",
        projectSlug: "acme",
        archived: false,
        canArchive: true,
      }),
    ).toEqual({ ok: true });
    expect(services.archiveProject.mock.invocationCallOrder[0]).toBeLessThan(
      services.deleteProject.mock.invocationCallOrder[0],
    );
  });

  it("returns truthful partial failure and refreshes once when project deletion fails after archive", async () => {
    services.deleteProject.mockRejectedValue(new Error("delete failed"));
    const { result, onProjectChanged } = setup();
    expect(
      await run(result, {
        action: "remove-project",
        projectSlug: "acme",
        archived: false,
        canArchive: true,
      }),
    ).toEqual({
      ok: false,
      committed: true,
      warning: "The project was archived, but removal failed: delete failed",
    });
    expect(onProjectChanged).toHaveBeenCalledTimes(1);
  });

  it("preserves archive/remove partial facts before a refresh warning", async () => {
    services.deleteProject.mockRejectedValue(new Error("delete failed"));
    const { result, onProjectChanged } = setup();
    onProjectChanged.mockRejectedValue(new Error("refresh failed"));
    const response = await run(result, {
      action: "remove-project",
      projectSlug: "acme",
      archived: false,
      canArchive: true,
    });
    expect(response).toEqual({
      ok: false,
      committed: true,
      warning:
        "The project was archived, but removal failed: delete failed The change was saved, but the sidebar could not refresh: refresh failed",
    });
    expect(onProjectChanged).toHaveBeenCalledTimes(1);
    expect(response).not.toHaveProperty("error");
  });

  it("updates issue labels and thread review as one composite action with one refresh", async () => {
    const { result, onProjectChanged } = setup();
    expect(
      await run(result, {
        action: "update-issue-thread-metadata",
        projectSlug: "acme",
        identifier: "ACME-1",
        labelIds: [" L1 ", "L1", "L2"],
        threadId: 7,
        needsReview: false,
        canReview: true,
      }),
    ).toEqual({ ok: true });
    expect(services.updateIssue).toHaveBeenCalledWith("acme", "ACME-1", {
      labelIds: ["L1", "L2"],
    });
    expect(services.updateAssistantThread).toHaveBeenCalledWith(7, {
      needsReview: false,
    });
    expect(onProjectChanged).toHaveBeenCalledTimes(1);
  });

  it("returns partial composite failure and refreshes exactly once", async () => {
    services.updateAssistantThread.mockRejectedValue(new Error("review failed"));
    const { result, onProjectChanged } = setup();
    expect(
      await run(result, {
        action: "update-issue-thread-metadata",
        projectSlug: "acme",
        identifier: "ACME-1",
        labelIds: [],
        threadId: 7,
        needsReview: false,
        canReview: true,
      }),
    ).toEqual({
      ok: false,
      committed: true,
      warning: "Issue labels were saved, but review state failed: review failed",
    });
    expect(onProjectChanged).toHaveBeenCalledTimes(1);
  });

  it("preserves labels/review partial facts before a refresh warning", async () => {
    services.updateAssistantThread.mockRejectedValue(new Error("review failed"));
    const { result, onProjectChanged } = setup();
    onProjectChanged.mockRejectedValue(new Error("refresh failed"));
    const response = await run(result, {
      action: "update-issue-thread-metadata",
      projectSlug: "acme",
      identifier: "ACME-1",
      labelIds: ["L1"],
      threadId: 7,
      needsReview: false,
      canReview: true,
    });
    expect(response).toEqual({
      ok: false,
      committed: true,
      warning:
        "Issue labels were saved, but review state failed: review failed The change was saved, but the sidebar could not refresh: refresh failed",
    });
    expect(onProjectChanged).toHaveBeenCalledTimes(1);
    expect(response).not.toHaveProperty("error");
  });

  it("removes only a removable non-main workspace", async () => {
    const { result } = setup();
    expect(
      await run(result, {
        action: "remove-workspace",
        projectSlug: "acme",
        path: "/tmp/acme",
        workspaceKind: "standalone",
        removable: true,
      }),
    ).toEqual({ ok: true });
    expect(services.removeWorkspaces).toHaveBeenCalledWith("acme", ["/tmp/acme"]);
  });

  it("routes copy, pin/read preferences, and host callbacks without refreshing", async () => {
    const { result, onProjectChanged, onPreferenceAction, onCallbackAction } = setup();
    expect(await run(result, { action: "copy", value: "resume://ACME-1" })).toEqual({
      ok: true,
    });
    expect(
      await run(result, {
        action: "set-pinned",
        nodeKind: "session",
        nodeId: "thread:7",
        pinned: true,
      }),
    ).toEqual({ ok: true });
    expect(
      await run(result, {
        action: "mark-read",
        sessionId: "thread:7",
        readAt: "2026-07-13T12:00:00Z",
      }),
    ).toEqual({ ok: true });
    expect(
      await run(result, {
        action: "callback",
        callback: "open-terminal",
        value: "/tmp/acme",
      }),
    ).toEqual({ ok: true });
    expect(onPreferenceAction).toHaveBeenCalledTimes(2);
    expect(onCallbackAction).toHaveBeenCalledWith({
      callback: "open-terminal",
      value: "/tmp/acme",
    });
    expect(onProjectChanged).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: "rename-project", projectSlug: "", name: "Name" }, /projectSlug/],
    [{ action: "rename-project", projectSlug: "acme", name: " " }, /name/],
    [{ action: "rename-project", projectSlug: "acme", name: "a".repeat(121) }, /120/],
    [
      {
        action: "rename-workspace",
        projectSlug: "acme",
        path: "relative",
        name: "Name",
        workspaceKind: "standalone",
      },
      /absolute/,
    ],
    [
      {
        action: "rename-workspace",
        projectSlug: "acme",
        path: "/tmp",
        name: "Name",
        workspaceKind: "project",
      },
      /main workspace/,
    ],
    [
      {
        action: "remove-workspace",
        projectSlug: "acme",
        path: "/tmp",
        workspaceKind: "project",
        removable: true,
      },
      /main workspace/,
    ],
    [
      {
        action: "delete-thread",
        projectSlug: "acme",
        threadId: 7,
        sessionKind: "execution",
        local: true,
        archived: true,
        closed: true,
      },
      /execution/,
    ],
    [
      {
        action: "delete-thread",
        projectSlug: "acme",
        threadId: 7,
        sessionKind: "chat",
        local: false,
        archived: true,
        closed: true,
      },
      /local/,
    ],
    [
      {
        action: "update-thread-review",
        projectSlug: "acme",
        threadId: 7,
        needsReview: true,
        canReview: false,
      },
      /not authorized/,
    ],
    [{ action: "copy", value: " " }, /value/],
    [
      {
        action: "remove-project",
        projectSlug: "acme",
        archived: false,
        canArchive: false,
      },
      /archive capability/,
    ],
  ] as const)("rejects invalid or forbidden request %s", async (request, message) => {
    const { result, onProjectChanged } = setup();
    const response = await run(result, request as SidebarActionRequest);
    expect(response).toMatchObject({ ok: false, error: expect.stringMatching(message) });
    expect(onProjectChanged).not.toHaveBeenCalled();
    expect(Object.values(services).every((service) => service.mock.calls.length === 0)).toBe(true);
  });

  it("rejects malformed objects and unsupported keys before dispatch", async () => {
    const { result } = setup();
    const malformed = Object.assign(Object.create({ inherited: true }), {
      action: "copy",
      value: "x",
    });
    expect(await run(result, malformed)).toMatchObject({ ok: false });
    expect(
      await run(result, { action: "copy", value: "x", extra: true } as never),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/unsupported/i) });
    expect(await run(result, { action: "unknown" } as never)).toMatchObject({ ok: false });
  });

  it("localizes committed partial and authorization validation outcomes in pt-BR", async () => {
    await initTestI18n("pt-BR");
    services.deleteProject.mockRejectedValue(new Error("disk"));
    const partial = setup();
    expect(
      await run(partial.result, {
        action: "remove-project",
        projectSlug: "acme",
        archived: false,
        canArchive: true,
      }),
    ).toEqual({
      ok: false,
      committed: true,
      warning: "O projeto foi arquivado, mas a remoção falhou: disk",
    });

    const validation = setup();
    expect(
      await run(validation.result, {
        action: "update-thread-review",
        projectSlug: "acme",
        threadId: 7,
        needsReview: true,
        canReview: false,
      }),
    ).toEqual({
      ok: false,
      committed: false,
      error: "Alterações de revisão não são autorizadas.",
    });
  });

  it("returns clipboard and service errors without refresh", async () => {
    services.copyTextToClipboard.mockResolvedValue(false);
    const first = setup();
    expect(await run(first.result, { action: "copy", value: "x" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/clipboard/i),
    });
    services.updateProject.mockRejectedValue(new Error("network down"));
    const second = setup();
    expect(
      await run(second.result, {
        action: "rename-project",
        projectSlug: "acme",
        name: "Name",
      }),
    ).toEqual({ ok: false, committed: false, error: "network down" });
    expect(second.onProjectChanged).not.toHaveBeenCalled();
  });

  it("does not leak the clipboard fallback textarea when copying throws", async () => {
    const actualClipboard = await vi.importActual<typeof import("@/lib/clipboard")>(
      "@/lib/clipboard",
    );
    const previousExecCommand = document.execCommand;
    document.execCommand = vi.fn(() => {
      throw new Error("copy blocked");
    });
    try {
      expect(await actualClipboard.copyTextToClipboard("private")).toBe(false);
      expect(document.querySelectorAll("textarea")).toHaveLength(0);
    } finally {
      document.execCommand = previousExecCommand;
    }
  });

  it("returns committed refresh warning after a successful mutation", async () => {
    const { result, onProjectChanged } = setup();
    onProjectChanged.mockRejectedValue(new Error("refresh offline"));
    expect(
      await run(result, {
        action: "rename-project",
        projectSlug: "acme",
        name: "Renamed",
      }),
    ).toEqual({
      ok: false,
      committed: true,
      warning:
        "The change was saved, but the sidebar could not refresh: refresh offline",
    });
    expect(services.updateProject).toHaveBeenCalledTimes(1);
    expect(onProjectChanged).toHaveBeenCalledTimes(1);
  });

  it("returns pending for a duplicate stable action/node key and makes one call", async () => {
    let resolve!: () => void;
    services.updateProject.mockReturnValue(
      new Promise((done) => {
        resolve = () => done(undefined as never);
      }),
    );
    const { result } = setup();
    let first!: ReturnType<typeof result.current.runAction>;
    act(() => {
      first = result.current.runAction({
        action: "rename-project",
        projectSlug: "acme",
        name: "First",
      });
    });
    expect(result.current.pendingKey).toBe("rename-project:acme");
    expect(
      await result.current.runAction({
        action: "rename-project",
        projectSlug: "acme",
        name: "Second",
      }),
    ).toEqual({
      ok: false,
      committed: false,
      pending: true,
      error: "Action is already pending.",
    });
    expect(services.updateProject).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve();
      await first;
    });
    expect(result.current.pendingKey).toBeNull();
  });

  it("keeps the second key pending when the first concurrent action completes first", async () => {
    const rename = deferred<unknown>();
    const archive = deferred<unknown>();
    services.updateProject.mockReturnValue(rename.promise as never);
    services.archiveProject.mockReturnValue(archive.promise as never);
    const { result } = setup();
    let first!: ReturnType<typeof result.current.runAction>;
    let second!: ReturnType<typeof result.current.runAction>;
    act(() => {
      first = result.current.runAction({
        action: "rename-project",
        projectSlug: "acme",
        name: "Renamed",
      });
      second = result.current.runAction({
        action: "archive-project",
        projectSlug: "beta",
      });
    });
    expect(result.current.pendingKey).toBe("rename-project:acme");

    await act(async () => {
      rename.resolve(undefined);
      await first;
    });
    expect(result.current.pendingKey).toBe("archive-project:beta");
    expect(
      await result.current.runAction({
        action: "archive-project",
        projectSlug: "beta",
      }),
    ).toEqual({
      ok: false,
      committed: false,
      pending: true,
      error: "Action is already pending.",
    });
    expect(services.archiveProject).toHaveBeenCalledTimes(1);

    await act(async () => {
      archive.resolve(undefined);
      await second;
    });
    expect(result.current.pendingKey).toBeNull();
  });

  it("keeps the first key pending when the second concurrent action completes first", async () => {
    const rename = deferred<unknown>();
    const archive = deferred<unknown>();
    services.updateProject.mockReturnValue(rename.promise as never);
    services.archiveProject.mockReturnValue(archive.promise as never);
    const { result } = setup();
    let first!: ReturnType<typeof result.current.runAction>;
    let second!: ReturnType<typeof result.current.runAction>;
    act(() => {
      first = result.current.runAction({
        action: "rename-project",
        projectSlug: "acme",
        name: "Renamed",
      });
      second = result.current.runAction({
        action: "archive-project",
        projectSlug: "beta",
      });
    });

    await act(async () => {
      archive.resolve(undefined);
      await second;
    });
    expect(result.current.pendingKey).toBe("rename-project:acme");

    await act(async () => {
      rename.resolve(undefined);
      await first;
    });
    expect(result.current.pendingKey).toBeNull();
  });

  it("allows different copy values concurrently without exposing either value in pending keys", async () => {
    const resolvers: Array<(value: boolean) => void> = [];
    services.copyTextToClipboard.mockImplementation(
      () => new Promise<boolean>((resolve) => resolvers.push(resolve)),
    );
    const { result } = setup();
    let first!: ReturnType<typeof result.current.runAction>;
    let second!: ReturnType<typeof result.current.runAction>;
    act(() => {
      first = result.current.runAction({ action: "copy", value: "secret-one" });
      second = result.current.runAction({ action: "copy", value: "secret-two" });
    });
    expect(services.copyTextToClipboard).toHaveBeenCalledTimes(2);
    expect(result.current.pendingKey ?? "").not.toContain("secret");
    await act(async () => {
      resolvers.forEach((resolve) => resolve(true));
      await Promise.all([first, second]);
    });
  });

  it("deduplicates identical concurrent copies without exposing the copied value", async () => {
    let resolve!: (value: boolean) => void;
    services.copyTextToClipboard.mockReturnValue(
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    const { result } = setup();
    const first = result.current.runAction({ action: "copy", value: "private-value" });
    const duplicate = await result.current.runAction({
      action: "copy",
      value: "private-value",
    });
    expect(duplicate).toEqual({
      ok: false,
      committed: false,
      pending: true,
      error: "Action is already pending.",
    });
    expect(JSON.stringify(duplicate)).not.toContain("private-value");
    expect(services.copyTextToClipboard).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(true);
      await first;
    });
  });
});
