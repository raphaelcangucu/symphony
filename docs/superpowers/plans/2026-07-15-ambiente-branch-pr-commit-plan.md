# Ambiente Branch/PR + Commit Sparkle/Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show labeled local + issue branches and linked PRs in the Ambiente dock; wire Commit to the real GitDiffModal commit dialog; add one-shot AI commit-message generation and a separate Push action (no auto-PR).

**Architecture:** Dock stays self-contained (stats/branches + issue `branchName` + `useIssuePullRequests`). Commit entry opens `GitDiffModal` into the existing commit dialog. New Elixir modules `WorkspacePush` and `CommitMessageGenerator` mirror `WorkspaceCommit` / `Evidence.Judge` (injectable runner, no tools, no persisted session). Tracker services call the new endpoints from the commit dialog.

**Tech Stack:** Elixir/Phoenix (tracker API), React 19 + vitest (tracker), existing `CodingAgent.run/4`, `PullRequestLink`, `GitDiffModal`.

**Spec:** [`docs/superpowers/specs/2026-07-15-ambiente-branch-pr-commit-design.md`](../specs/2026-07-15-ambiente-branch-pr-commit-design.md)

**WSL tests:** Run **one** targeted test file or single filter at a time; never full suite / parallel / directory-wide batches. Ask before expanding scope.

---

## File Structure

**Create:**

- `elixir/lib/symphony_elixir/evidence/workspace_push.ex` — `git push -u origin <branch>` per ahead repo
- `elixir/lib/symphony_elixir/evidence/commit_message_generator.ex` — one-shot no-tools message from diff summary
- `elixir/test/symphony_elixir/evidence/workspace_push_test.exs`
- `elixir/test/symphony_elixir/evidence/commit_message_generator_test.exs`

**Modify:**

- `elixir/lib/symphony_elixir/evidence/workspace_diff.ex` — `repo_summaries/1` (branch + ahead for all repos, including clean)
- `elixir/lib/symphony_elixir_web/controllers/tracker/workspace_diff_controller.ex` — `summaries`, `push`, `generate_commit_message`
- `elixir/lib/symphony_elixir_web/router.ex` — three new issue routes (+ thread push/generate only if modal already commits via thread)
- `elixir/test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs`
- `tracker/src/services/gitDiff.ts` — `getGitDiffSummaries`, `pushGitDiff`, `generateCommitMessage`
- `tracker/src/types/gitDiff.ts` — summary + push result types
- `tracker/src/hooks/useWorkspaceDiffStats.ts` — also expose `localBranch` (from summaries or stats)
- `tracker/src/hooks/useWorkspaceRepoSummaries.ts` — **create** if cleaner than overloading stats
- `tracker/src/components/sessions/IssueEnvironmentDock.tsx`
- `tracker/src/components/sessions/__tests__/IssueEnvironmentDock.test.tsx`
- `tracker/src/components/issues/issue-detail/git-diff/GitDiffLauncher.tsx`
- `tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx`
- `tracker/src/components/issues/issue-detail/git-diff/__tests__/…` (extend or create modal/launcher tests)
- `tracker/locales/en/tracker.json` + `tracker/locales/pt-BR/tracker.json`

---

### Task 1: `WorkspaceDiff.repo_summaries/1` (branch + ahead, including clean)

**Files:**

- Modify: `elixir/lib/symphony_elixir/evidence/workspace_diff.ex`
- Test: `elixir/test/symphony_elixir/evidence/workspace_diff_test.exs` (or new focused test file if none)

- [ ] **Step 1: Write the failing test**

Add a test that builds a temp workspace with one clean repo on branch `feat/local` and asserts:

```elixir
assert {:ok, [%{repo: "advising", branch: "feat/local", ahead_count: 0, dirty?: false}]} =
         WorkspaceDiff.repo_summaries(workspace)
```

