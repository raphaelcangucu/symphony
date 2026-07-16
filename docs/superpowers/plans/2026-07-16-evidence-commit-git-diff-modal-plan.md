# Evidence Agent Commits → GitDiffModal Implementation Plan

**Goal:** Make Evidence “Commits do agente” row clicks open the shared `GitDiffModal` on the Commits tab with that commit selected, then delete `CommitDiffSheet`.

**Architecture:** Extend `GitDiffLauncher` / `GitDiffModal` with a `focusCommit` request-id pattern (mirror of existing `focusPath`). Mount a hidden launcher in `CommitEvidenceSection`, bump focus on row click, and remove the sheet + sheet i18n.

**Tech Stack:** React 19 + TypeScript + Vitest + Testing Library; existing `getCommitEvidence` / `useIssueCommitEvidence`; `@pierre/diffs` via `GitDiffViewer`.

**Spec:** [`docs/superpowers/specs/2026-07-16-evidence-commit-git-diff-modal-design.md`](../specs/2026-07-16-evidence-commit-git-diff-modal-design.md)

**WSL:** Run one narrowly targeted test file or `-t` filter at a time. Never run the full suite.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `tracker/src/components/issues/issue-detail/git-diff/GitDiffLauncher.tsx` | Accept `focusCommitRequestId` + `focusCommit`; open modal with `initialFocusCommit` |
| `tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx` | Apply `initialFocusCommit` → Commits tab + `selectedCommitKey` |
| `tracker/src/components/issues/issue-detail/CommitEvidenceSection.tsx` | Row click → launcher focus; drop sheet |
| `tracker/src/components/issues/issue-detail/CommitDiffSheet.tsx` | **Delete** |
| `tracker/locales/en/tracker.json` + `pt-BR/tracker.json` | Remove `issue.commits.sheet.*` |
| `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffLauncher.test.tsx` | Launcher focus-commit test |
| `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx` | Modal initial-focus-commit test |
| `tracker/src/components/issues/issue-detail/__tests__/EvidenceTab.test.tsx` | Row click opens launcher path |

Shared type (inline is fine; no new file required):

```ts
type GitDiffFocusCommit = { repo: string; sha: string };
```

Commit key must match existing helper in `GitDiffModal.tsx`:

```ts
function commitKey(commit: { repo: string; sha: string }): string {
  return `${commit.repo}:${commit.sha}`;
}
```

---

