import type { MobileGitStatusEntry } from "../src/orca/source-control/mobile-git-status";

type FakeGitEntry = MobileGitStatusEntry & {
  stagedFromUntracked?: boolean;
};

type MockGitRequest = {
  id: string;
  method: string;
  params: Record<string, unknown>;
};

const MOCK_HEAD = "7a6c2f1f59331e5d63e4b0bf3af376f30a1ec5ea";
const MOCK_BASE = "1f6d9a04702ad7129d0fd7341fc0dad34f126611";

let fakeGitEntries: FakeGitEntry[] = [
  { path: "mobile/src/app.tsx", status: "modified", area: "unstaged" },
  { path: "mobile/assets/dev10x.png", status: "untracked", area: "untracked" },
  { path: "README.md", status: "modified", area: "staged" },
];
let fakeAhead = 1;
let fakeBehind = 0;
let fakeHasUpstream = true;

function toGitStatusEntry(entry: FakeGitEntry): MobileGitStatusEntry {
  const { stagedFromUntracked: _stagedFromUntracked, ...statusEntry } = entry;
  return statusEntry;
}

function stageFakeGitEntry(entry: FakeGitEntry, filePaths: Set<string>): FakeGitEntry {
  if (!filePaths.has(entry.path)) return entry;
  if (entry.area === "untracked") {
    return {
      ...entry,
      area: "staged",
      status: "added",
      stagedFromUntracked: true,
    };
  }
  return { ...entry, area: "staged" };
}

function unstageFakeGitEntry(entry: FakeGitEntry, filePaths: Set<string>): FakeGitEntry {
  if (!filePaths.has(entry.path)) return entry;
  if (entry.stagedFromUntracked) {
    return {
      ...entry,
      area: "untracked",
      status: "untracked",
      stagedFromUntracked: false,
    };
  }
  return { ...entry, area: "unstaged" };
}

function upstreamStatus() {
  return {
    hasUpstream: fakeHasUpstream,
    upstreamName: fakeHasUpstream ? "origin/feature/dev10x-mobile" : null,
    ahead: fakeAhead,
    behind: fakeBehind,
  };
}

function diffResult() {
  return {
    kind: "text",
    originalContent: 'const brand = "Symphony"\\n',
    modifiedContent: 'const brand = "Dev10x"\\n',
    originalIsBinary: false,
    modifiedIsBinary: false,
  };
}

function compareEntries() {
  return fakeGitEntries.map((entry) => ({
    path: entry.path,
    status: entry.status === "untracked" ? "added" : entry.status,
  }));
}