Use the same temp-git helpers as existing `workspace_diff` / `workspace_diff_controller` tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/evidence/workspace_diff_test.exs --only line:<line>`

(or the new file path). Expected: FAIL (undefined function).

- [ ] **Step 3: Implement**

```elixir
@spec repo_summaries(Path.t(), keyword()) ::
        {:ok, [%{repo: String.t(), branch: String.t() | nil, ahead_count: non_neg_integer(), dirty?: boolean()}]}
def repo_summaries(workspace, opts \\ []) when is_binary(workspace) do
  if File.dir?(workspace) do
    summaries =
      workspace
      |> RunContract.repo_states(opts)
      |> Enum.map(fn repo ->
        %{
          repo: repo.name,
          branch: repo.branch,
          ahead_count: repo.ahead_count,
          dirty?: repo.dirty?
        }
      end)

    {:ok, summaries}
  else
    {:ok, []}
  end
end
```

Alias `RunContract` at top of module if missing. Do **not** change `stats/2` filtering behavior (dirty-only) — Ambiente uses `repo_summaries` so clean workspaces still show local branch.

- [ ] **Step 4: Re-run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/evidence/workspace_diff.ex \
  elixir/test/symphony_elixir/evidence/workspace_diff_test.exs
git commit -m "$(cat <<'EOF'
feat(elixir): add WorkspaceDiff.repo_summaries for branch/ahead

EOF
)"
```

---

### Task 2: `WorkspacePush.push/2`

**Files:**

- Create: `elixir/lib/symphony_elixir/evidence/workspace_push.ex`
- Test: `elixir/test/symphony_elixir/evidence/workspace_push_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.Evidence.WorkspacePushTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.WorkspacePush

  test "push skips repos with ahead_count 0" do
    runner = fn _bin, _args, _opts -> {"", 0} end
    # Build RepoState-like fixtures or temp repos with injectable runner
    assert {:ok, []} = WorkspacePush.push(workspace_with_clean_repo(), runner: runner)
  end

  test "push runs git push -u origin <branch> for ahead repos" do
    # Prefer: temp bare remote + clone with 1 local commit ahead, real git
    assert {:ok, [%{repo: _, ok: true}]} = WorkspacePush.push(workspace)
  end

  test "push returns partial errors without force" do
    # Mock runner returning non-zero on push → {:ok, [%{repo: _, ok: false, error: _}]}
    # OR {:partial, results} — pick ONE contract and stick to it:
    # Contract: always {:ok, [result]} where result = %{repo, ok: true} | %{repo, ok: false, error: binary}
  end
end
```

Prefer a **real temp git remote** for the happy path (same style as controller commit tests). Use injectable `runner` only for failure cases.

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/evidence/workspace_push_test.exs`

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Evidence.WorkspacePush do
  @moduledoc "Pushes ahead workspace branches to origin without creating PRs."

  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.RepoState

  @type push_result :: %{repo: String.t(), ok: true} | %{repo: String.t(), ok: false, error: String.t()}

  @spec push(Path.t(), keyword()) :: {:ok, [push_result()]}
  def push(workspace, opts \\ []) when is_binary(workspace) do
    runner = Keyword.get(opts, :runner, &System.cmd/3)

    results =
      workspace
      |> RunContract.repo_states()
      |> Enum.filter(&pushable?/1)
      |> Enum.map(&push_repo(&1, runner))

    {:ok, results}
  end

  defp pushable?(%RepoState{ahead_count: n}) when is_integer(n) and n > 0, do: true
  defp pushable?(%RepoState{upstream?: false, ahead_count: n}) when is_integer(n) and n > 0, do: true
  defp pushable?(_), do: false

  defp push_repo(%RepoState{} = repo, runner) do
    branch = repo.branch || "HEAD"
    case run(runner, "git", ["push", "-u", "origin", branch], repo.path) do
      :ok -> %{repo: repo.name, ok: true}
      {:error, output} -> %{repo: repo.name, ok: false, error: output}
    end
  end

  # run/4: wrap System.cmd like Finalizer — no --force
end
```

Also push when `ahead_count > 0` even if upstream missing (`-u` sets upstream). Never `--force` / `--force-with-lease`.

- [ ] **Step 4: Re-run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/evidence/workspace_push.ex \
  elixir/test/symphony_elixir/evidence/workspace_push_test.exs
