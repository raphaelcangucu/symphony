# Workspace Diff Annotations + Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users annotate Commits (commit notes + line comments) and send one review prompt to the assistant, while clarifying Branch with a status strip and polishing Não commitado with a summary strip, comment badges, and a useful empty state.

**Architecture:** Extend the in-memory `diffReview` session in the tracker so line comments carry a `source` (`branch` | `uncommitted` | `commit`) and optional commit identity; add `CommitNote`s and a unified prompt builder. Enable review UI on the Commits tab in `GitDiffModal`. Enrich `Evidence.WorkspaceDiff` repo payloads with branch metadata (`branch`, `base`, `ahead`, `behind`) for the Branch status strip. Polish `GitDiffFileTree` with source-scoped 💬 badges and add summary/empty-state UI in the modal. No staging and no server persistence of notes.

**Tech Stack:** Elixir/Phoenix + ExUnit; React 19 + TypeScript + Vitest + Testing Library; existing `@pierre/diffs` viewer; i18next locales.

**Spec:** `docs/superpowers/specs/2026-07-10-workspace-diff-annotations-layout-design.md`

---

## File Structure

**Modify (review model):**
- `tracker/src/lib/diffReview.ts` — types (`DiffReviewSource`, `CommitNote`, extend `DiffReviewComment`), `buildDiffReviewPrompt(comments, notes)`
- `tracker/src/lib/__tests__/diffReview.test.ts`

**Modify (backend metadata):**
- `elixir/lib/symphony_elixir/evidence/workspace_diff.ex` — attach `branch` / `base` / `ahead` / `behind` on each repo map
- `elixir/test/symphony_elixir/evidence/workspace_diff_test.exs`
- `elixir/test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs` (assert JSON keys when present)

**Modify (API types/client):**
- `tracker/src/types/gitDiff.ts` — optional metadata on `GitDiffRepo`
- `tracker/src/services/gitDiff.ts` — normalize metadata fields

**Modify (UI):**
- `tracker/src/components/issues/issue-detail/git-diff/GitDiffFileTree.tsx` — optional `commentCountsByPath`
- `tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx` — notes, commits review, strips, empty state
- `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffFileTree.test.tsx`
- `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx`
- `tracker/locales/en/tracker.json` + `tracker/locales/pt-BR/tracker.json`

**Note:** `GitDiffFileTree` already shows per-file +/-. Do not re-implement that; only add 💬 badges.

---

### Task 1: Extend `diffReview` types and unified prompt

**Files:**
- Modify: `tracker/src/lib/diffReview.ts`
- Modify: `tracker/src/lib/__tests__/diffReview.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace/extend `buildDiffReviewPrompt` tests so comments require `source`, and add notes coverage:

```ts
import {
  buildDiffReviewPrompt,
  lineTextFromPatch,
  type CommitNote,
  type DiffReviewComment,
} from "@/lib/diffReview";

// Keep existing lineTextFromPatch tests unchanged.