export function handleMockGitRequest<Response>(
  request: MockGitRequest,
  respond: (response: Response) => void,
  success: (id: string, result: unknown) => Response,
): boolean {
  switch (request.method) {
    case "git.status":
      respond(
        success(request.id, {
          entries: fakeGitEntries.map(toGitStatusEntry),
          conflictOperation: "unknown",
          branch: "refs/heads/feature/dev10x-mobile",
          head: MOCK_HEAD,
          upstreamStatus: upstreamStatus(),
          didHitLimit: false,
          statusLength: fakeGitEntries.length,
        }),
      );
      return true;

    case "git.upstreamStatus":
      respond(success(request.id, upstreamStatus()));
      return true;

    case "git.stage": {
      const filePath = String(request.params.filePath ?? "");
      fakeGitEntries = fakeGitEntries.map((entry) => stageFakeGitEntry(entry, new Set([filePath])));
      respond(success(request.id, { staged: true, filePath }));
      return true;
    }

    case "git.bulkStage": {
      const filePaths = new Set((request.params.filePaths as string[] | undefined) ?? []);
      fakeGitEntries = fakeGitEntries.map((entry) => stageFakeGitEntry(entry, filePaths));
      respond(success(request.id, { staged: [...filePaths] }));
      return true;
    }

    case "git.unstage": {
      const filePath = String(request.params.filePath ?? "");
      fakeGitEntries = fakeGitEntries.map((entry) =>
        unstageFakeGitEntry(entry, new Set([filePath])),
      );
      respond(success(request.id, { unstaged: true, filePath }));
      return true;
    }

    case "git.bulkUnstage": {
      const filePaths = new Set((request.params.filePaths as string[] | undefined) ?? []);
      fakeGitEntries = fakeGitEntries.map((entry) => unstageFakeGitEntry(entry, filePaths));
      respond(success(request.id, { unstaged: [...filePaths] }));
      return true;
    }

    case "git.discard": {
      const filePath = String(request.params.filePath ?? "");
      fakeGitEntries = fakeGitEntries.filter((entry) => entry.path !== filePath);
      respond(success(request.id, { discarded: true, filePath }));
      return true;
    }

    case "git.commit":
      fakeGitEntries = fakeGitEntries.filter((entry) => entry.area !== "staged");
      fakeAhead += 1;
      respond(
        success(request.id, {
          success: true,
          committed: true,
          sha: MOCK_HEAD,
          message: String(request.params.message ?? ""),
        }),
      );
      return true;

    case "git.fetch":
      respond(success(request.id, { fetched: true }));
      return true;

    case "git.pull":
      fakeBehind = 0;
      respond(success(request.id, { pulled: true }));
      return true;

    case "git.push":
      fakeHasUpstream = true;
      fakeAhead = 0;
      respond(success(request.id, { pushed: true }));
      return true;

    case "git.diff":
    case "git.branchDiff":
      respond(success(request.id, diffResult()));
      return true;

    case "git.branchCompare": {
      const entries = compareEntries();
      respond(
        success(request.id, {
          summary: {
            baseRef: String(request.params.baseRef ?? "main"),
            baseOid: MOCK_BASE,
            compareRef: "HEAD",
            headOid: MOCK_HEAD,
            mergeBase: MOCK_BASE,
            changedFiles: entries.length,
            commitsAhead: fakeAhead,
            status: "ready",
          },
          entries,
        }),
      );
      return true;
    }

    case "git.commitCompare":
      respond(
        success(request.id, {
          summary: {
            commitOid: MOCK_HEAD,
            parentOid: MOCK_BASE,
            compareRef: MOCK_HEAD,
            baseRef: MOCK_BASE,
            changedFiles: 1,
            status: "ready",
          },
          entries: [{ path: "README.md", status: "modified" }],
        }),
      );
      return true;

    case "git.history":
      respond(
        success(request.id, {
          items: [
            {
              id: MOCK_HEAD,
              displayId: MOCK_HEAD.slice(0, 7),
              parentIds: [MOCK_BASE],
              subject: "feat: Dev10x mobile workspace",
              message: "feat: Dev10x mobile workspace",
              author: "Dev10x",
              authorEmail: "mobile@dev10x.dev",
              timestamp: 1_785_018_167,
            },
          ],
          hasIncomingChanges: fakeBehind > 0,
          hasOutgoingChanges: fakeAhead > 0,
          hasMore: false,
          limit: Number(request.params.limit ?? 50),
        }),
      );
      return true;

    case "git.generateCommitMessage":
      respond(
        success(request.id, {
          success: true,
          message: "feat: improve Dev10x mobile",
        }),
      );
      return true;

    case "git.cancelGenerateCommitMessage":
      respond(success(request.id, { canceled: true }));
      return true;

    case "git.generatePullRequestFields":
      respond(
        success(request.id, {
          success: true,
          fields: {
            base: String(request.params.base ?? "main"),
            title: String(request.params.title || "feat: Dev10x mobile workspace"),
            body: String(
              request.params.body ||
                "## Summary\n\n- Connect the copied mobile experience to Dev10x hosts.",
            ),
            draft: request.params.draft === true,
          },
        }),
      );
      return true;

    case "hostedReview.getCreationEligibility":
      respond(
        success(request.id, {
          provider: "github",
          review: null,
          canCreate: true,
          blockedReason: null,
          nextAction: null,
          defaultBaseRef: String(request.params.base ?? "main"),
          head: String(request.params.branch ?? "feature/dev10x-mobile"),
          title: "Dev10x mobile workspace",
          body: "",
        }),
      );
      return true;

    default:
      return false;
  }
}