git commit -m "$(cat <<'EOF'
feat(elixir): add WorkspacePush for issue workspace branches

EOF
)"
```

---

### Task 3: `CommitMessageGenerator.generate/2`

**Files:**

- Create: `elixir/lib/symphony_elixir/evidence/commit_message_generator.ex`
- Test: `elixir/test/symphony_elixir/evidence/commit_message_generator_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
test "generate returns trimmed message from runner" do
  runner = fn _workspace, _prompt, _issue, _opts ->
    {:ok, %{assistant_message: "feat: add dock branches\n\n"}}
  end

  assert {:ok, "feat: add dock branches"} =
           CommitMessageGenerator.generate(workspace, issue,
             runner: runner,
             diff_summary: "diff --git a/x b/x\n+hello"
           )
end

test "generate errors when diff summary blank" do
  assert {:error, :nothing_to_commit} =
           CommitMessageGenerator.generate(workspace, issue, diff_summary: "  ")
end

test "build_prompt asks for conventional commit only" do
  prompt = CommitMessageGenerator.build_prompt(%{
    identifier: "510",
    title: "Dock",
    diff_summary: "+ foo"
  })
  assert prompt =~ "Return only the final commit message"
  assert prompt =~ "510"
  assert prompt =~ "+ foo"
end
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/evidence/commit_message_generator_test.exs`

- [ ] **Step 3: Implement**

Pattern after `Evidence.Judge` / `Assistant.SideQuery`:

- `@system` instruction: concise conventional commit; return **only** the message; no tools.
- `build_prompt/1` pure.
- `generate/2` opts: `:runner` (default `&CodingAgent.run/4`), `:diff_summary`, optional `:issue` map `%{id, identifier, title}`.
- Call runner with `dynamic_tools: []` and deny-all `tool_executor`.
- Truncate `diff_summary` to e.g. 24_000 bytes before prompt (named constant `@max_diff_bytes`).
- Strip markdown fences if the model wraps the message.

Diff summary for the controller (next task) comes from `WorkspaceDiff.changes(workspace, :uncommitted)` or a compact `git diff` / stats+file list — prefer concatenating short patches or `git diff --stat` + file names to stay under the cap.

- [ ] **Step 4: Re-run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/evidence/commit_message_generator.ex \
  elixir/test/symphony_elixir/evidence/commit_message_generator_test.exs
git commit -m "$(cat <<'EOF'
feat(elixir): one-shot commit message generator without tools

EOF
)"
```

---

### Task 4: Controller + routes for summaries, push, generate-commit-message

**Files:**

- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/workspace_diff_controller.ex`
- Modify: `elixir/test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs`

- [ ] **Step 1: Write failing controller tests**

```elixir
test "summaries returns branch and ahead for workspace repos", %{issue: issue} do
  conn = get(authorized_conn(), "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff/summaries")
  assert %{"data" => [%{"repo" => _, "branch" => _, "ahead_count" => _, "dirty" => _}]} =
           json_response(conn, 200)
end

test "push returns per-repo results", %{issue: issue} do
  # Setup: commit ahead of origin (reuse commit test helpers + bare remote if needed)
  conn = post(authorized_conn(), "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff/push")
  assert %{"data" => data} = json_response(conn, 200)
  assert is_list(data)
end

test "generate-commit-message returns message", %{issue: issue} do
  # Prefer Application.put_env / bypass runner via process dict ONLY if project already does that.
  # Otherwise unit-test generator thoroughly and here stub by making workspace dirty +
  # configuring a test runner adapter registered in config/test.exs.
  # Minimum: endpoint returns 200 with %{"data" => %{"message" => message}} when generator succeeds.