describe("buildDiffReviewPrompt", () => {
  it("groups comments by file, sorts by line, and anchors code lines", () => {
    const comments: DiffReviewComment[] = [
      {
        id: "1",
        filePath: "backend/src/auth.ts",
        side: "additions",
        lineNumber: 42,
        lineText: "const token = raw;",
        comment: "Validate the token before using it.",
        source: "uncommitted",
      },
      {
        id: "2",
        filePath: "backend/src/auth.ts",
        side: "deletions",
        lineNumber: 10,
        lineText: null,
        comment: "Why was this removed?",
        source: "uncommitted",
      },
      {
        id: "3",
        filePath: "frontend/src/App.tsx",
        side: "additions",
        lineNumber: 5,
        lineText: "useEffect(() => {",
        comment: "Missing dependency array.",
        source: "branch",
      },
    ];

    const prompt = buildDiffReviewPrompt(comments);

    expect(prompt).toContain("### (working tree) — backend/src/auth.ts");
    expect(prompt).toContain("### (branch) — frontend/src/App.tsx");
    expect(prompt.indexOf("line 10 (removed)")).toBeLessThan(prompt.indexOf("line 42"));
    expect(prompt).toContain("> const token = raw;");
    expect(prompt).toContain("Validate the token before using it.");
    expect(prompt).toContain("Address each");
  });

  it("indents multi-line comments so they stay inside the list item", () => {
    const prompt = buildDiffReviewPrompt([
      {
        id: "1",
        filePath: "a.ts",
        side: "additions",
        lineNumber: 1,
        lineText: null,
        comment: "First line.\nSecond line.",
        source: "uncommitted",
      },
    ]);

    expect(prompt).toContain("  First line.\n  Second line.");
  });

  it("includes commit notes and commit-sourced line comments", () => {
    const notes: CommitNote[] = [
      {
        repo: "front",
        sha: "a1b2c3d4e5f6",
        shortSha: "a1b2c3d",
        message: "docs: settlement plan",
        note: "use as settlement context",
      },
    ];
    const comments: DiffReviewComment[] = [
      {
        id: "1",
        filePath: "front/docs/plan.md",
        side: "additions",
        lineNumber: 12,
        lineText: "## Goal",
        comment: "call out cross-tenant",
        source: "commit",
        commitSha: "a1b2c3d4e5f6",
        commitRepo: "front",
      },
    ];

    const prompt = buildDiffReviewPrompt(comments, notes);

    expect(prompt).toContain("## Commit notes");
    expect(prompt).toContain("### front @ a1b2c3d — docs: settlement plan");
    expect(prompt).toContain("use as settlement context");
    expect(prompt).toContain("## Line comments");
    expect(prompt).toContain("### front @ a1b2c3d — front/docs/plan.md");
    expect(prompt).toContain("call out cross-tenant");
  });

  it("omits empty commit-notes section and ignores whitespace-only notes", () => {
    const prompt = buildDiffReviewPrompt([], [
      { repo: "front", sha: "abc", shortSha: "abc", message: "x", note: "   " },
    ]);
    expect(prompt).not.toContain("## Commit notes");
    expect(prompt).toContain("Address each");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/lib/__tests__/diffReview.test.ts`

Expected: FAIL (missing `source` / `CommitNote` / new signature)

- [ ] **Step 3: Implement types + prompt builder**

In `tracker/src/lib/diffReview.ts`, replace the comment type and prompt builder with:

```ts
export type DiffReviewSide = "additions" | "deletions";
export type DiffReviewSource = "branch" | "uncommitted" | "commit";

export interface DiffReviewComment {
  id: string;
  filePath: string;
  side: DiffReviewSide;
  lineNumber: number;
  lineText: string | null;
  comment: string;
  source: DiffReviewSource;
  commitSha?: string;
  commitRepo?: string;
}

export interface CommitNote {
  repo: string;
  sha: string;
  shortSha: string;
  message: string;
  note: string;
}

export function newDiffReviewCommentId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `comment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Keep lineTextFromPatch unchanged.

function lineCommentHeading(comment: DiffReviewComment): string {
  if (comment.source === "commit") {
    const repo = comment.commitRepo?.trim() || "repo";
    const short =
      comment.commitSha && comment.commitSha.length >= 7
        ? comment.commitSha.slice(0, 7)
        : comment.commitSha || "???????";
    return `### ${repo} @ ${short} — ${comment.filePath}`;
  }
  if (comment.source === "branch") return `### (branch) — ${comment.filePath}`;
  return `### (working tree) — ${comment.filePath}`;
}

function formatLineItems(fileComments: DiffReviewComment[]): string {
  return fileComments
    .slice()
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map((comment) => {
      const location =
        comment.side === "deletions"
          ? `line ${comment.lineNumber} (removed)`
          : `line ${comment.lineNumber}`;
      const anchor = comment.lineText?.trim() ? `\n  > ${comment.lineText.trim()}` : "";
      return `- ${location}:${anchor}\n  ${comment.comment.trim().replace(/\n/g, "\n  ")}`;
    })
    .join("\n");
}

export function buildDiffReviewPrompt(
  comments: readonly DiffReviewComment[],
  notes: readonly CommitNote[] = [],
): string {
  const usableNotes = notes.filter((n) => n.note.trim().length > 0);
  const noteSection =
    usableNotes.length === 0
      ? []
      : [
          "## Commit notes",
          ...usableNotes.map((n) => {
            const short = n.shortSha || n.sha.slice(0, 7);
            return `### ${n.repo} @ ${short} — ${n.message}\n- ${n.note.trim().replace(/\n/g, "\n  ")}`;
          }),
          "",
        ];

  const byHeading = new Map<string, DiffReviewComment[]>();
  for (const comment of comments) {
    const heading = lineCommentHeading(comment);
    const list = byHeading.get(heading) ?? [];
    list.push(comment);
    byHeading.set(heading, list);
  }

  const lineSections = [...byHeading.entries()].map(
    ([heading, fileComments]) => `${heading}\n${formatLineItems(fileComments)}`,
  );

  const lineBlock =
    lineSections.length === 0 ? [] : ["## Line comments", "", ...lineSections];

  return [
    "I reviewed workspace diffs and left notes. Address each:",
    "",
    ...noteSection,
    ...lineBlock,
  ]
    .join("\n")
    .trimEnd();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tracker && npx vitest run src/lib/__tests__/diffReview.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/lib/diffReview.ts tracker/src/lib/__tests__/diffReview.test.ts
git commit -m "feat(tracker): unify diff review prompt with commit notes"
```

---

### Task 2: Backend — branch metadata on `WorkspaceDiff` repos

**Files:**
- Modify: `elixir/lib/symphony_elixir/evidence/workspace_diff.ex`
- Modify: `elixir/test/symphony_elixir/evidence/workspace_diff_test.exs`

`RunContract.RepoState` already has `branch`, `default_branch`, `ahead_count`. Compute `behind` with `git rev-list --count HEAD..origin/<default>` when default exists; otherwise omit/`nil`. Attach metadata on every returned repo map (still omit clean repos with empty files).

- [ ] **Step 1: Write the failing test**

Add to `workspace_diff_test.exs`:

```elixir
test "branch diff includes branch metadata on each repo", %{tmp_dir: tmp_dir} do
  ws = Path.join(tmp_dir, "GAM-9")
  File.mkdir_p!(ws)
  repo = make_repo!(tmp_dir, ws, "frontend")

  sh!(
    repo,
    "git checkout -b feat/x && mkdir -p src && printf 'a\\n' > src/App.tsx && git add -A && git commit -m work"
  )

  assert {:ok, [entry]} = WorkspaceDiff.changes(ws, :branch)
  assert entry.repo == "frontend"
  assert entry.branch == "feat/x"
  assert entry.base == "main"
  assert is_integer(entry.ahead)
  assert entry.ahead >= 1
  assert is_integer(entry.behind) or is_nil(entry.behind)
  assert [%{path: "src/App.tsx"}] = entry.files
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/evidence/workspace_diff_test.exs --only line:<line_of_new_test>`

Or: `cd elixir && mix test test/symphony_elixir/evidence/workspace_diff_test.exs`

Expected: FAIL (unknown keys / missing fields)

- [ ] **Step 3: Implement metadata enrichment**

In `workspace_diff.ex`, change the map construction in `changes/2` from `%{repo: name, files: ...}` to include metadata from the `RepoState`:

```elixir
|> Enum.map(fn repo_state ->
  files = repo_files(repo_state, type)

  %{
    repo: repo_state.name,
    branch: repo_state.branch,
    base: repo_state.default_branch,
    ahead: repo_state.ahead_count,
    behind: behind_count(repo_state),
    files: files
  }
end)
|> Enum.reject(fn %{files: files} -> files == [] end)
```

Add:

```elixir
defp behind_count(%RepoState{path: path, default_branch: default})
     when is_binary(default) and default != "" do
  case git(path, ["rev-list", "--count", "HEAD..origin/#{default}"]) do
    {:ok, output} ->
      case Integer.parse(String.trim(output)) do
        {n, _} -> n
        :error -> nil
      end

    {:error, _} ->
      nil
  end
end

defp behind_count(_), do: nil
```

Update `@type repo_diff` accordingly:

```elixir
@type repo_diff :: %{
        repo: String.t(),
        branch: String.t() | nil,
        base: String.t() | nil,
        ahead: non_neg_integer(),
        behind: non_neg_integer() | nil,
        files: [file_change()]
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/evidence/workspace_diff_test.exs`

Expected: PASS

- [ ] **Step 5: Assert controller JSON includes metadata**

In `workspace_diff_controller_test.exs`, for an uncommitted or branch response that returns a repo, assert keys exist (values may be null):

```elixir
assert %{"repo" => _, "branch" => _, "base" => _, "ahead" => _, "behind" => _, "files" => _} =
         hd(json_response(conn, 200)["data"])
```

Add this assertion to the existing uncommitted `show` test (or a dedicated branch test). Run:

`cd elixir && mix test test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs`

Expected: PASS (Phoenix encodes atom keys as strings)

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/evidence/workspace_diff.ex \
  elixir/test/symphony_elixir/evidence/workspace_diff_test.exs \
  elixir/test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs
git commit -m "feat(elixir): include branch metadata on workspace diff repos"
```

---

### Task 3: Frontend types + `gitDiff` normalization

**Files:**
- Modify: `tracker/src/types/gitDiff.ts`
- Modify: `tracker/src/services/gitDiff.ts`
- Test: `tracker/src/services/__tests__/gitDiff.test.ts` (create if missing; otherwise extend)

- [ ] **Step 1: Extend types**

```ts
export interface GitDiffRepo {
  repo: string;
  branch?: string | null;
  base?: string | null;
  ahead?: number | null;
  behind?: number | null;
  files: GitDiffFileChange[];
}
```

- [ ] **Step 2: Normalize in `gitDiff.ts`**

Extend `BackendGitDiffRepoDto` and `normalizeRepo`:

```ts
interface BackendGitDiffRepoDto {
  repo?: string | null;
  branch?: string | null;
  base?: string | null;
  ahead?: number | null;
  behind?: number | null;
  files?: BackendGitDiffFileDto[] | null;
}

function normalizeRepo(dto: BackendGitDiffRepoDto): GitDiffRepo {
  return {
    repo: dto.repo ?? "",
    branch: dto.branch ?? null,
    base: dto.base ?? null,
    ahead: typeof dto.ahead === "number" ? dto.ahead : null,
    behind: typeof dto.behind === "number" ? dto.behind : null,
    files: (dto.files ?? []).map(normalizeFile),
  };
}
```

- [ ] **Step 3: Add/adjust a unit test** that a raw envelope with metadata maps correctly (mock `http.get` if the existing service test pattern does that). If no service test file exists, create `tracker/src/services/__tests__/gitDiff.test.ts` following sibling service tests.

- [ ] **Step 4: Run**

`cd tracker && npx vitest run src/services/__tests__/gitDiff.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/types/gitDiff.ts tracker/src/services/gitDiff.ts tracker/src/services/__tests__/gitDiff.test.ts
git commit -m "feat(tracker): parse workspace diff branch metadata"
```

---

### Task 4: File tree comment badges

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/git-diff/GitDiffFileTree.tsx`
- Modify: `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffFileTree.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
it("shows a comment badge count for paths with comments", () => {
  render(
    <GitDiffFileTree
      files={files}
      flat
      selectedPath={null}
      onSelect={vi.fn()}
      onToggleFlat={vi.fn()}
      commentCountsByPath={{ "frontend/src/App.tsx": 2 }}
    />,
  );

  expect(screen.getByText("💬2")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify fail**

`cd tracker && npx vitest run src/components/issues/issue-detail/git-diff/__tests__/GitDiffFileTree.test.tsx`

Expected: FAIL (unknown prop / missing badge)

- [ ] **Step 3: Implement**

Add optional prop `commentCountsByPath?: Record<string, number>` to `GitDiffFileTree`. Thread into `FileRow` / `TreeNode`. After +/- spans, if count > 0:

```tsx
{commentCount > 0 ? (
  <span className="shrink-0 text-[10px] text-sky-600" title={`${commentCount} comments`}>
    💬{commentCount}
  </span>
) : null}
```

Pass `commentCount={commentCountsByPath?.[file.path] ?? 0}` into `FileRow`.

- [ ] **Step 4: Run tests — Expected: PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/git-diff/GitDiffFileTree.tsx \
  tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffFileTree.test.tsx
git commit -m "feat(tracker): show diff file comment badges"
```

---

### Task 5: i18n strings

**Files:**
- Modify: `tracker/locales/en/tracker.json`
- Modify: `tracker/locales/pt-BR/tracker.json`

- [ ] **Step 1: Add keys under `issue.diff`**

English:

```json
"status": {
  "aheadBehind": "↑ {{ahead}} ahead · ↓ {{behind}} behind",
  "aheadBehindUnknown": "↑ {{ahead}} ahead · ↓ — behind",
  "branchBase": "{{branch}} ← {{base}}",
  "branchUnknown": "Branch unavailable",
  "workingTree": "Working tree",
  "reviewCount_one": "{{count}} review",
  "reviewCount_other": "{{count}} reviews"
},
"commitNote": {
  "label": "Commit note",
  "placeholder": "Write a note for the assistant…"
},
"empty": {
  "uncommittedTitle": "No uncommitted changes",
  "uncommittedBody": "The working tree is clean. Refresh or inspect the branch diff.",
  "viewBranch": "View Branch",
  "refresh": "Refresh"
},
"review": {
  "sendButton": "Send {{count}} to agent",
  "sent": "Review with {{count}} comments sent to the agent",
  "hint": "Click a line number to comment",
  "placeholder": "Ask the agent to change this line…",
  "save": "Add comment",
  "edit": "Edit",
  "remove": "Remove",
  "sendWithNotes_one": "Send review ({{count}} item)",
  "sendWithNotes_other": "Send review ({{count}} items)"
}
```

Mirror in `pt-BR` (e.g. “Nota do commit”, “Working tree” → “Working tree” or “Árvore de trabalho”, “Ver Branch”, “Nenhuma alteração não commitada”).

Keep existing `review.*` keys; only add new ones / extend carefully so current tests that match `/send .* to agent/i` still work **or** update modal tests in Task 6 to the new label. Prefer keeping `sendButton` text stable and computing `count` as `comments.length + nonEmptyNotes`.

- [ ] **Step 2: Commit**

```bash
git add tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "chore(tracker): i18n for diff strips and commit notes"
```

---

### Task 6: `GitDiffModal` — commit notes + review on Commits

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx`
- Modify: `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
it("enables review on Commits and includes commit note + line comment in the prompt", async () => {
  const user = userEvent.setup();
  const onSendReview = vi.fn();
  useIssueCommitEvidenceMock.mockReturnValue({
    commits: [
      {
        repo: "frontend",
        sha: "abcdef123456",
        shortSha: "abcdef1",
        message: "docs: plan",
        insertions: 10,
        deletions: 0,
      },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
  // Mock getCommitEvidence to return one file with a patch
  const { getCommitEvidence } = await import("@/services/commitEvidence");
  vi.mocked(getCommitEvidence).mockResolvedValue({
    repo: "frontend",
    sha: "abcdef123456",
    message: "docs: plan",
    files: [{ path: "docs/plan.md", oldPath: null, status: "added", patch: "@@\n+hello\n" }],
  } as never);

  render(
    <GitDiffModal
      open
      onOpenChange={vi.fn()}
      projectSlug="advising"
      identifier="CDE-1"
      onSendReview={onSendReview}
    />,
  );

  await user.click(screen.getByRole("tab", { name: /commits/i }));
  // Wait for viewer / note field
  const note = await screen.findByLabelText(/commit note/i);
  await user.type(note, "use as context");
  await user.click(await screen.findByRole("button", { name: "mock add comment" }));
  await user.click(screen.getByRole("button", { name: /send .* to agent/i }));

  const prompt = onSendReview.mock.calls[0][0] as string;
  expect(prompt).toContain("## Commit notes");
  expect(prompt).toContain("use as context");
  expect(prompt).toContain("Fix this line");
  expect(prompt).toMatch(/commit|abcdef1|frontend/i);
});
```

Adjust mocks to match real `CommitEvidenceSummary` / `CommitEvidenceDetail` field names from `tracker/src/types/commitEvidence.ts`.

- [ ] **Step 2: Run — Expected: FAIL**

`cd tracker && npx vitest run src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx`

- [ ] **Step 3: Implement modal review session changes**

Key behavior changes in `GitDiffModal.tsx`:

1. `const [commitNotes, setCommitNotes] = useState<CommitNote[]>([]);`
2. `reviewEnabled = Boolean(onSendReview)` for **all** tabs including commits.
3. When saving a line comment, set `source` from `activeTab` (`branch` | `uncommitted` | `commit`) and if commits, set `commitSha` / `commitRepo` from `selectedCommit`.
4. Selected file comments filter must also match commit identity when on commits tab.
5. Above the viewer when `activeTab === "commits" && selectedCommit`, render a labeled textarea (`htmlFor` / `aria-label` from i18n `issue.diff.commitNote.label`) bound to the note for that repo+sha; upsert into `commitNotes` on change (store `message` + `shortSha` from selected commit).
6. `sendReviewToAgent`: `buildDiffReviewPrompt(reviewComments, commitNotes)`; total count = comments + non-empty notes; clear both arrays after send.
7. Update existing Branch/Uncommitted comment creation paths to pass `source: activeTab === "uncommitted" ? "uncommitted" : "branch"`.
8. In `CommitList`, accept `notes` + comment counts maps; show snippet / 💬 badge (read-only indicators).

Also update the existing modal test that adds a comment on the default Branch tab so created comments still send (prompt headings now include `(branch)` / `(working tree)` — assert substring still finds the file path and comment text).

- [ ] **Step 4: Run modal tests — Expected: PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx \
  tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx
git commit -m "feat(tracker): annotate commits in workspace diff modal"
```

---

### Task 7: Branch + Não commitado strips and empty state

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx`
- Modify: `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
it("shows branch status strip with ahead/behind on Branch tab", () => {
  useGitDiffMock.mockReturnValue({
    repos: [
      {
        repo: "frontend",
        branch: "feat/x",
        base: "main",
        ahead: 8,
        behind: 0,
        files: [{ path: "src/App.tsx", oldPath: null, status: "modified", patch: "@@\n+a\n" }],
      },
    ],
    workspace: { path: "/tmp/ws", available: true },
    loading: false,
    error: null,
    refetch: vi.fn(),
  });

  render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />);

  expect(screen.getByText(/feat\/x/i)).toBeInTheDocument();
  expect(screen.getByText(/main/i)).toBeInTheDocument();
  expect(screen.getByText(/8 ahead/i)).toBeInTheDocument();
});

it("shows working-tree strip and empty actions when uncommitted has no files", async () => {
  const user = userEvent.setup();
  useGitDiffMock.mockReturnValue({
    repos: [],
    workspace: { path: "/tmp/ws", available: true },
    loading: false,
    error: null,
    refetch: diffRefetchMock,
  });

  render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />);
  await user.click(screen.getByRole("tab", { name: /uncommitted/i }));

  expect(screen.getByText(/working tree/i)).toBeInTheDocument();
  expect(screen.getByText(/no uncommitted changes/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /view branch/i }));
  // active tab becomes branch — assert Branch tab selected
  expect(screen.getByRole("tab", { name: /^branch$/i })).toHaveAttribute("data-state", "active");
});
```

- [ ] **Step 2: Run — Expected: FAIL**

- [ ] **Step 3: Implement UI**

1. **BranchStatusStrip** (inline component): for `activeTab === "branch"`, above the grid (or above the aside), show for the active repo filter:
   - If `activeRepo === "all"`: one compact row per `diff.repos` with metadata (or a single aggregated line listing first repo + “+N repos”).
   - Prefer: when filtered to one repo, show `branch ← base` and `↑ ahead · ↓ behind` (use `—` when `behind == null`).
   - Include file count + combined +/- from current `files` list.
2. **UncommittedSummaryStrip**: when `activeTab === "uncommitted"`, show “Working tree”, file count, +/-, review count for `source === "uncommitted"` only. No Commit button in the strip.
3. Pass `commentCountsByPath` into `GitDiffFileTree` built from `reviewComments.filter(c => c.source === activeTabSource)`.
4. **Empty state**: when `activeTab === "uncommitted" && !diff.loading && files.length === 0`, replace the right pane (or full content under strips) with title/body + Refresh (`diff.refetch`) + View Branch (`setActiveTab("branch")`).

- [ ] **Step 4: Run modal tests — Expected: PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx \
  tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx
git commit -m "feat(tracker): add branch and working-tree diff status strips"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run tracker focused suites**

```bash
cd tracker && npx vitest run \
  src/lib/__tests__/diffReview.test.ts \
  src/components/issues/issue-detail/git-diff/__tests__/GitDiffFileTree.test.tsx \
  src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx \
  src/services/__tests__/gitDiff.test.ts
```

Expected: all PASS

- [ ] **Step 2: Run elixir focused suites**

```bash
cd elixir && mix test \
  test/symphony_elixir/evidence/workspace_diff_test.exs \
  test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs
```

Expected: all PASS

- [ ] **Step 3: Manual smoke (optional)**

Open Diff modal on an issue with commits: add a commit note + line comment → Send to agent; switch Branch and confirm status strip; switch Não commitado empty/clean workspace and confirm empty CTAs.

- [ ] **Step 4: If any fix commits were needed, ensure working tree is clean for these files**

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Commit notes + line comments on Commits | 1, 6 |
| Enviar review accumulate (no persistence) | 1, 6 |
| Unified prompt with notes + sourced comments | 1 |
| Branch status strip + aggregated diff | 2, 3, 7 |
| Não commitado summary strip | 7 |
| File list +/- (already present) + 💬 badges | 4, 7 |
| Empty state with Refresh / View Branch | 7 |
| Backend metadata, graceful — | 2, 7 |
| No staging / no server note API | (non-goals; not scheduled) |
| i18n | 5 |

## Placeholder / consistency notes

- `buildDiffReviewPrompt(comments, notes = [])` signature is stable across Tasks 1 and 6.
- `DiffReviewSource` values match tab ids except Commits uses `"commit"` (not `"commits"`).
- `GitDiffRepo` metadata fields are optional so older fixtures in tests remain valid.