### Task 1: `GitDiffLauncher` focus-commit props

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/git-diff/GitDiffLauncher.tsx`
- Test: `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffLauncher.test.tsx`

- [ ] **Step 1: Extend the modal mock and write the failing test**

Update the `vi.mock("../GitDiffModal")` factory to also expose `initialFocusCommit`:

```tsx
vi.mock("../GitDiffModal", () => ({
  default: ({
    open,
    onOpenChange,
    initialFocusPath,
    initialFocusCommit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialFocusPath?: string | null;
    initialFocusCommit?: { repo: string; sha: string } | null;
  }) =>
    open ? (
      <div role="dialog">
        diff-modal
        <span data-testid="initial-focus-path">{initialFocusPath ?? ""}</span>
        <span data-testid="initial-focus-commit">
          {initialFocusCommit ? `${initialFocusCommit.repo}:${initialFocusCommit.sha}` : ""}
        </span>
        <button type="button" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null,
}));
```

Add test:

```tsx
it("opens from focusCommitRequestId and forwards initialFocusCommit", async () => {
  const { rerender } = render(
    <GitDiffLauncher
      projectSlug="advising"
      identifier="CDE-1"
      showTrigger={false}
      focusCommitRequestId={0}
      focusCommit={null}
    />,
  );

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  rerender(
    <GitDiffLauncher
      projectSlug="advising"
      identifier="CDE-1"
      showTrigger={false}
      focusCommitRequestId={1}
      focusCommit={{ repo: "advising", sha: "abc123def456" }}
    />,
  );

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByTestId("initial-focus-commit")).toHaveTextContent("advising:abc123def456");
});
```

- [ ] **Step 2: Run the new test — expect FAIL**

Run (from `tracker/`):

```bash
npm test -- src/components/issues/issue-detail/git-diff/__tests__/GitDiffLauncher.test.tsx -t "focusCommitRequestId"
```

Expected: FAIL (prop unknown / testid empty / dialog not opened with commit).

- [ ] **Step 3: Implement launcher props**

In `GitDiffLauncher.tsx`:

1. Add to `GitDiffLauncherProps`:

```ts
/** External commit-focus trigger: incrementing opens the modal on Commits for `focusCommit`. */
focusCommitRequestId?: number;
/** Commit from Evidence (or similar) to select after open. */
focusCommit?: { repo: string; sha: string } | null;
```

2. Destructure defaults: `focusCommitRequestId = 0`, `focusCommit = null`.

3. State:

```ts
const [initialFocusCommit, setInitialFocusCommit] = useState<{
  repo: string;
  sha: string;
} | null>(null);
```

4. Effect (alongside the `focusPath` effect):

```ts
useEffect(() => {
  if (focusCommitRequestId <= 0) return;
  const repo = typeof focusCommit?.repo === "string" ? focusCommit.repo.trim() : "";
  const sha = typeof focusCommit?.sha === "string" ? focusCommit.sha.trim() : "";
  if (!repo || !sha) return;
  setInitialFocusCommit({ repo, sha });
  openModal();
}, [focusCommit, focusCommitRequestId, openModal]);
```

5. Pass into `GitDiffModal`:

```tsx
initialFocusCommit={initialFocusCommit}
onInitialFocusCommitConsumed={() => setInitialFocusCommit(null)}
```

(`GitDiffModal` will not accept these props until Task 2 — TypeScript may error; either add optional props as a stub in the same commit as Task 2, or land Task 1+2 together. Prefer completing Step 3 of Task 2 in the same working tree before the Task 1 commit if `tsc` is strict on excess props… actually excess props on JSX components error in React TS. So **implement Task 2 modal prop stubs before finishing this step**, or commit Tasks 1–2 as one logical unit after both tests pass.)

**Practical order:** finish Task 1 Steps 1–2, then Task 2 Steps 1–4 (modal), then re-run both tests, then one commit covering launcher+modal focus API.

- [ ] **Step 4: Re-run launcher test — expect PASS**

```bash
npm test -- src/components/issues/issue-detail/git-diff/__tests__/GitDiffLauncher.test.tsx -t "focusCommitRequestId"
```

Expected: PASS

- [ ] **Step 5: Commit** (only after Task 2 also green — see Task 2 Step 5)

```bash
git add \
  tracker/src/components/issues/issue-detail/git-diff/GitDiffLauncher.tsx \
  tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx \
  tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffLauncher.test.tsx \
  tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): focus GitDiffModal on a commit from launcher

Summary:
- Add focusCommitRequestId / focusCommit to GitDiffLauncher
- Apply initialFocusCommit on Commits tab in GitDiffModal

Rationale:
- Evidence (and other surfaces) can open the shared modal on a
  specific agent commit without CommitDiffSheet

Tests:
- npm test -- GitDiffLauncher.test.tsx -t focusCommitRequestId
- npm test -- GitDiffModal.test.tsx -t initialFocusCommit

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 2: `GitDiffModal` `initialFocusCommit`

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx`
- Test: `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Add near the other focus tests in `GitDiffModal.test.tsx`:

```tsx
it("focuses a commit from initialFocusCommit", async () => {
  const onInitialFocusCommitConsumed = vi.fn();
  const commitA = {
    repo: "frontend",
    sha: "aaaaaaaaaaaa",
    shortSha: "aaaaaaa",
    message: "feat: first",
    author: "agent",
    authoredAt: "2026-07-10T00:00:00Z",
    filesChanged: 1,
    insertions: 5,
    deletions: 0,
    online: true,
  };
  const commitB = {
    repo: "backend",
    sha: "bbbbbbbbbbbb",
    shortSha: "bbbbbbb",
    message: "feat: second",
    author: "agent",
    authoredAt: "2026-07-10T01:00:00Z",
    filesChanged: 1,
    insertions: 3,
    deletions: 1,
    online: false,
  };
  useIssueCommitEvidenceMock.mockReturnValue({
    commits: [commitA, commitB],
    total: 2,
    workspace: { path: "/tmp/ws", available: true },
    loading: false,
    loadingMore: false,
    hasMore: false,
    error: null,
    loadMore: vi.fn(),
    refetch: vi.fn(),
  });
  const { getCommitEvidence } = await import("@/services/commitEvidence");
  vi.mocked(getCommitEvidence).mockImplementation(async (_p, _i, repo, sha) => ({
    ...(sha === commitB.sha ? commitB : commitA),
    files: [
      {
        path: sha === commitB.sha ? "b.ts" : "a.ts",
        oldPath: null,
        status: "modified",
        patch: "@@\n+x\n",
      },
    ],
  }));

  render(
    <GitDiffModal
      open
      onOpenChange={vi.fn()}
      projectSlug="advising"
      identifier="CDE-1"
      initialFocusCommit={{ repo: "backend", sha: "bbbbbbbbbbbb" }}
      onInitialFocusCommitConsumed={onInitialFocusCommitConsumed}
    />,
  );

  await waitFor(() => {
    expect(screen.getByRole("tab", { name: /commits/i })).toHaveAttribute("data-state", "active");
  });
  await waitFor(() => {
    expect(getCommitEvidence).toHaveBeenCalledWith("advising", "CDE-1", "backend", "bbbbbbbbbbbb");
  });
  expect(onInitialFocusCommitConsumed).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx -t "initialFocusCommit"
```

Expected: FAIL (prop unused / still on Branch tab).

- [ ] **Step 3: Implement modal focus**

In `GitDiffModal.tsx` props interface:

```ts
initialFocusCommit?: { repo: string; sha: string } | null;
onInitialFocusCommitConsumed?: () => void;
```

Destructure defaults: `initialFocusCommit = null`.

Add effect **after** the `initialFocusPath` effect (do not clear commit focus when path focus runs unless a new path arrives — path and commit are separate entry points):

```ts
useEffect(() => {
  if (!open) return;
  const repo = typeof initialFocusCommit?.repo === "string" ? initialFocusCommit.repo.trim() : "";
  const sha = typeof initialFocusCommit?.sha === "string" ? initialFocusCommit.sha.trim() : "";
  if (!repo || !sha) return;
  if (!supportsCommits) {
    onInitialFocusCommitConsumed?.();
    return;
  }
  setActiveTab("commits");
  setSelectedCommitKey(`${repo}:${sha}`);
  onInitialFocusCommitConsumed?.();
}, [initialFocusCommit, open, onInitialFocusCommitConsumed, supportsCommits]);
```

Notes:
- `supportsCommits` is already `Boolean(projectSlug && identifier)`.
- Existing detail-loading effect on `selectedCommit` must remain unchanged.
- If the list later lacks that key, existing `selectedCommit` fallback (`?? commits[0]`) applies — no new error UI.

- [ ] **Step 4: Run modal + launcher tests — expect PASS**

```bash
npm test -- src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx -t "initialFocusCommit"
```

Then:

```bash
npm test -- src/components/issues/issue-detail/git-diff/__tests__/GitDiffLauncher.test.tsx -t "focusCommitRequestId"
```

Expected: both PASS.

- [ ] **Step 5: Commit** (same commit message as Task 1 Step 5)

---