end
```

If injecting the CodingAgent runner in controller tests is hard, test controller with `Mox`/`:runner` only at module level via `CommitMessageGenerator` already covered, and controller test asserts routing + `nothing_to_commit` → 422 when workspace clean.

- [ ] **Step 2: Run failing tests**

Run: `cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs --only line:<first_new_test_line>`

- [ ] **Step 3: Add routes**

In `router.ex` next to existing diff routes (~171–175):

```elixir
get("/projects/:project_slug/issues/:identifier/diff/summaries", WorkspaceDiffController, :summaries)
post("/projects/:project_slug/issues/:identifier/diff/push", WorkspaceDiffController, :push)
post("/projects/:project_slug/issues/:identifier/diff/generate-commit-message", WorkspaceDiffController, :generate_commit_message)
```

- [ ] **Step 4: Implement controller actions**

Reuse `issue_workspace/2`, `TrackerErrors`, issue lookup for generate:

```elixir
def summaries(conn, %{"project_slug" => slug, "identifier" => id}) do
  with {:ok, workspace} <- issue_workspace(slug, id),
       {:ok, summaries} <- WorkspaceDiff.repo_summaries(workspace) do
    json(conn, %{data: Enum.map(summaries, &summary_json/1), workspace: workspace_brief(workspace)})
  else
    {:error, reason} -> TrackerErrors.render(conn, reason)
  end
end

def push(conn, %{"project_slug" => slug, "identifier" => id}) do
  with {:ok, workspace} <- issue_workspace(slug, id),
       {:ok, results} <- WorkspacePush.push(workspace) do
    json(conn, %{data: Enum.map(results, &push_json/1), workspace: workspace_brief(workspace)})
  else
    {:error, reason} -> TrackerErrors.render(conn, reason)
  end
end

def generate_commit_message(conn, %{"project_slug" => slug, "identifier" => id}) do
  with {:ok, workspace} <- issue_workspace(slug, id),
       {:ok, issue} <- load_issue(slug, id),
       {:ok, summary} <- diff_summary_for_commit(workspace),
       {:ok, message} <- CommitMessageGenerator.generate(workspace, issue, diff_summary: summary) do
    json(conn, %{data: %{message: message}})
  else
    {:error, reason} -> TrackerErrors.render(conn, reason)
  end
end
```

Map `:nothing_to_commit` / `:invalid_commit_message` in `TrackerErrors` if missing.

JSON keys: snake_case in API (`ahead_count`, `dirty`); frontend normalizer converts to camelCase.

- [ ] **Step 5: Re-run targeted controller tests — PASS**

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/router.ex \
  elixir/lib/symphony_elixir_web/controllers/tracker/workspace_diff_controller.ex \
  elixir/test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs
# + TrackerErrors if changed
git commit -m "$(cat <<'EOF'
feat(elixir): expose diff summaries, push, and generate-commit-message APIs

EOF
)"
```

---

### Task 5: Tracker gitDiff client types + services

**Files:**

- Modify: `tracker/src/types/gitDiff.ts`
- Modify: `tracker/src/services/gitDiff.ts`
- Test: `tracker/src/services/__tests__/gitDiff.test.ts` (create or extend)

- [ ] **Step 1: Failing unit tests for normalizers / URL paths**

```ts
it("normalizeRepoSummary maps ahead_count and dirty", () => {
  expect(normalizeRepoSummary({ repo: "a", branch: "feat", ahead_count: 2, dirty: true })).toEqual({
    repo: "a",
    branch: "feat",
    aheadCount: 2,
    dirty: true,
  });
});
```

If services aren't unit-tested today, add a small pure export for normalizers or test via mocked `fetch`.

- [ ] **Step 2: Implement types + functions**

```ts
// types
export interface GitDiffRepoSummary {
  repo: string;
  branch: string | null;
  aheadCount: number;
  dirty: boolean;
}

export interface GitDiffPushResult {
  repo: string;
  ok: boolean;
  error?: string;
}

// services
export async function getGitDiffSummaries(projectSlug: string, identifier: string, init?: RequestInit)
export async function pushGitDiff(projectSlug: string, identifier: string, init?: RequestInit)
export async function generateCommitMessage(projectSlug: string, identifier: string, init?: RequestInit): Promise<string>
```

Paths:

- `GET /projects/:slug/issues/:id/diff/summaries`
- `POST /projects/:slug/issues/:id/diff/push`
- `POST /projects/:slug/issues/:id/diff/generate-commit-message`

Mirror `commitGitDiff` auth/headers patterns exactly.

- [ ] **Step 3: Run** `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/services/__tests__/gitDiff.test.ts` — PASS

- [ ] **Step 4: Commit**

```bash
git add tracker/src/types/gitDiff.ts tracker/src/services/gitDiff.ts tracker/src/services/__tests__/gitDiff.test.ts
git commit -m "$(cat <<'EOF'
feat(tracker): client for diff summaries, push, and commit-message generate

EOF
)"
```

---

### Task 6: Hook `useWorkspaceRepoSummaries` + dock branch/PR UI

**Files:**

- Create: `tracker/src/hooks/useWorkspaceRepoSummaries.ts`
- Modify: `tracker/src/components/sessions/IssueEnvironmentDock.tsx`
- Modify: `tracker/src/components/sessions/__tests__/IssueEnvironmentDock.test.tsx`
- Modify: locales `en` + `pt-BR`

- [ ] **Step 1: Extend dock tests (fail first)**

```tsx
vi.mock("@/hooks/useWorkspaceRepoSummaries", () => ({
  useWorkspaceRepoSummaries: () => ({
    localBranch: "feat/local-checkout",
    aheadCount: 0,
    dirty: true,
  }),
}));

vi.mock("@/hooks/useIssuePullRequests", () => ({
  useIssuePullRequests: () => ({
    pullRequests: [{ number: 42, title: "Dock", url: "https://github.com/o/r/pull/42", repo: "advising", state: "open" }],
    children: [],
    supported: true,
    available: true,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/services/issues", () => ({
  getIssue: vi.fn().resolvedValue({ branchName: "symphony/510", /* minimal Issue fields */ }),
}));

it("shows labeled local and issue branches and linked PRs", async () => {
  // render dock without branch prop
  expect(screen.getByText(/local/i)).toBeInTheDocument();
  expect(screen.getByText("feat/local-checkout")).toBeInTheDocument();
  expect(screen.getByText(/issue/i)).toBeInTheDocument();
  expect(screen.getByText("symphony/510")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /#42|42/i })).toBeInTheDocument(); // adjust to PullRequestLink a11y name
});

it("opens commit dialog request when Commit & push is clicked", async () => {
  // mock GitDiffLauncher to expose data-open-commit-request-id
  await user.click(screen.getByRole("button", { name: /commit/i }));
  expect(screen.getByTestId("git-diff-launcher")).toHaveAttribute("data-open-commit-request-id", "1");
});
```

Update existing test that passes `branch="feature/env-dock"` — either remove prop usage or keep prop as override; **prefer self-contained fetch** and drop unused `branch` prop if nothing else passes it.

- [ ] **Step 2: Run dock test — expect FAIL**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/sessions/__tests__/IssueEnvironmentDock.test.tsx`

- [ ] **Step 3: Implement hook + dock UI**

`useWorkspaceRepoSummaries`: fetch `getGitDiffSummaries`; derive `localBranch` = first non-null branch (or unique join if multi-repo — show first + `+N` only if needed; YAGNI: first dirty repo's branch, else first branch).

Dock:

- Load issue via `getIssue` in `useEffect` for `branchName` (or small `useIssueBranch` hook).
- Render:

```tsx
{(localBranch || issueBranch) && (
  <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
    {localBranch ? (
      <div className="flex items-center gap-1.5">
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0">{t("assistant.environment.localBranch")}</span>
        <span className="truncate font-mono" title={localBranch}>{localBranch}</span>
      </div>
    ) : null}
    {issueBranch ? ( /* same with issueBranch key */ ) : null}
  </div>
)}
```

PRs section with `PullRequestLink` (import from pull-request components). `onOpen` can be no-op or open URL — match SummaryTab: if `onOpenPullRequest` not available, use default link navigation (`PullRequestLink` already links out).

Replace `navigate(...)` in `openCommitPush` with bumping `commitRequestId` passed to `GitDiffLauncher` (Task 7).

i18n keys:

```json
"localBranch": "Local",
"issueBranch": "Issue",
"linkedPullRequests": "Linked PRs",
"generateCommitMessage": "Generate commit message",
"push": "Push",
"pushing": "Pushing…",
"pushSuccess": "Pushed {{count}} repo(s).",
"pushFailed": "Push failed.",
"generateFailed": "Could not generate commit message."
```

(pt-BR equivalents: `Local`, `Issue`, `PRs vinculados`, etc.)

Place generate/push strings under `issue.diff.commit.*`.

- [ ] **Step 4: Re-run dock tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/hooks/useWorkspaceRepoSummaries.ts \
  tracker/src/components/sessions/IssueEnvironmentDock.tsx \
  tracker/src/components/sessions/__tests__/IssueEnvironmentDock.test.tsx \
  tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "$(cat <<'EOF'
feat(tracker): show local/issue branches and linked PRs in Ambiente

EOF
)"
```