### Task 3: Wire `CommitEvidenceSection` + update Evidence test

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/CommitEvidenceSection.tsx`
- Modify: `tracker/src/components/issues/issue-detail/__tests__/EvidenceTab.test.tsx`

- [ ] **Step 1: Rewrite the Evidence test to assert launcher open**

In `EvidenceTab.test.tsx`, replace the `getCommitEvidence` mock usage for this case with a `GitDiffLauncher` mock (keep other mocks):

```tsx
const gitDiffLauncherPropsMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/issues/issue-detail/git-diff/GitDiffLauncher", () => ({
  GitDiffLauncher: (props: {
    focusCommitRequestId?: number;
    focusCommit?: { repo: string; sha: string } | null;
    showTrigger?: boolean;
  }) => {
    gitDiffLauncherPropsMock(props);
    return (
      <div
        data-testid="git-diff-launcher-probe"
        data-focus-commit-request-id={String(props.focusCommitRequestId ?? 0)}
        data-focus-commit={
          props.focusCommit ? `${props.focusCommit.repo}:${props.focusCommit.sha}` : ""
        }
      />
    );
  },
}));
```

Replace the test body of `"renders agent commits and opens the diff sheet on click"`:

```tsx
it("renders agent commits and opens the workspace diff modal on click", async () => {
  gitDiffLauncherPropsMock.mockClear();
  const user = userEvent.setup();
  renderTab(
    <EvidenceTab
      {...baseProps}
      commits={[
        {
          repo: "advising",
          sha: "abc123def456",
          shortSha: "abc123d",
          message: "feat: agent work",
          author: "Symphony Agent",
          authoredAt: "2026-06-10T12:00:00Z",
          filesChanged: 1,
          insertions: 2,
          deletions: 0,
          online: false,
        },
      ]}
      commitWorkspace={{ path: "/tmp/ws", available: true }}
      onRefreshCommits={vi.fn()}
      records={[]}
    />,
  );

  expect(screen.getByText(i18n.t("issue.commits.title"))).toBeInTheDocument();
  expect(screen.getByTestId("git-diff-launcher-probe")).toHaveAttribute(
    "data-focus-commit-request-id",
    "0",
  );

  await user.click(screen.getByTestId("commit-evidence-abc123d"));

  expect(screen.getByTestId("git-diff-launcher-probe")).toHaveAttribute(
    "data-focus-commit-request-id",
    "1",
  );
  expect(screen.getByTestId("git-diff-launcher-probe")).toHaveAttribute(
    "data-focus-commit",
    "advising:abc123def456",
  );
});
```

Remove `getCommitEvidenceMock` from this test (the mock can stay for unused safety, or delete if unused elsewhere in the file).

- [ ] **Step 2: Run Evidence test — expect FAIL**

```bash
npm test -- src/components/issues/issue-detail/__tests__/EvidenceTab.test.tsx -t "opens the workspace diff modal"
```

Expected: FAIL (no launcher / request id stays 0).

- [ ] **Step 3: Wire `CommitEvidenceSection`**

Replace sheet state with launcher focus state. Full component shape:

```tsx
import { GitCommit, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { GitDiffLauncher } from "@/components/issues/issue-detail/git-diff/GitDiffLauncher";
import { Button } from "@/components/ui/button";
import { formatFullDateTime } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import type { CommitEvidenceSummary, CommitEvidenceWorkspace } from "@/types/commitEvidence";

interface CommitEvidenceSectionProps {
  projectSlug: string;
  identifier: string;
  commits: CommitEvidenceSummary[];
  workspace: CommitEvidenceWorkspace | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function CommitEvidenceSection({
  projectSlug,
  identifier,
  commits,
  workspace,
  loading,
  error,
  onRefresh,
}: CommitEvidenceSectionProps) {
  const { t } = useTranslation();
  const [focusCommitRequestId, setFocusCommitRequestId] = useState(0);
  const [focusCommit, setFocusCommit] = useState<{ repo: string; sha: string } | null>(null);

  const openCommit = (commit: CommitEvidenceSummary) => {
    const repo = typeof commit.repo === "string" ? commit.repo.trim() : "";
    const sha = typeof commit.sha === "string" ? commit.sha.trim() : "";
    if (!repo || !sha) return;
    setFocusCommit({ repo, sha });
    setFocusCommitRequestId((id) => id + 1);
  };

  return (
    <div className="space-y-3">
      {/* existing header / error / empty / map UI unchanged */}
      {commits.map((commit) => (
        <button
          className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/40"
          data-testid={`commit-evidence-${commit.shortSha}`}
          key={`${commit.repo}-${commit.sha}`}
          onClick={() => openCommit(commit)}
          type="button"
        >
          {/* existing row content unchanged */}
        </button>
      ))}

      <GitDiffLauncher
        projectSlug={projectSlug}
        identifier={identifier}
        showTrigger={false}
        focusCommitRequestId={focusCommitRequestId}
        focusCommit={focusCommit}
      />
    </div>
  );
}
```

Keep the existing header, error, workspace-unavailable, empty, and row markup exactly as today — only swap the sheet for the launcher and the `openCommit` implementation.

- [ ] **Step 4: Run Evidence test — expect PASS**

```bash
npm test -- src/components/issues/issue-detail/__tests__/EvidenceTab.test.tsx -t "opens the workspace diff modal"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  tracker/src/components/issues/issue-detail/CommitEvidenceSection.tsx \
  tracker/src/components/issues/issue-detail/__tests__/EvidenceTab.test.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): open Evidence commits in GitDiffModal

Summary:
- Wire CommitEvidenceSection row click to GitDiffLauncher focusCommit
- Update EvidenceTab test to assert the shared modal open path

Rationale:
- Standardize Evidence on the assistant workspace diff viewer

Tests:
- npm test -- EvidenceTab.test.tsx -t "opens the workspace diff modal"

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 4: Delete `CommitDiffSheet` + sheet i18n

**Files:**
- Delete: `tracker/src/components/issues/issue-detail/CommitDiffSheet.tsx`
- Modify: `tracker/locales/en/tracker.json` (remove `issue.commits.sheet` object)
- Modify: `tracker/locales/pt-BR/tracker.json` (same)
- Grep: confirm no remaining imports of `CommitDiffSheet` or `issue.commits.sheet`

- [ ] **Step 1: Grep for leftovers**

```bash
rg -n "CommitDiffSheet|issue\\.commits\\.sheet|commits\\.sheet" tracker/
```

Expected after delete: no matches (except this plan/spec if under docs — docs are outside `tracker/`).

- [ ] **Step 2: Delete the sheet file**

```bash
rm tracker/src/components/issues/issue-detail/CommitDiffSheet.tsx
```

- [ ] **Step 3: Remove i18n keys**

In both locale files, under `issue.commits`, delete the entire `"sheet": { ... }` block (keys: `title`, `descriptionFallback`, `loadFailed`, `loadingDiff`, `noFiles`, `selectFile`). Keep `title`, `refresh`, `files_*`, `errors`, etc.

- [ ] **Step 4: Confirm Evidence test still passes**

```bash
npm test -- src/components/issues/issue-detail/__tests__/EvidenceTab.test.tsx -t "opens the workspace diff modal"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  tracker/src/components/issues/issue-detail/CommitDiffSheet.tsx \
  tracker/locales/en/tracker.json \
  tracker/locales/pt-BR/tracker.json
git commit -m "$(cat <<'EOF'
refactor(tracker): remove CommitDiffSheet after Evidence migration

Summary:
- Delete CommitDiffSheet and issue.commits.sheet i18n keys

Rationale:
- GitDiffModal Commits tab is now the only commit-diff viewer

Tests:
- npm test -- EvidenceTab.test.tsx -t "opens the workspace diff modal"

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Row click opens `GitDiffModal` | Task 3 |
| Lands on Commits with clicked repo/sha | Task 2 (+ Task 1 wiring) |
| Uses `GitDiffViewer` (existing modal path) | Task 2 (reuse) |
| Branch / Uncommitted still available | Task 2 (full modal, no lock) |
| Delete `CommitDiffSheet` + sheet i18n | Task 4 |
| Launcher / modal / Evidence tests | Tasks 1–3 |
| Invalid focusCommit no-op | Task 1 effect guards |
| Missing commit → existing first-commit fallback | Task 2 (unchanged `selectedCommit` expr) |
| No Evidence `onSendReview` | Task 3 (prop omitted) |

## Self-review notes

- No TBD/placeholder steps; types use `{ repo, sha }` consistently.
- `focusCommit` mirrors `focusPath` naming (`RequestId` + value + `initial*` + consumed callback).
- Tasks 1–2 share one commit because TS requires modal props before launcher can pass them.
- WSL: every run command targets a single file + `-t` filter.