---

### Task 7: `GitDiffLauncher` open-commit-dialog request

**Files:**

- Modify: `tracker/src/components/issues/issue-detail/git-diff/GitDiffLauncher.tsx`
- Modify: `GitDiffModal.tsx` props
- Test: launcher or dock test (already asserts attribute)

- [ ] **Step 1: Add prop + failing assertion in launcher test** (create thin test if none)

```tsx
interface GitDiffLauncherProps {
  // ...
  openCommitDialogRequestId?: number;
}

// When openCommitDialogRequestId increments: setOpen(true) and pass initialCommitDialogOpen
```

- [ ] **Step 2: Implement**

```tsx
const [openCommitDialog, setOpenCommitDialog] = useState(false);

useEffect(() => {
  if (openCommitDialogRequestId > 0) {
    setOpenCommitDialog(true);
    openModal();
  }
}, [openCommitDialogRequestId, openModal]);

<GitDiffModal
  ...
  initialCommitDialogOpen={openCommitDialog}
  onCommitDialogOpened={() => setOpenCommitDialog(false)}
/>
```

In `GitDiffModal`:

```tsx
useEffect(() => {
  if (open && initialCommitDialogOpen) {
    setCommitDialogOpen(true);
    onCommitDialogOpened?.();
  }
}, [open, initialCommitDialogOpen, onCommitDialogOpened]);
```

Wire Ambiente dock:

```tsx
const [commitRequestId, setCommitRequestId] = useState(0);
const openCommitPush = () => setCommitRequestId((n) => n + 1);

<GitDiffLauncher
  openRequestId={compareRequestId}
  openCommitDialogRequestId={commitRequestId}
  showTrigger={false}
  ...
/>
```

- [ ] **Step 3: Run dock test — PASS**

- [ ] **Step 4: Commit**

```bash
git add tracker/src/components/issues/issue-detail/git-diff/GitDiffLauncher.tsx \
  tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx \
  tracker/src/components/sessions/IssueEnvironmentDock.tsx \
  tracker/src/components/sessions/__tests__/IssueEnvironmentDock.test.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): Ambiente Commit opens GitDiffModal commit dialog

EOF
)"
```

---

### Task 8: Commit dialog sparkle + Push button

**Files:**

- Modify: `tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx`
- Test: create `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.commitDialog.test.tsx` (or extend existing)
- Locales: `issue.diff.commit.generate*`, `push*`

- [ ] **Step 1: Failing tests with mocked services**

```tsx
vi.mock("@/services/gitDiff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/gitDiff")>();
  return {
    ...actual,
    generateCommitMessage: vi.fn().mockResolvedValue("feat: generated"),
    pushGitDiff: vi.fn().mockResolvedValue([{ repo: "advising", ok: true }]),
    commitGitDiff: vi.fn().mockResolvedValue([]),
  };
});

it("sparkle fills the commit message", async () => {
  // open modal with commit dialog open
  await user.click(screen.getByRole("button", { name: /generate commit message/i }));
  expect(await screen.findByDisplayValue("feat: generated")).toBeInTheDocument();
});

it("push button calls pushGitDiff", async () => {
  // enable push via summaries mock aheadCount > 0 OR after commit success sets canPush
  await user.click(screen.getByRole("button", { name: /^push$/i }));
  expect(pushGitDiff).toHaveBeenCalled();
});
```

GitDiffModal is large — prefer testing an extracted `WorkspaceCommitDialog` presentational component if extraction is small; otherwise render modal with `open` + `initialCommitDialogOpen`.

- [ ] **Step 2: Run — FAIL**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.commitDialog.test.tsx`

- [ ] **Step 3: Implement UI**

In commit dialog content:

```tsx
<div className="relative space-y-2">
  <label ...>...</label>
  <Textarea id="workspace-commit-message" ... />
  <Button
    type="button"
    variant="ghost"
    size="icon"
    className="absolute right-2 top-8 h-7 w-7"
    aria-label={t("issue.diff.commit.generate")}
    disabled={generatePending || !identifier}
    onClick={() => void onGenerate()}
  >
    {generatePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
  </Button>
</div>
<DialogFooter>
  <Button variant="outline" onClick={...cancel}>...</Button>
  <Button type="button" variant="secondary" disabled={!canPush || pushPending} onClick={() => void onPush()}>
    {pushPending ? t("issue.diff.commit.pushing") : t("issue.diff.commit.push")}
  </Button>
  <Button type="button" onClick={() => void submitCommit()} disabled={...}>
    ...
  </Button>
</DialogFooter>
```

`canPush`: from `getGitDiffSummaries` when dialog opens (`aheadCount > 0` any repo) **or** set `true` after successful commit in this dialog session.

`onGenerate`: `generateCommitMessage(projectSlug, identifier)` → `setCommitMessage`.

`onPush`: `pushGitDiff` → toast success/partial errors; refetch summaries.

Thread-id path: if only `threadId` (no identifier), sparkle/push **disabled** unless thread endpoints added (spec: issue path priority). Do not block issue path on thread symmetry.

- [ ] **Step 4: Re-run — PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx \
  tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.commitDialog.test.tsx \
  tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "$(cat <<'EOF'
feat(tracker): AI commit message sparkle and Push in commit dialog

EOF
)"
```

---

### Task 9: Spec self-check + smoke

- [ ] **Step 1: Checklist vs spec**

| Spec requirement | Task |
|------------------|------|
| Local + Issue branches labeled | 6 |
| All linked PRs compact | 6 |
| Commit opens modal dialog | 7 |
| Sparkle one-shot no session | 3, 4, 8 |
| Commit API existing | 8 (uses existing) |
| Push separate, no PR, no force | 2, 4, 8 |
| Hide empty branch/PR sections | 6 |
| Edge: nothing to commit / ahead | 3, 8 |

- [ ] **Step 2: Run one elixir + one tracker targeted file already touched** (sequential)

```bash
cd /home/raphaelcangucu/symphony/elixir && mix test test/symphony_elixir/evidence/workspace_push_test.exs
cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/sessions/__tests__/IssueEnvironmentDock.test.tsx
```

- [ ] **Step 3: Final commit only if docs/plan checkbox updates needed** — update this plan's checkboxes as work proceeds; no empty commit.

---

## Self-review (plan author)

1. **Spec coverage:** All goals in §2 of the design map to Tasks 1–8; non-goals (auto-PR, force, Magic dispatch) excluded.  
2. **Placeholders:** None intentional — controller generate test notes injection strategy but requires a concrete 422/`nothing_to_commit` path at minimum.  
3. **Types:** API `ahead_count` / frontend `aheadCount`; push result `{repo, ok, error?}` consistent across Tasks 2–5–8.  
4. **WSL:** Every run step is a single file or `--only line:`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-15-ambiente-branch-pr-commit-plan.md`.

Documents:
- Plan: `docs/superpowers/plans/2026-07-15-ambiente-branch-pr-commit-plan.md`
- Spec: `docs/superpowers/specs/2026-07-15-ambiente-branch-pr-commit-design.md`

**Next:** implement Task 1 with TDD (subagent-driven-development or executing-plans).
