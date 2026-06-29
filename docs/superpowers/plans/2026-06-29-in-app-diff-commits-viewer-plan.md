# In-app Diff / Commits Viewer Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. One focused subagent per task with review between tasks. Run the exact test commands shown. Commit after every task.

**Goal:** Add a Jean-style `GitDiffModal` to the tracker that shows an issue workspace's code changes in-app — `uncommitted` (working tree), `branch` (HEAD vs default-branch merge-base), and a **Commits** tab — with a changed-file tree, split/unified rendering, syntax highlighting, and +/- counts, across multiple repos, without leaving for GitHub.

**Architecture:** A new backend module `Evidence.WorkspaceDiff` runs `git diff` per workspace repo and returns full unified per-file **patches** in the same `file_change` shape `Evidence.Commits` already uses (`%{path, old_path, status, patch}`), so the frontend renders ONE shape for all three diff types. A thin Phoenix controller exposes it at `GET /projects/:slug/issues/:id/diff?type=uncommitted|branch`; the **Commits** tab reuses the existing `commit_evidence` endpoints (`Evidence.Commits.list/2` + `show/3`). The frontend adds a lazy-loaded `GitDiffModal` (Radix Dialog) with a ported `buildFileTree`, a `useGitDiff` data hook (mirroring `useIssueCommitEvidence`), per-file rendering via `@pierre/diffs`, a persisted split/unified toggle, and a "Diff" button + `⌘G` shortcut on the Execution toolbar.

**Tech Stack:** Elixir/Phoenix + ExUnit (`System.cmd("git", …)`); React 19 + Vite + TypeScript + Radix Dialog/Tabs + `@pierre/diffs` (Shiki) + vitest.

---

**Depends on / relates to:**
- `2026-06-26-project-sessions-panel-plan.md` and `2026-06-27-magic-commands-palette-plan.md` (sibling plan style; the Execution toolbar / `ExecutionControlComposer` is the shared mount point).
- Existing commit-evidence stack (backend `Evidence.Commits` + `CommitEvidenceController`; frontend `services/commitEvidence.ts`, `useIssueCommitEvidence`, `CommitDiffSheet`) — the Commits tab **reuses** this, and `GitDiffModal` supersedes the ad‑hoc `CommitDiffSheet` rendering with `@pierre/diffs`.

**Jean references (inspiration — not in this repo):**
- `src/components/chat/MessageDiffModal.tsx` — inline per-message edited-file diff ("current change" vs "all changes").
- Jean `GitDiffModal` — lazy-loaded, opened via `Cmd+G`; tabs `uncommitted` / `staged` / `branch` / `commit`; a Commits explorer tab (browse branch history, per-commit diffs, switch which commit is shown).
- `src/components/chat/FileDiffModal.tsx` — single-file diff using `@pierre/diffs`.
- `src/components/chat/git-diff-tree.ts` → `buildFileTree` (folders-before-files, `compactFolders` single-child chains), tested in `src/components/chat/git-diff-tree.test.ts`.
- `src/lib/diff-stats.ts` (+/- counts), tested in `src/lib/diff-stats.test.ts`.
- Diffs docs: <https://diffs.com/docs> (`parsePatchFiles`, `FileDiff` / `MultiFileDiff` / `PatchDiff`, split/stacked layouts, Vite worker note).

**Verified Symphony anchors (read before coding):**
- `elixir/lib/symphony_elixir/evidence/git_diff.ex` — `changed_files/1` returns NAMES only; model for `diff_base/1` (`origin/<default>...HEAD`) + porcelain/untracked handling.
- `elixir/lib/symphony_elixir/evidence/commits.ex` — `list/2` + `show/3`; `commit_files/2`/`build_file_change/5` already produce the `%{path, old_path, status, patch}` shape we mirror, and `status_letter/1` (A/D/M/T → added/deleted/modified/type_changed).
- `elixir/lib/symphony_elixir/run_contract.ex` — `RunContract.repo_states/1` + `RepoState{name, path, default_branch}` enumerate workspace repos.
- `elixir/lib/symphony_elixir/workspace.ex` — `Workspace.path_for_issue/1` resolves the workspace root.
- `elixir/lib/symphony_elixir_web/controllers/tracker/commit_evidence_controller.ex` + its test — controller/auth/route/test pattern (route in `router.ex`, `tracker_api` scope, prefix `/api/tracker/v1`).
- `elixir/lib/symphony_elixir_web/tracker_errors.ex` — JSON error rendering (we add `:invalid_diff_type`).
- Frontend: `tracker/src/services/commitEvidence.ts`, `tracker/src/hooks/useIssueCommitEvidence.ts`, `tracker/src/types/commitEvidence.ts`, `tracker/src/components/issues/issue-detail/CommitDiffSheet.tsx`, `tracker/src/components/ui/dialog.tsx` + `ui/tabs.tsx` + `ui/button.tsx`, `tracker/src/components/board/BoardPaletteShortcuts.tsx` (inline `keydown` shortcut pattern), `tracker/src/services/http.ts` (`http` + `trackerPath`), `tracker/src/i18n/testUtils.tsx`.

**Decisions (justified):**
1. **Place the new module in the `Evidence` namespace** (`Evidence.WorkspaceDiff`), not a new `Workspace.Diff`. Reason: it is the same concern as `Evidence.GitDiff`/`Evidence.Commits` (read-only git inspection of an issue workspace, driven by `RunContract.repo_states/1`), reuses their helpers and output shape, and keeps all workspace-diff evidence colocated.
2. **Data hooks use `useState`/`useEffect`** (mirroring `useIssueCommitEvidence`), NOT TanStack Query — TanStack Query is **not** a dependency of this repo (`tracker/package.json`). The spec's "TanStack Query hook" is adapted to the established pattern.
3. **No new commit endpoint** — the Commits tab reuses the existing `commit_evidence` index/show endpoints and `services/commitEvidence.ts`. The new backend endpoint covers only `uncommitted`/`branch` (where patches don't exist yet).
4. **Identifier, not issueId** — workspace resolution needs `project_slug` + issue `identifier` (mirroring `CommitEvidenceController`), so `useGitDiff` takes `(projectSlug, identifier, type)`.
5. **v1 renders one selected file at a time** (single `FileDiff`), which bounds memory naturally; `CodeView`/`Virtualizer` + worker pool are noted as the scale-up path (see Risks). No worker pool in v1 (YAGNI).

---

## File Structure

**Create (backend):**
- `elixir/lib/symphony_elixir/evidence/workspace_diff.ex` — `Evidence.WorkspaceDiff.changes/2` → `{:ok, [%{repo, files: [%{path, old_path, status, patch}]}]}`.
- `elixir/lib/symphony_elixir_web/controllers/tracker/workspace_diff_controller.ex` — `GET …/diff?type=…`.
- `elixir/test/symphony_elixir/evidence/workspace_diff_test.exs`
- `elixir/test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs`

**Modify (backend):**
- `elixir/lib/symphony_elixir_web/router.ex` — add the `diff` route (tracker_api scope, next to `commit_evidence`).
- `elixir/lib/symphony_elixir_web/tracker_errors.ex` — add `:invalid_diff_type` (422).

**Create (frontend):**
- `tracker/src/types/gitDiff.ts`
- `tracker/src/services/gitDiff.ts`
- `tracker/src/hooks/useGitDiff.ts`
- `tracker/src/hooks/useGitDiffShortcut.ts`
- `tracker/src/lib/gitDiffTree.ts`
- `tracker/src/lib/diffStats.ts`
- `tracker/src/lib/diffViewMode.ts`
- `tracker/src/components/issues/issue-detail/git-diff/GitDiffViewer.tsx`
- `tracker/src/components/issues/issue-detail/git-diff/GitDiffFileTree.tsx`
- `tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx` (default export, lazy-loaded)
- `tracker/src/components/issues/issue-detail/git-diff/GitDiffLauncher.tsx` (button + lazy modal + shortcut)
- tests: `lib/__tests__/gitDiffTree.test.ts`, `lib/__tests__/diffStats.test.ts`, `lib/__tests__/diffViewMode.test.ts`, `services/__tests__/gitDiff.test.ts`, `hooks/__tests__/useGitDiff.test.tsx`, `components/issues/issue-detail/git-diff/__tests__/{GitDiffViewer,GitDiffFileTree,GitDiffModal,GitDiffLauncher}.test.tsx`.

**Modify (frontend):**
- `tracker/package.json` — add `@pierre/diffs`.
- `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx` — mount `<GitDiffLauncher>` in `toolbarAfterAttach`.
- `tracker/locales/en/tracker.json` + `tracker/locales/pt-BR/tracker.json` — `issue.diff.*` keys.

---

## Task 1: Backend — `Evidence.WorkspaceDiff` (uncommitted + branch patches)

**Files:**
- Create: `elixir/lib/symphony_elixir/evidence/workspace_diff.ex`
- Test: `elixir/test/symphony_elixir/evidence/workspace_diff_test.exs`

Returns a per-repo list (multi-repo aware), each repo carrying the same `file_change` shape as `Evidence.Commits`. `:branch` mirrors `GitDiff.diff_base/1` (`origin/<default>...HEAD`, else `HEAD`). `:uncommitted` = tracked changes vs `HEAD` plus untracked files (patched via `git diff --no-index`, which exits `1` but still prints a valid patch). Clean repos are dropped.

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Evidence.WorkspaceDiffTest do
  use ExUnit.Case, async: true

  import SymphonyElixir.GitFixtures

  alias SymphonyElixir.Evidence.WorkspaceDiff

  @moduletag :tmp_dir

  defp commit_base_branch!(repo) do
    sh!(repo, "git checkout -b feat/x")
  end

  test "branch diff returns per-file patches vs origin default base", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "frontend")
    commit_base_branch!(repo)
    sh!(repo, "mkdir -p src && printf 'a\\n' > src/App.tsx && git add -A && git commit -m work")

    assert {:ok, [%{repo: "frontend", files: files}]} = WorkspaceDiff.changes(ws, :branch)
    assert [%{path: "src/App.tsx", status: "added", old_path: nil, patch: patch}] = files
    assert patch =~ "src/App.tsx"
    assert patch =~ "+a"
  end

  test "uncommitted diff includes tracked edits and untracked files", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "backend")
    # README.md is tracked from make_repo!; edit it and add an untracked file.
    sh!(repo, "printf 'changed\\n' > README.md && printf 'new\\n' > new.txt")

    assert {:ok, [%{repo: "backend", files: files}]} = WorkspaceDiff.changes(ws, :uncommitted)
    paths = files |> Enum.map(& &1.path) |> Enum.sort()
    assert paths == ["README.md", "new.txt"]
    assert Enum.find(files, &(&1.path == "new.txt")).status == "added"
    assert Enum.find(files, &(&1.path == "README.md")).status == "modified"
    assert Enum.all?(files, &(&1.patch =~ &1.path))
  end

  test "clean repos are omitted", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    make_repo!(tmp_dir, ws, "frontend")

    assert {:ok, []} = WorkspaceDiff.changes(ws, :uncommitted)
  end

  test "missing workspace yields an empty list", %{tmp_dir: tmp_dir} do
    assert {:ok, []} = WorkspaceDiff.changes(Path.join(tmp_dir, "nope"), :branch)
  end

  test "invalid type is rejected", %{tmp_dir: tmp_dir} do
    assert {:error, :invalid_diff_type} = WorkspaceDiff.changes(tmp_dir, :bogus)
  end
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/evidence/workspace_diff_test.exs`
Expected: FAIL with `module SymphonyElixir.Evidence.WorkspaceDiff is not available`.

- [ ] **Step 3: Write the implementation**

```elixir
defmodule SymphonyElixir.Evidence.WorkspaceDiff do
  @moduledoc """
  Computes full unified per-file PATCHES for an issue workspace.

  Supports two diff types:

    * `:uncommitted` — working-tree changes (tracked edits vs `HEAD` plus
      untracked files), mirroring `Evidence.GitDiff`'s notion of "changed".
    * `:branch` — `HEAD` vs the merge-base with the default branch
      (`origin/<default>...HEAD`), mirroring `Evidence.GitDiff.diff_base/1`.

  Returns the same per-file `file_change` shape as `Evidence.Commits` so the
  tracker renders one shape for uncommitted/branch/commit diffs. Reuses
  `RunContract.repo_states/1` to be multi-repo aware. Read-only.
  """

  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.RepoState

  @type diff_type :: :uncommitted | :branch

  @type file_change :: %{
          path: String.t(),
          old_path: String.t() | nil,
          status: String.t(),
          patch: String.t()
        }

  @type repo_diff :: %{repo: String.t(), files: [file_change()]}

  @spec changes(Path.t(), diff_type()) :: {:ok, [repo_diff()]} | {:error, :invalid_diff_type}
  def changes(workspace, type) when is_binary(workspace) and type in [:uncommitted, :branch] do
    if File.dir?(workspace) do
      repos =
        workspace
        |> RunContract.repo_states()
        |> Enum.map(&%{repo: &1.name, files: repo_files(&1, type)})
        |> Enum.reject(fn %{files: files} -> files == [] end)

      {:ok, repos}
    else
      {:ok, []}
    end
  end

  def changes(_workspace, _type), do: {:error, :invalid_diff_type}

  defp repo_files(%RepoState{} = repo, :branch) do
    base = diff_base(repo)

    repo
    |> name_status(["diff", "--no-color", "--name-status", base])
    |> Enum.map(&file_change(repo, &1, ["diff", "--no-color", base, "--"]))
  end

  defp repo_files(%RepoState{} = repo, :uncommitted) do
    tracked =
      repo
      |> name_status(["diff", "--no-color", "--name-status", "HEAD"])
      |> Enum.map(&file_change(repo, &1, ["diff", "--no-color", "HEAD", "--"]))

    untracked =
      repo
      |> untracked_files()
      |> Enum.map(&untracked_change(repo, &1))

    tracked ++ untracked
  end

  defp diff_base(%RepoState{default_branch: default}) when is_binary(default) and default != "",
    do: "origin/#{default}...HEAD"

  defp diff_base(_repo), do: "HEAD"

  defp name_status(%RepoState{} = repo, args) do
    case git(repo.path, args) do
      {:ok, output} ->
        output
        |> String.split("\n", trim: true)
        |> Enum.map(&parse_status_line/1)
        |> Enum.reject(&is_nil/1)

      {:error, _} ->
        []
    end
  end

  # "M\tpath" | "A\tpath" | "R100\told\tnew" | "C75\told\tnew" -> {status, path, old_path}
  defp parse_status_line(line) do
    case String.split(line, "\t", parts: 3) do
      [<<"R", _::binary>>, old_path, new_path] -> {"renamed", new_path, old_path}
      [<<"C", _::binary>>, old_path, new_path] -> {"copied", new_path, old_path}
      [status, path] -> {status_letter(status), path, nil}
      _ -> nil
    end
  end

  defp status_letter("A"), do: "added"
  defp status_letter("D"), do: "deleted"
  defp status_letter("M"), do: "modified"
  defp status_letter("T"), do: "type_changed"
  defp status_letter(other), do: other

  defp file_change(%RepoState{} = repo, {status, path, old_path}, patch_prefix_args) do
    patch =
      case git(repo.path, patch_prefix_args ++ [path]) do
        {:ok, content} -> content
        {:error, _} -> ""
      end

    %{path: path, old_path: old_path, status: status, patch: patch}
  end

  defp untracked_files(%RepoState{} = repo) do
    case git(repo.path, ["ls-files", "--others", "--exclude-standard"]) do
      {:ok, output} -> String.split(output, "\n", trim: true)
      {:error, _} -> []
    end
  end

  defp untracked_change(%RepoState{} = repo, path) do
    patch =
      case git_allow_diff(repo.path, ["diff", "--no-color", "--no-index", "--", "/dev/null", path]) do
        {:ok, content} -> content
        {:error, _} -> ""
      end

    %{path: path, old_path: nil, status: "added", patch: patch}
  end

  defp git(path, args) do
    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {output, 0} -> {:ok, String.trim_trailing(output)}
      {output, status} -> {:error, {status, String.trim_trailing(output)}}
    end
  end

  # `git diff --no-index` exits 1 when files differ but still prints a valid patch.
  defp git_allow_diff(path, args) do
    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {output, status} when status in [0, 1] -> {:ok, String.trim_trailing(output)}
      {output, status} -> {:error, {status, String.trim_trailing(output)}}
    end
  end
end
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/evidence/workspace_diff_test.exs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/evidence/workspace_diff.ex elixir/test/symphony_elixir/evidence/workspace_diff_test.exs
git commit -m "feat(diff): Evidence.WorkspaceDiff per-file patches for uncommitted/branch"
```

---

## Task 2: Backend — `WorkspaceDiffController` + route + error

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/workspace_diff_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex` (after the `commit_evidence` show route, line ~144)
- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex` (add `:invalid_diff_type`)
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs`

- [ ] **Step 1: Write the failing controller test** (mirrors `commit_evidence_controller_test.exs` setup exactly)

```elixir
defmodule SymphonyElixirWeb.Tracker.WorkspaceDiffControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  @moduletag :tmp_dir

  setup %{tmp_dir: tmp_dir} do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    on_exit(fn -> restore_env(@token_env, previous_token) end)

    {:ok, _project} = Context.ensure_project(%{name: "ADV", slug: "advising"})

    {:ok, _setup} =
      Context.upsert_project_setup("advising", %{
        "workflow_markdown" => """
        ---
        workspace:
          root: #{tmp_dir}
        ---
        """
      })

    {:ok, issue} = Context.create_issue("advising", %{"title" => "Diff", "status" => "Todo"})

    repo = Path.join(tmp_dir, "repo")
    File.mkdir_p!(repo)
    sh!(repo, "git init -b pre-release")
    sh!(repo, ~s(git config user.email "agent@test.local"))
    sh!(repo, "git config user.name \"Symphony Agent\"")
    sh!(repo, "echo base > README.md && git add README.md && git commit -m 'chore: base'")
    sh!(repo, "git checkout -b feature/symphony")
    sh!(repo, "echo work > work.txt && git add work.txt && git commit -m 'feat: agent work'")
    sh!(repo, "echo dirty >> work.txt")
    sh!(repo, "git remote add origin .")
    sh!(repo, "git update-ref refs/remotes/origin/pre-release pre-release")
    sh!(repo, "git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/pre-release")

    workspace = Path.join([tmp_dir, "advising", issue.identifier])
    File.mkdir_p!(workspace)
    File.rename!(repo, Path.join(workspace, "advising"))

    %{issue: issue}
  end

  test "branch diff returns per-repo file patches", ctx do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{ctx.issue.identifier}/diff?type=branch"
      )

    assert %{"data" => [repo], "type" => "branch", "workspace" => workspace} = json_response(conn, 200)
    assert workspace["available"] == true
    assert repo["repo"] == "advising"
    assert [%{"path" => "work.txt", "patch" => patch} | _] = repo["files"]
    assert patch =~ "work.txt"
  end

  test "uncommitted diff returns the dirty working tree", ctx do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{ctx.issue.identifier}/diff?type=uncommitted"
      )

    assert %{"data" => [repo], "type" => "uncommitted"} = json_response(conn, 200)
    assert [%{"path" => "work.txt", "status" => "modified"} | _] = repo["files"]
  end

  test "missing type -> 422 invalid_diff_type", ctx do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{ctx.issue.identifier}/diff"
      )

    assert %{"error" => %{"code" => "invalid_diff_type"}} = json_response(conn, 422)
  end

  defp authorized_conn do
    build_conn() |> Plug.Conn.put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)

  defp sh!(cwd, command) do
    {output, status} = System.cmd("bash", ["-lc", command], cd: cwd, stderr_to_stdout: true)
    assert status == 0, output
    output
  end
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs`
Expected: FAIL (route/controller missing → 404 or `UndefinedFunctionError`).

- [ ] **Step 3: Implement the controller**

```elixir
defmodule SymphonyElixirWeb.Tracker.WorkspaceDiffController do
  @moduledoc """
  Exposes full unified per-file patches for an issue workspace (uncommitted
  working tree or branch vs the default-branch merge-base), so the tracker can
  render diffs in-app without leaving for GitHub. Mirrors
  `CommitEvidenceController` for workspace resolution, auth, and error shape.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Evidence.WorkspaceDiff
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Workspace
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    with {:ok, type} <- parse_type(params),
         {:ok, workspace} <- issue_workspace(project_slug, identifier),
         {:ok, repos} <- WorkspaceDiff.changes(workspace, type) do
      json(conn, %{data: repos, type: Atom.to_string(type), workspace: workspace_brief(workspace)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp parse_type(%{"type" => "uncommitted"}), do: {:ok, :uncommitted}
  defp parse_type(%{"type" => "branch"}), do: {:ok, :branch}
  defp parse_type(_params), do: {:error, :invalid_diff_type}

  defp issue_workspace(project_slug, identifier) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, _issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      issue = %Issue{identifier: identifier, project_slug: project_slug}
      {:ok, Workspace.path_for_issue(issue)}
    end
  end

  defp workspace_brief(workspace) do
    %{path: workspace, available: File.dir?(workspace)}
  end
end
```

- [ ] **Step 4: Add the route**

In `elixir/lib/symphony_elixir_web/router.ex`, inside the `scope "/api/tracker/v1", SymphonyElixirWeb.Tracker do … pipe_through(:tracker_api)` block, immediately after the `commit_evidence/:repo/:sha` `show` route:

```elixir
    get("/projects/:project_slug/issues/:identifier/diff", WorkspaceDiffController, :index)
```

- [ ] **Step 5: Add the error clause**

In `elixir/lib/symphony_elixir_web/tracker_errors.ex`, next to the other `:invalid_*` clauses (e.g. after `:invalid_pr_number`):

```elixir
  def render(conn, :invalid_diff_type),
    do: error(conn, 422, "invalid_diff_type", dgettext("errors", "Diff type must be uncommitted or branch."))
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/workspace_diff_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/lib/symphony_elixir_web/tracker_errors.ex elixir/test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs
git commit -m "feat(diff): workspace diff endpoint (uncommitted/branch)"
```

---

## Task 3: Frontend — `buildFileTree` (port of Jean's `git-diff-tree.ts`)

**Files:**
- Create: `tracker/src/lib/gitDiffTree.ts`
- Test: `tracker/src/lib/__tests__/gitDiffTree.test.ts`

Folders before files, alphabetical within each group, and `compactFolders` collapses single-child folder chains into one node (`src/components` when `src` has only `components`). The compacted node's `path` is the deepest folder's path.

- [ ] **Step 1: Write the failing test** (mirrors Jean's `git-diff-tree.test.ts`)

```ts
import { describe, expect, it } from "vitest";

import { buildFileTree, type DiffTreeFolderNode } from "@/lib/gitDiffTree";

describe("buildFileTree", () => {
  it("orders folders before files, alphabetically", () => {
    const tree = buildFileTree(["zeta.ts", "src/App.tsx", "alpha.ts"]);
    expect(tree.map((n) => `${n.type}:${n.name}`)).toEqual(["folder:src", "file:alpha.ts", "file:zeta.ts"]);
  });

  it("compacts single-child folder chains", () => {
    const tree = buildFileTree(["src/components/ui/Button.tsx"]);
    expect(tree).toHaveLength(1);
    const folder = tree[0] as DiffTreeFolderNode;
    expect(folder.type).toBe("folder");
    expect(folder.name).toBe("src/components/ui");
    expect(folder.path).toBe("src/components/ui");
    expect(folder.children.map((c) => c.name)).toEqual(["Button.tsx"]);
  });

  it("does not compact when a folder has multiple children", () => {
    const tree = buildFileTree(["src/a/x.ts", "src/b/y.ts"]);
    const src = tree[0] as DiffTreeFolderNode;
    expect(src.name).toBe("src");
    expect(src.children.map((c) => c.name)).toEqual(["a", "b"]);
  });

  it("keeps full chains when compactFolders is false", () => {
    const tree = buildFileTree(["src/components/Button.tsx"], { compactFolders: false });
    const src = tree[0] as DiffTreeFolderNode;
    expect(src.name).toBe("src");
    const components = src.children[0] as DiffTreeFolderNode;
    expect(components.name).toBe("components");
    expect(components.children[0]!.name).toBe("Button.tsx");
  });

  it("ignores blank paths", () => {
    expect(buildFileTree(["", "  ", "a.ts"]).map((n) => n.name)).toEqual(["a.ts"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tracker && npx vitest run src/lib/__tests__/gitDiffTree.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/gitDiffTree"`.

- [ ] **Step 3: Implement**

```ts
export interface DiffTreeFileNode {
  type: "file";
  name: string;
  path: string;
}

export interface DiffTreeFolderNode {
  type: "folder";
  name: string;
  path: string;
  children: DiffTreeNode[];
}

export type DiffTreeNode = DiffTreeFileNode | DiffTreeFolderNode;

export interface BuildFileTreeOptions {
  compactFolders?: boolean;
}

interface MutableFolder {
  name: string;
  path: string;
  childFolders: Map<string, MutableFolder>;
  files: DiffTreeFileNode[];
}

function emptyFolder(name: string, path: string): MutableFolder {
  return { name, path, childFolders: new Map(), files: [] };
}

export function buildFileTree(paths: string[], options: BuildFileTreeOptions = {}): DiffTreeNode[] {
  const compact = options.compactFolders ?? true;
  const root = emptyFolder("", "");

  for (const rawPath of paths) {
    const normalized = rawPath.trim();
    if (!normalized) continue;

    const segments = normalized.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;

    let folder = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i]!;
      const folderPath = folder.path ? `${folder.path}/${segment}` : segment;
      let child = folder.childFolders.get(segment);
      if (!child) {
        child = emptyFolder(segment, folderPath);
        folder.childFolders.set(segment, child);
      }
      folder = child;
    }

    const fileName = segments[segments.length - 1]!;
    folder.files.push({ type: "file", name: fileName, path: normalized });
  }

  return finalizeChildren(root, compact);
}

function finalizeChildren(folder: MutableFolder, compact: boolean): DiffTreeNode[] {
  const folders = [...folder.childFolders.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((child) => finalizeFolder(child, compact));

  const files = [...folder.files].sort((a, b) => a.name.localeCompare(b.name));

  return [...folders, ...files];
}

function finalizeFolder(folder: MutableFolder, compact: boolean): DiffTreeFolderNode {
  if (compact && folder.files.length === 0 && folder.childFolders.size === 1) {
    const onlyChild = [...folder.childFolders.values()][0]!;
    const compacted = finalizeFolder(onlyChild, compact);
    return {
      type: "folder",
      name: `${folder.name}/${compacted.name}`,
      path: compacted.path,
      children: compacted.children,
    };
  }

  return {
    type: "folder",
    name: folder.name,
    path: folder.path,
    children: finalizeChildren(folder, compact),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tracker && npx vitest run src/lib/__tests__/gitDiffTree.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/lib/gitDiffTree.ts tracker/src/lib/__tests__/gitDiffTree.test.ts
git commit -m "feat(diff): port buildFileTree changed-file tree helper"
```

---

## Task 4: Frontend — `diffStats` (+/- counts from a patch)

**Files:**
- Create: `tracker/src/lib/diffStats.ts`
- Test: `tracker/src/lib/__tests__/diffStats.test.ts`

Counts added/removed lines from a unified patch body, excluding the `+++`/`---` file headers. (Backend commit summaries carry numstat totals, but per-file uncommitted/branch changes only carry the patch, so +/- is computed client-side from the patch for ALL three diff types — one helper everywhere.)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { diffStats } from "@/lib/diffStats";

describe("diffStats", () => {
  it("returns zeros for an empty patch", () => {
    expect(diffStats("")).toEqual({ additions: 0, deletions: 0 });
  });

  it("counts + and - lines, ignoring file headers and hunk markers", () => {
    const patch = [
      "diff --git a/x.ts b/x.ts",
      "index 111..222 100644",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,2 +1,3 @@",
      " context",
      "-removed line",
      "+added line one",
      "+added line two",
    ].join("\n");

    expect(diffStats(patch)).toEqual({ additions: 2, deletions: 1 });
  });

  it("does not count the +++/--- headers as changes", () => {
    const patch = ["--- a/new.txt", "+++ b/new.txt", "@@ -0,0 +1 @@", "+hello"].join("\n");
    expect(diffStats(patch)).toEqual({ additions: 1, deletions: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tracker && npx vitest run src/lib/__tests__/diffStats.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/diffStats"`.

- [ ] **Step 3: Implement**

```ts
export interface DiffStats {
  additions: number;
  deletions: number;
}

export function diffStats(patch: string): DiffStats {
  if (!patch) return { additions: 0, deletions: 0 };

  let additions = 0;
  let deletions = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }

  return { additions, deletions };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tracker && npx vitest run src/lib/__tests__/diffStats.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/lib/diffStats.ts tracker/src/lib/__tests__/diffStats.test.ts
git commit -m "feat(diff): per-file +/- diff stats from patch"
```

---

## Task 5: Frontend — persisted view mode + `@pierre/diffs` layout adapter

**Files:**
- Create: `tracker/src/lib/diffViewMode.ts`
- Test: `tracker/src/lib/__tests__/diffViewMode.test.ts`

`split` (side-by-side) is the default; persisted in `localStorage`. `diffsLayout` maps our mode to `@pierre/diffs` layout terms (`split` / `stacked`), centralized so the exact option is changed in ONE place.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";

import { diffsLayout, getDiffViewMode, setDiffViewMode } from "@/lib/diffViewMode";

afterEach(() => window.localStorage.clear());

describe("diffViewMode", () => {
  it("defaults to split when nothing is stored", () => {
    expect(getDiffViewMode()).toBe("split");
  });

  it("round-trips through localStorage", () => {
    setDiffViewMode("unified");
    expect(getDiffViewMode()).toBe("unified");
    setDiffViewMode("split");
    expect(getDiffViewMode()).toBe("split");
  });

  it("ignores corrupt stored values", () => {
    window.localStorage.setItem("symphony.gitDiff.viewMode", "garbage");
    expect(getDiffViewMode()).toBe("split");
  });

  it("maps modes to @pierre/diffs layouts", () => {
    expect(diffsLayout("split")).toBe("split");
    expect(diffsLayout("unified")).toBe("stacked");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tracker && npx vitest run src/lib/__tests__/diffViewMode.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/diffViewMode"`.

- [ ] **Step 3: Implement**

```ts
export type DiffViewMode = "split" | "unified";

const STORAGE_KEY = "symphony.gitDiff.viewMode";
const DEFAULT_MODE: DiffViewMode = "split";

export function getDiffViewMode(): DiffViewMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "split" || stored === "unified" ? stored : DEFAULT_MODE;
}

export function setDiffViewMode(mode: DiffViewMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}

// `@pierre/diffs` calls side-by-side "split" and unified "stacked".
export function diffsLayout(mode: DiffViewMode): "split" | "stacked" {
  return mode === "split" ? "split" : "stacked";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tracker && npx vitest run src/lib/__tests__/diffViewMode.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/lib/diffViewMode.ts tracker/src/lib/__tests__/diffViewMode.test.ts
git commit -m "feat(diff): persisted split/unified view mode + layout adapter"
```

---

## Task 6: Frontend — types + `gitDiff` service

**Files:**
- Create: `tracker/src/types/gitDiff.ts`
- Create: `tracker/src/services/gitDiff.ts`
- Test: `tracker/src/services/__tests__/gitDiff.test.ts`

Mirrors `services/commitEvidence.ts` (snake_case → camelCase normalizers, `http` + `trackerPath`, `requireProjectSlug`/`requireNonBlank`/`normalizeIssueIdentifier`).

- [ ] **Step 1: Create the types**

```ts
// tracker/src/types/gitDiff.ts
export type GitDiffType = "uncommitted" | "branch" | "commit";

export interface GitDiffFile {
  path: string;
  oldPath: string | null;
  status: string;
  patch: string;
}

export interface GitDiffRepo {
  repo: string;
  files: GitDiffFile[];
}

export interface GitDiffWorkspace {
  path: string;
  available: boolean;
}

export interface GitDiffResult {
  repos: GitDiffRepo[];
  workspace: GitDiffWorkspace;
}
```

- [ ] **Step 2: Write the failing service test**

```ts
import { describe, expect, it, vi } from "vitest";

import { getWorkspaceDiff } from "@/services/gitDiff";

const getMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/http")>();
  return { ...actual, http: { get: (...args: unknown[]) => getMock(...args) } };
});

describe("getWorkspaceDiff", () => {
  it("requests the diff endpoint with the type and normalizes the envelope", async () => {
    getMock.mockResolvedValue({
      data: {
        type: "branch",
        data: [
          {
            repo: "frontend",
            files: [{ path: "src/App.tsx", old_path: null, status: "added", patch: "+a\n" }],
          },
        ],
        workspace: { path: "/tmp/ws", available: true },
      },
    });

    const result = await getWorkspaceDiff("advising", "CDE-1131", "branch");

    expect(getMock).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/advising/issues/CDE-1131/diff?type=branch",
    );
    expect(result.workspace).toEqual({ path: "/tmp/ws", available: true });
    expect(result.repos).toEqual([
      {
        repo: "frontend",
        files: [{ path: "src/App.tsx", oldPath: null, status: "added", patch: "+a\n" }],
      },
    ]);
  });

  it("tolerates a missing payload", async () => {
    getMock.mockResolvedValue({ data: {} });
    const result = await getWorkspaceDiff("advising", "CDE-1", "uncommitted");
    expect(result.repos).toEqual([]);
    expect(result.workspace).toEqual({ path: "", available: false });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd tracker && npx vitest run src/services/__tests__/gitDiff.test.ts`
Expected: FAIL with `Failed to resolve import "@/services/gitDiff"`.

- [ ] **Step 4: Implement the service**

```ts
// tracker/src/services/gitDiff.ts
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type { GitDiffFile, GitDiffRepo, GitDiffResult, GitDiffWorkspace } from "@/types/gitDiff";

import { http, trackerPath } from "./http";

interface BackendFileDto {
  path?: string | null;
  old_path?: string | null;
  status?: string | null;
  patch?: string | null;
}

interface BackendRepoDto {
  repo?: string | null;
  files?: BackendFileDto[] | null;
}

interface BackendDiffEnvelope {
  data?: BackendRepoDto[] | null;
  type?: string | null;
  workspace?: { path?: string | null; available?: boolean | null } | null;
}

function normalizeFile(dto: BackendFileDto): GitDiffFile {
  return {
    path: dto.path ?? "",
    oldPath: dto.old_path ?? null,
    status: dto.status ?? "modified",
    patch: dto.patch ?? "",
  };
}

function normalizeRepo(dto: BackendRepoDto): GitDiffRepo {
  return { repo: dto.repo ?? "", files: (dto.files ?? []).map(normalizeFile) };
}

function normalizeWorkspace(raw: BackendDiffEnvelope["workspace"]): GitDiffWorkspace {
  return { path: raw?.path ?? "", available: raw?.available ?? false };
}

export async function getWorkspaceDiff(
  projectSlug: string,
  identifier: string,
  type: "uncommitted" | "branch",
): Promise<GitDiffResult> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const response = await http.get<BackendDiffEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/diff?type=${type}`,
    ),
  );

  return {
    repos: (response.data?.data ?? []).map(normalizeRepo),
    workspace: normalizeWorkspace(response.data?.workspace),
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd tracker && npx vitest run src/services/__tests__/gitDiff.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add tracker/src/types/gitDiff.ts tracker/src/services/gitDiff.ts tracker/src/services/__tests__/gitDiff.test.ts
git commit -m "feat(diff): gitDiff types + workspace diff service"
```

---

## Task 7: Frontend — `useGitDiff` hook

**Files:**
- Create: `tracker/src/hooks/useGitDiff.ts`
- Test: `tracker/src/hooks/__tests__/useGitDiff.test.tsx`

Mirrors `useIssueCommitEvidence` (useState/useEffect, in-flight guard, reset on key change). Re-fetches when `type` changes.

- [ ] **Step 1: Write the failing test**

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGitDiff } from "@/hooks/useGitDiff";
import { initTestI18n } from "@/i18n/testUtils";

const getWorkspaceDiffMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/gitDiff", () => ({
  getWorkspaceDiff: (...args: unknown[]) => getWorkspaceDiffMock(...args),
}));

describe("useGitDiff", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    getWorkspaceDiffMock.mockReset();
  });

  it("loads repos for the active type", async () => {
    getWorkspaceDiffMock.mockResolvedValue({
      repos: [{ repo: "frontend", files: [{ path: "a.ts", oldPath: null, status: "added", patch: "+a\n" }] }],
      workspace: { path: "/tmp/ws", available: true },
    });

    const { result } = renderHook(() =>
      useGitDiff({ projectSlug: "advising", identifier: "CDE-1", type: "branch" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getWorkspaceDiffMock).toHaveBeenCalledWith("advising", "CDE-1", "branch");
    expect(result.current.repos[0]!.repo).toBe("frontend");
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error message on failure", async () => {
    getWorkspaceDiffMock.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() =>
      useGitDiff({ projectSlug: "advising", identifier: "CDE-1", type: "uncommitted" }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.repos).toEqual([]);
  });

  it("does not fetch when disabled", () => {
    renderHook(() =>
      useGitDiff({ projectSlug: "advising", identifier: "CDE-1", type: "branch", enabled: false }),
    );
    expect(getWorkspaceDiffMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tracker && npx vitest run src/hooks/__tests__/useGitDiff.test.tsx`
Expected: FAIL with `Failed to resolve import "@/hooks/useGitDiff"`.

- [ ] **Step 3: Implement**

```ts
import { useCallback, useEffect, useRef, useState } from "react";

import { i18n } from "@/i18n";
import { getWorkspaceDiff } from "@/services/gitDiff";
import type { GitDiffRepo, GitDiffWorkspace } from "@/types/gitDiff";

interface UseGitDiffArgs {
  projectSlug: string;
  identifier: string | null;
  type: "uncommitted" | "branch";
  enabled?: boolean;
}

export interface UseGitDiffResult {
  repos: GitDiffRepo[];
  workspace: GitDiffWorkspace | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Loads full per-file patches for an issue workspace (uncommitted or branch). */
export function useGitDiff({
  projectSlug,
  identifier,
  type,
  enabled = true,
}: UseGitDiffArgs): UseGitDiffResult {
  const [repos, setRepos] = useState<GitDiffRepo[]>([]);
  const [workspace, setWorkspace] = useState<GitDiffWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const active = enabled && Boolean(identifier && projectSlug);

  const refetch = useCallback(async () => {
    if (!identifier || !projectSlug) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const result = await getWorkspaceDiff(projectSlug, identifier, type);
      setRepos(result.repos);
      setWorkspace(result.workspace);
      setError(null);
    } catch {
      setError(i18n.t("issue.diff.errors.loadFailed"));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [identifier, projectSlug, type]);

  useEffect(() => {
    setRepos([]);
    setWorkspace(null);
    setError(null);
  }, [identifier, projectSlug, type]);

  useEffect(() => {
    if (!active) return;
    void refetch();
  }, [active, refetch]);

  return { repos, workspace, loading, error, refetch };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tracker && npx vitest run src/hooks/__tests__/useGitDiff.test.tsx`
Expected: PASS (3 tests). (Add the `issue.diff.errors.loadFailed` key in Task 11 if i18n returns the key string here; the test only asserts `error !== null`.)

- [ ] **Step 5: Commit**

```bash
git add tracker/src/hooks/useGitDiff.ts tracker/src/hooks/__tests__/useGitDiff.test.tsx
git commit -m "feat(diff): useGitDiff data hook"
```

---

## Task 8: Frontend — add `@pierre/diffs` + `GitDiffViewer`

**Files:**
- Modify: `tracker/package.json` (add dependency)
- Create: `tracker/src/components/issues/issue-detail/git-diff/GitDiffViewer.tsx`
- Test: `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffViewer.test.tsx`

`GitDiffViewer` parses ONE file's patch with `parsePatchFiles` and renders the first parsed `FileDiffMetadata` via `@pierre/diffs/react`'s `FileDiff`, applying the split/stacked layout. Falls back to a `<pre>` if parsing yields nothing.

- [ ] **Step 1: Add the dependency**

Run: `cd tracker && npm install @pierre/diffs`
Expected: `@pierre/diffs` appears under `dependencies` in `tracker/package.json` and `package-lock.json` updates.

- [ ] **Step 2: Confirm the React API surface** (external lib; can't be verified offline)

Read the installed type declarations to confirm the exact `FileDiff` prop and layout option BEFORE writing the component:

Run: `cd tracker && ls node_modules/@pierre/diffs/dist` then inspect the `react` entry's `.d.ts` for `FileDiff`'s props (expected: a `fileDiff: FileDiffMetadata` prop and an `options`/`layout` control accepting `"split" | "stacked"`). If the names differ, adjust `GitDiffViewer` and `diffsLayout` (Task 5) accordingly — these are the only two places that reference the library's prop names.

- [ ] **Step 3: Write the failing test** (mock the library so jsdom never loads Shiki)

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GitDiffViewer } from "../GitDiffViewer";

const parsePatchFilesMock = vi.hoisted(() => vi.fn());
const fileDiffMock = vi.hoisted(() => vi.fn());

vi.mock("@pierre/diffs", () => ({
  parsePatchFiles: (...args: unknown[]) => parsePatchFilesMock(...args),
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: (props: { options?: { layout?: string } }) => {
    fileDiffMock(props);
    return <div data-testid="pierre-file-diff" data-layout={props.options?.layout ?? ""} />;
  },
}));

describe("GitDiffViewer", () => {
  it("parses the patch and renders FileDiff with the split layout", () => {
    parsePatchFilesMock.mockReturnValue([{ id: "diff-1" }]);

    render(
      <GitDiffViewer
        file={{ path: "src/App.tsx", oldPath: null, status: "modified", patch: "@@ -1 +1 @@\n-a\n+b\n" }}
        viewMode="split"
      />,
    );

    expect(parsePatchFilesMock).toHaveBeenCalledWith("@@ -1 +1 @@\n-a\n+b\n");
    const node = screen.getByTestId("pierre-file-diff");
    expect(node.getAttribute("data-layout")).toBe("split");
    expect(fileDiffMock).toHaveBeenCalledWith(expect.objectContaining({ fileDiff: { id: "diff-1" } }));
  });

  it("renders unified (stacked) layout and falls back to <pre> when parsing is empty", () => {
    parsePatchFilesMock.mockReturnValue([]);

    render(
      <GitDiffViewer
        file={{ path: "x.txt", oldPath: null, status: "added", patch: "raw patch text" }}
        viewMode="unified"
      />,
    );

    expect(screen.getByText("raw patch text")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/git-diff/__tests__/GitDiffViewer.test.tsx`
Expected: FAIL with `Failed to resolve import "../GitDiffViewer"`.

- [ ] **Step 5: Implement**

```tsx
import { useMemo } from "react";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";

import { diffsLayout, type DiffViewMode } from "@/lib/diffViewMode";
import type { GitDiffFile } from "@/types/gitDiff";

interface GitDiffViewerProps {
  file: GitDiffFile;
  viewMode: DiffViewMode;
}

export function GitDiffViewer({ file, viewMode }: GitDiffViewerProps) {
  const fileDiff = useMemo(() => parsePatchFiles(file.patch)[0] ?? null, [file.patch]);

  if (!fileDiff) {
    return (
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-5">
        {file.patch}
      </pre>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <FileDiff fileDiff={fileDiff} options={{ layout: diffsLayout(viewMode) }} />
    </div>
  );
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/git-diff/__tests__/GitDiffViewer.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add tracker/package.json tracker/package-lock.json tracker/src/components/issues/issue-detail/git-diff/GitDiffViewer.tsx tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffViewer.test.tsx
git commit -m "feat(diff): GitDiffViewer via @pierre/diffs"
```

---

## Task 9: Frontend — `GitDiffFileTree` (tree + flat list)

**Files:**
- Create: `tracker/src/components/issues/issue-detail/git-diff/GitDiffFileTree.tsx`
- Test: `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffFileTree.test.tsx`

Renders `buildFileTree` output (folders before files; compacted chains) with a flat-list toggle. Each file row shows its name and +/- counts (via `diffStats`). `path` keys are repo-prefixed strings (e.g. `frontend/src/App.tsx`) so one tree is multi-repo aware; `onSelect(path)` is called with that prefixed path.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GitDiffFileTree } from "../GitDiffFileTree";
import { i18n } from "@/i18n";
import { initTestI18n } from "@/i18n/testUtils";

const files = [
  { path: "frontend/src/App.tsx", patch: "@@\n+a\n+b\n", status: "modified" },
  { path: "frontend/README.md", patch: "@@\n-old\n", status: "modified" },
];

describe("GitDiffFileTree", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  function renderTree(ui: React.ReactElement) {
    return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
  }

  it("renders folders before files and selects on click", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    renderTree(
      <GitDiffFileTree files={files} flat={false} selectedPath={null} onSelect={onSelect} onToggleFlat={vi.fn()} />,
    );

    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
    await user.click(screen.getByText("App.tsx"));
    expect(onSelect).toHaveBeenCalledWith("frontend/src/App.tsx");
  });

  it("renders a flat list of full paths when flat is true", () => {
    renderTree(
      <GitDiffFileTree files={files} flat selectedPath={null} onSelect={vi.fn()} onToggleFlat={vi.fn()} />,
    );
    expect(screen.getByText("frontend/src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("frontend/README.md")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/git-diff/__tests__/GitDiffFileTree.test.tsx`
Expected: FAIL with `Failed to resolve import "../GitDiffFileTree"`.

- [ ] **Step 3: Implement**

```tsx
import { ChevronDown, FileText, FolderTree, List } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { diffStats } from "@/lib/diffStats";
import { buildFileTree, type DiffTreeNode } from "@/lib/gitDiffTree";
import { cn } from "@/lib/utils";

interface TreeFile {
  path: string;
  patch: string;
  status: string;
}

interface GitDiffFileTreeProps {
  files: TreeFile[];
  flat: boolean;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onToggleFlat: () => void;
}

export function GitDiffFileTree({ files, flat, selectedPath, onSelect, onToggleFlat }: GitDiffFileTreeProps) {
  const { t } = useTranslation();
  const statsByPath = useMemo(() => {
    const map = new Map<string, ReturnType<typeof diffStats>>();
    for (const file of files) map.set(file.path, diffStats(file.patch));
    return map;
  }, [files]);
  const tree = useMemo(() => buildFileTree(files.map((file) => file.path)), [files]);

  return (
    <div className="flex min-h-0 flex-col md:w-64 md:shrink-0 md:border-r">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("issue.diff.files", { count: files.length })}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
          onClick={onToggleFlat}
          title={flat ? t("issue.diff.list.tree") : t("issue.diff.list.flat")}
        >
          {flat ? <FolderTree className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
          <span>{flat ? t("issue.diff.list.tree") : t("issue.diff.list.flat")}</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {flat
          ? files.map((file) => (
              <FileRow
                key={file.path}
                name={file.path}
                path={file.path}
                stats={statsByPath.get(file.path)}
                depth={0}
                selected={selectedPath === file.path}
                onSelect={onSelect}
              />
            ))
          : tree.map((node) => (
              <TreeNode
                key={node.path || node.name}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                statsByPath={statsByPath}
                onSelect={onSelect}
              />
            ))}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  selectedPath,
  statsByPath,
  onSelect,
}: {
  node: DiffTreeNode;
  depth: number;
  selectedPath: string | null;
  statsByPath: Map<string, ReturnType<typeof diffStats>>;
  onSelect: (path: string) => void;
}) {
  if (node.type === "file") {
    return (
      <FileRow
        name={node.name}
        path={node.path}
        stats={statsByPath.get(node.path)}
        depth={depth}
        selected={selectedPath === node.path}
        onSelect={onSelect}
      />
    );
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-muted-foreground"
        style={{ paddingLeft: 12 + depth * 12 }}
      >
        <ChevronDown className="h-3 w-3 shrink-0" />
        <span className="truncate">{node.name}</span>
      </div>
      {node.children.map((child) => (
        <TreeNode
          key={child.path || child.name}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          statsByPath={statsByPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function FileRow({
  name,
  path,
  stats,
  depth,
  selected,
  onSelect,
}: {
  name: string;
  path: string;
  stats: ReturnType<typeof diffStats> | undefined;
  depth: number;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-muted/60",
        selected && "bg-muted",
      )}
      style={{ paddingLeft: 12 + depth * 12 }}
      onClick={() => onSelect(path)}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
      {stats ? (
        <span className="shrink-0 font-mono text-[10px]">
          <span className="text-emerald-600 dark:text-emerald-400">+{stats.additions}</span>{" "}
          <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
        </span>
      ) : null}
    </button>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/git-diff/__tests__/GitDiffFileTree.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/git-diff/GitDiffFileTree.tsx tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffFileTree.test.tsx
git commit -m "feat(diff): changed-file tree with flat toggle + stats"
```

---

## Task 10: Frontend — `GitDiffModal` (tabs + toggle + commits reuse)

**Files:**
- Create: `tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx` (default export)
- Test: `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx`

Radix `Dialog` (reuse `ui/dialog.tsx`) + Radix `Tabs` (`ui/tabs.tsx`). Tabs: **Uncommitted** / **Branch** (both via `useGitDiff`) and **Commits** (reuse `useIssueCommitEvidence` for the list + `getCommitEvidence` for the selected commit's files). A split/unified toggle persists via `getDiffViewMode`/`setDiffViewMode`. Uncommitted/branch repos are flattened into repo-prefixed paths (`${repo}/${path}`) so one tree spans repos; selecting maps back to the file. The Commits tab adds a commit `<select>` to **switch which commit is shown**. Default export so the modal can be `React.lazy`-loaded.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GitDiffModal from "../GitDiffModal";
import { i18n } from "@/i18n";
import { initTestI18n } from "@/i18n/testUtils";

const getWorkspaceDiffMock = vi.hoisted(() => vi.fn());
const listCommitEvidenceMock = vi.hoisted(() => vi.fn());
const getCommitEvidenceMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/gitDiff", () => ({
  getWorkspaceDiff: (...args: unknown[]) => getWorkspaceDiffMock(...args),
}));
vi.mock("@/services/commitEvidence", () => ({
  listCommitEvidence: (...args: unknown[]) => listCommitEvidenceMock(...args),
  getCommitEvidence: (...args: unknown[]) => getCommitEvidenceMock(...args),
}));
// Mock the viewer so jsdom never loads Shiki / @pierre/diffs.
vi.mock("../GitDiffViewer", () => ({
  GitDiffViewer: ({ file }: { file: { path: string } }) => (
    <div data-testid="git-diff-viewer">{file.path}</div>
  ),
}));

describe("GitDiffModal", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    getWorkspaceDiffMock.mockReset();
    listCommitEvidenceMock.mockReset();
    getCommitEvidenceMock.mockReset();
    getWorkspaceDiffMock.mockResolvedValue({
      repos: [{ repo: "frontend", files: [{ path: "src/App.tsx", oldPath: null, status: "modified", patch: "@@\n+a\n" }] }],
      workspace: { path: "/tmp/ws", available: true },
    });
    listCommitEvidenceMock.mockResolvedValue({ commits: [], workspace: { path: "/tmp/ws", available: true } });
  });

  function renderModal() {
    return render(
      <I18nextProvider i18n={i18n}>
        <GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />
      </I18nextProvider>,
    );
  }

  it("shows the uncommitted tab and renders the first changed file", async () => {
    renderModal();
    // The mocked viewer renders the repo-relative file.path; the tree shows the
    // file name ("App.tsx") and folder ("src"), so the full "src/App.tsx" string
    // only appears inside the viewer.
    await waitFor(() => expect(screen.getByTestId("git-diff-viewer")).toHaveTextContent("src/App.tsx"));
    expect(getWorkspaceDiffMock).toHaveBeenCalledWith("advising", "CDE-1", "uncommitted");
  });

  it("loads the branch diff when the Branch tab is selected", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("tab", { name: i18n.t("issue.diff.tabs.branch") }));
    await waitFor(() => expect(getWorkspaceDiffMock).toHaveBeenCalledWith("advising", "CDE-1", "branch"));
  });

  it("toggles split/unified", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText("src/App.tsx");
    await user.click(screen.getByRole("button", { name: i18n.t("issue.diff.viewMode.unified") }));
    expect(window.localStorage.getItem("symphony.gitDiff.viewMode")).toBe("unified");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx`
Expected: FAIL with `Failed to resolve import "../GitDiffModal"`.

- [ ] **Step 3: Implement**

```tsx
import { Columns2, GitBranch, GitCommitHorizontal, Loader2, Rows3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { GitDiffFileTree } from "@/components/issues/issue-detail/git-diff/GitDiffFileTree";
import { GitDiffViewer } from "@/components/issues/issue-detail/git-diff/GitDiffViewer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGitDiff } from "@/hooks/useGitDiff";
import { useIssueCommitEvidence } from "@/hooks/useIssueCommitEvidence";
import { getDiffViewMode, setDiffViewMode, type DiffViewMode } from "@/lib/diffViewMode";
import { cn } from "@/lib/utils";
import { getCommitEvidence } from "@/services/commitEvidence";
import type { CommitEvidenceDetail } from "@/types/commitEvidence";
import type { GitDiffFile, GitDiffRepo } from "@/types/gitDiff";

type DiffTab = "uncommitted" | "branch" | "commits";

interface GitDiffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  identifier: string;
}

interface FlatFile {
  prefixedPath: string;
  repo: string;
  file: GitDiffFile;
}

function flattenRepos(repos: GitDiffRepo[]): FlatFile[] {
  return repos.flatMap((repo) =>
    repo.files.map((file) => ({ prefixedPath: `${repo.repo}/${file.path}`, repo: repo.repo, file })),
  );
}

export default function GitDiffModal({ open, onOpenChange, projectSlug, identifier }: GitDiffModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DiffTab>("uncommitted");
  const [viewMode, setViewMode] = useState<DiffViewMode>(() => getDiffViewMode());
  const [flat, setFlat] = useState(false);

  function changeViewMode(mode: DiffViewMode) {
    setViewMode(mode);
    setDiffViewMode(mode);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[calc(100%-2rem)] max-w-6xl flex-col overflow-hidden p-0">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
          <DialogTitle className="text-sm">{t("issue.diff.title")}</DialogTitle>
          <ViewModeToggle viewMode={viewMode} onChange={changeViewMode} />
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as DiffTab)} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-4 mt-3 self-start">
            <TabsTrigger value="uncommitted">{t("issue.diff.tabs.uncommitted")}</TabsTrigger>
            <TabsTrigger value="branch">
              <GitBranch className="mr-1 h-3.5 w-3.5" />
              {t("issue.diff.tabs.branch")}
            </TabsTrigger>
            <TabsTrigger value="commits">
              <GitCommitHorizontal className="mr-1 h-3.5 w-3.5" />
              {t("issue.diff.tabs.commits")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="uncommitted" className="mt-0 flex min-h-0 flex-1">
            <WorkspaceDiffPane
              active={tab === "uncommitted"}
              projectSlug={projectSlug}
              identifier={identifier}
              type="uncommitted"
              viewMode={viewMode}
              flat={flat}
              onToggleFlat={() => setFlat((value) => !value)}
            />
          </TabsContent>

          <TabsContent value="branch" className="mt-0 flex min-h-0 flex-1">
            <WorkspaceDiffPane
              active={tab === "branch"}
              projectSlug={projectSlug}
              identifier={identifier}
              type="branch"
              viewMode={viewMode}
              flat={flat}
              onToggleFlat={() => setFlat((value) => !value)}
            />
          </TabsContent>

          <TabsContent value="commits" className="mt-0 flex min-h-0 flex-1">
            <CommitsPane
              active={tab === "commits"}
              projectSlug={projectSlug}
              identifier={identifier}
              viewMode={viewMode}
              flat={flat}
              onToggleFlat={() => setFlat((value) => !value)}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ViewModeToggle({ viewMode, onChange }: { viewMode: DiffViewMode; onChange: (mode: DiffViewMode) => void }) {
  const { t } = useTranslation();
  return (
    <div className="mr-8 inline-flex rounded-md border">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn("h-7 gap-1 rounded-r-none px-2 text-xs", viewMode === "split" && "bg-muted")}
        onClick={() => onChange("split")}
      >
        <Columns2 className="h-3.5 w-3.5" />
        {t("issue.diff.viewMode.split")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn("h-7 gap-1 rounded-l-none px-2 text-xs", viewMode === "unified" && "bg-muted")}
        onClick={() => onChange("unified")}
      >
        <Rows3 className="h-3.5 w-3.5" />
        {t("issue.diff.viewMode.unified")}
      </Button>
    </div>
  );
}

function WorkspaceDiffPane({
  active,
  projectSlug,
  identifier,
  type,
  viewMode,
  flat,
  onToggleFlat,
}: {
  active: boolean;
  projectSlug: string;
  identifier: string;
  type: "uncommitted" | "branch";
  viewMode: DiffViewMode;
  flat: boolean;
  onToggleFlat: () => void;
}) {
  const { repos, workspace, loading, error } = useGitDiff({ projectSlug, identifier, type, enabled: active });
  const flatFiles = useMemo(() => flattenRepos(repos), [repos]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    setSelectedPath(flatFiles[0]?.prefixedPath ?? null);
  }, [flatFiles]);

  const selected = flatFiles.find((entry) => entry.prefixedPath === selectedPath) ?? null;

  return (
    <DiffLayout
      loading={loading}
      error={error}
      empty={!loading && flatFiles.length === 0}
      workspaceUnavailable={Boolean(workspace && !workspace.available)}
      treeFiles={flatFiles.map((entry) => ({
        path: entry.prefixedPath,
        patch: entry.file.patch,
        status: entry.file.status,
      }))}
      flat={flat}
      selectedPath={selectedPath}
      onSelect={setSelectedPath}
      onToggleFlat={onToggleFlat}
      selectedFile={selected?.file ?? null}
      viewMode={viewMode}
    />
  );
}

function CommitsPane({
  active,
  projectSlug,
  identifier,
  viewMode,
  flat,
  onToggleFlat,
}: {
  active: boolean;
  projectSlug: string;
  identifier: string;
  viewMode: DiffViewMode;
  flat: boolean;
  onToggleFlat: () => void;
}) {
  const { t } = useTranslation();
  const { commits, loading: listLoading, error: listError } = useIssueCommitEvidence({
    projectSlug,
    identifier,
    enabled: active,
  });
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitEvidenceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedSha && commits[0]) setSelectedSha(`${commits[0].repo}:${commits[0].sha}`);
  }, [commits, selectedSha]);

  useEffect(() => {
    if (!active || !selectedSha) return;
    const [repo, sha] = selectedSha.split(":");
    if (!repo || !sha) return;

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    void getCommitEvidence(projectSlug, identifier, repo, sha)
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        setSelectedPath(result.files[0]?.path ?? null);
      })
      .catch(() => {
        if (!cancelled) setDetailError(t("issue.diff.errors.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active, selectedSha, projectSlug, identifier, t]);

  const selectedFile = detail?.files.find((file) => file.path === selectedPath) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 py-2">
        <select
          aria-label={t("issue.diff.commits.select")}
          className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          value={selectedSha ?? ""}
          onChange={(event) => setSelectedSha(event.target.value || null)}
          disabled={listLoading || commits.length === 0}
        >
          {commits.length === 0 ? <option value="">{t("issue.diff.commits.none")}</option> : null}
          {commits.map((commit) => (
            <option key={`${commit.repo}:${commit.sha}`} value={`${commit.repo}:${commit.sha}`}>
              {commit.shortSha} · {commit.repo} · {commit.message}
            </option>
          ))}
        </select>
      </div>

      <DiffLayout
        loading={listLoading || detailLoading}
        error={listError ?? detailError}
        empty={!listLoading && commits.length === 0}
        workspaceUnavailable={false}
        treeFiles={(detail?.files ?? []).map((file) => ({ path: file.path, patch: file.patch, status: file.status }))}
        flat={flat}
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
        onToggleFlat={onToggleFlat}
        selectedFile={selectedFile}
        viewMode={viewMode}
      />
    </div>
  );
}

function DiffLayout({
  loading,
  error,
  empty,
  workspaceUnavailable,
  treeFiles,
  flat,
  selectedPath,
  onSelect,
  onToggleFlat,
  selectedFile,
  viewMode,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  workspaceUnavailable: boolean;
  treeFiles: { path: string; patch: string; status: string }[];
  flat: boolean;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onToggleFlat: () => void;
  selectedFile: GitDiffFile | null;
  viewMode: DiffViewMode;
}) {
  const { t } = useTranslation();

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (workspaceUnavailable) return <p className="p-6 text-sm text-muted-foreground">{t("issue.diff.workspaceUnavailable")}</p>;
  if (loading && treeFiles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("issue.diff.loading")}
      </div>
    );
  }
  if (empty) return <p className="p-6 text-sm text-muted-foreground">{t("issue.diff.empty")}</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <GitDiffFileTree
        files={treeFiles}
        flat={flat}
        selectedPath={selectedPath}
        onSelect={onSelect}
        onToggleFlat={onToggleFlat}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {selectedFile ? (
          <GitDiffViewer file={selectedFile} viewMode={viewMode} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            {t("issue.diff.selectFile")}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/git-diff/GitDiffModal.tsx tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffModal.test.tsx
git commit -m "feat(diff): GitDiffModal with uncommitted/branch/commits tabs"
```

---

## Task 11: Frontend — `GitDiffLauncher` (button + lazy modal + ⌘G) + i18n + wiring

**Files:**
- Create: `tracker/src/hooks/useGitDiffShortcut.ts`
- Create: `tracker/src/components/issues/issue-detail/git-diff/GitDiffLauncher.tsx`
- Modify: `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx`
- Modify: `tracker/locales/en/tracker.json` + `tracker/locales/pt-BR/tracker.json`
- Test: `tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffLauncher.test.tsx`

`GitDiffLauncher` renders the toolbar "Diff" button, lazy-loads `GitDiffModal`, and registers the `git.openDiff` shortcut (`mod+g`). No shortcut registry exists in the repo today, so we mirror `BoardPaletteShortcuts`'s inline `window.addEventListener("keydown")` pattern, isolated in `useGitDiffShortcut` (input-focus guarded) so it can later be swapped for a central registry.

- [ ] **Step 1: Add the i18n keys** — insert an `issue.diff` block in BOTH locale files (alongside `issue.commits`, line ~530 in `en`).

`tracker/locales/en/tracker.json`:

```json
    "diff": {
      "button": "Diff",
      "shortcutHint": "View workspace diff (⌘G)",
      "title": "Workspace diff",
      "tabs": {
        "uncommitted": "Uncommitted",
        "branch": "Branch",
        "commits": "Commits"
      },
      "viewMode": {
        "split": "Split",
        "unified": "Unified"
      },
      "list": {
        "tree": "Tree",
        "flat": "Flat"
      },
      "files_one": "{{count}} file",
      "files_other": "{{count}} files",
      "loading": "Loading diff…",
      "empty": "No changes to show.",
      "selectFile": "Select a file to view its diff.",
      "workspaceUnavailable": "Workspace not available on this machine — diff cannot be read locally.",
      "commits": {
        "select": "Select a commit",
        "none": "No agent commits yet"
      },
      "errors": {
        "loadFailed": "Could not load the workspace diff."
      }
    },
```

`tracker/locales/pt-BR/tracker.json`:

```json
    "diff": {
      "button": "Diff",
      "shortcutHint": "Ver diff do workspace (⌘G)",
      "title": "Diff do workspace",
      "tabs": {
        "uncommitted": "Não commitado",
        "branch": "Branch",
        "commits": "Commits"
      },
      "viewMode": {
        "split": "Lado a lado",
        "unified": "Unificado"
      },
      "list": {
        "tree": "Árvore",
        "flat": "Lista"
      },
      "files_one": "{{count}} arquivo",
      "files_other": "{{count}} arquivos",
      "loading": "Carregando diff…",
      "empty": "Nenhuma alteração para mostrar.",
      "selectFile": "Selecione um arquivo para ver o diff.",
      "workspaceUnavailable": "Workspace indisponível nesta máquina — o diff não pode ser lido localmente.",
      "commits": {
        "select": "Selecione um commit",
        "none": "Nenhum commit do agente ainda"
      },
      "errors": {
        "loadFailed": "Não foi possível carregar o diff do workspace."
      }
    },
```

- [ ] **Step 2: Write the failing launcher test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GitDiffLauncher } from "../GitDiffLauncher";
import { i18n } from "@/i18n";
import { initTestI18n } from "@/i18n/testUtils";

// Stub the lazy modal so the test asserts open/close wiring, not modal internals.
vi.mock("../GitDiffModal", () => ({
  default: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) =>
    open ? (
      <div role="dialog">
        diff-modal
        <button type="button" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null,
}));

describe("GitDiffLauncher", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  function renderLauncher() {
    return render(
      <I18nextProvider i18n={i18n}>
        <GitDiffLauncher projectSlug="advising" identifier="CDE-1" />
      </I18nextProvider>,
    );
  }

  it("opens the modal from the toolbar button", async () => {
    const user = userEvent.setup();
    renderLauncher();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: i18n.t("issue.diff.button") }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens on the ⌘G / Ctrl+G shortcut", async () => {
    const user = userEvent.setup();
    renderLauncher();
    await user.keyboard("{Control>}g{/Control}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/git-diff/__tests__/GitDiffLauncher.test.tsx`
Expected: FAIL with `Failed to resolve import "../GitDiffLauncher"`.

- [ ] **Step 4: Implement the shortcut hook**

```ts
// tracker/src/hooks/useGitDiffShortcut.ts
import { useEffect } from "react";

/** Opens the workspace diff on mod+g (⌘G / Ctrl+G), unless typing in an input. */
export function useGitDiffShortcut(onOpen: () => void): void {
  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "g") return;

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const insideInput = tagName === "input" || tagName === "textarea" || target?.isContentEditable;
      if (insideInput) return;

      event.preventDefault();
      onOpen();
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpen]);
}
```

- [ ] **Step 5: Implement the launcher**

```tsx
// tracker/src/components/issues/issue-detail/git-diff/GitDiffLauncher.tsx
import { GitCompare } from "lucide-react";
import { Suspense, lazy, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useGitDiffShortcut } from "@/hooks/useGitDiffShortcut";

const GitDiffModal = lazy(() => import("@/components/issues/issue-detail/git-diff/GitDiffModal"));

interface GitDiffLauncherProps {
  projectSlug: string;
  identifier: string;
}

export function GitDiffLauncher({ projectSlug, identifier }: GitDiffLauncherProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const openModal = useCallback(() => setOpen(true), []);
  useGitDiffShortcut(openModal);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 gap-1 px-2 text-xs"
        title={t("issue.diff.shortcutHint")}
        onClick={openModal}
      >
        <GitCompare className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("issue.diff.button")}</span>
      </Button>

      {open ? (
        <Suspense fallback={null}>
          <GitDiffModal open={open} onOpenChange={setOpen} projectSlug={projectSlug} identifier={identifier} />
        </Suspense>
      ) : null}
    </>
  );
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/git-diff/__tests__/GitDiffLauncher.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Wire into the Execution toolbar**

In `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx`, add the import and mount the launcher as the FIRST child of the `toolbarAfterAttach` fragment (before the Restart button, line ~441):

```tsx
import { GitDiffLauncher } from "@/components/issues/issue-detail/git-diff/GitDiffLauncher";
```

```tsx
          toolbarAfterAttach={
            <>
              <GitDiffLauncher projectSlug={projectSlug} identifier={issue.identifier} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-xs"
                disabled={!canRestart || controlsDisabled}
                title={canRestart ? t("issue.agent.restartTitle") : t("issue.agent.restartPauseFirst")}
                onClick={() => void runDispatch("restart")}
              >
```

- [ ] **Step 8: Run the related suites to confirm the wiring compiles**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/ExecutionControlComposer.test.tsx src/components/issues/issue-detail/git-diff`
Expected: PASS (existing composer suite still green; git-diff suites green).

- [ ] **Step 9: Commit**

```bash
git add tracker/src/hooks/useGitDiffShortcut.ts tracker/src/components/issues/issue-detail/git-diff/GitDiffLauncher.tsx tracker/src/components/issues/issue-detail/git-diff/__tests__/GitDiffLauncher.test.tsx tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "feat(diff): Diff toolbar button + ⌘G launcher + i18n"
```

---

## Task 12: Full gates + docs

**Files:** Modify `tracker/vite.config.ts` only IF a worker pool is introduced (not in v1 — see Risks); docs note in `elixir/README.md` or `../SPEC.md`.

- [ ] **Step 1: Tracker gate**

Run: `cd tracker && npm run lint && npx vitest run && npm run build`
Expected: lint clean; all suites pass; `tsc -b && vite build` succeeds (this is the real check that `@pierre/diffs` + `@pierre/diffs/react` imports resolve and the `FileDiff` props from Task 8 typecheck).

- [ ] **Step 2: Backend gate**

Run: `cd elixir && mix specs.check && make all`
Expected: `@spec` present on new public functions; format/lint/coverage/dialyzer pass.

- [ ] **Step 3: Docs**

Add a short note (KB / `elixir/README.md` or `../SPEC.md`) describing the in-app Workspace Diff: tabs (uncommitted/branch/commits), the `GET /projects/:slug/issues/:id/diff?type=` endpoint, multi-repo behavior, and the `⌘G` shortcut.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(diff): document in-app workspace diff/commits viewer"
```

---

## Risks & Notes

- **`@pierre/diffs` React prop/option names (unverifiable offline).** The docs confirm `parsePatchFiles` (multi-file patch → `FileDiffMetadata[]`), a `FileDiff` React component for pre-parsed metadata, and "split/stacked" layouts, but the exact prop key (`fileDiff`) and layout option path (`options.layout`) must be confirmed against the installed `.d.ts` in **Task 8 Step 2**. Both references are isolated to `GitDiffViewer.tsx` + `diffsLayout` (Task 5), and the `npm run build` gate (Task 12) will fail loudly on a mismatch. A `<pre>` fallback keeps the UI functional if parsing returns nothing.
- **Vite + Shiki worker/SSR entry choice.** v1 uses the plain client entry `@pierre/diffs/react` with main-thread Shiki highlighting (no `@pierre/diffs/ssr`, since the tracker is a Vite SPA, and no `@pierre/diffs/worker`). If main-thread highlighting janks on large diffs, introduce the worker pool (`WorkerPoolContextProvider`) and set `worker: { format: "es" }` in `vite.config.ts` (per the Diffs Vite note) — deferred, not v1.
- **Very large diffs.** v1 renders ONE selected file at a time (the tree selects a single `FileDiff`), which bounds memory naturally and avoids rendering thousands of lines at once. If a single file is enormous, the next step is `@pierre/diffs`' `CodeView`/`Virtualizer` (per-line virtualization) plus the worker pool — noted as a follow-up.
- **`:branch` base availability.** Like `Evidence.GitDiff`, the branch base is `origin/<default>...HEAD`. If `origin/<default>` is absent (shallow clone with no `origin/HEAD`), git errors and the helper returns `[]` (empty diff) rather than crashing — acceptable; a local-ref fallback (as in `Evidence.Commits`) is a possible enhancement.
- **No shortcut registry yet.** The spec referenced `lib/executionShortcuts.ts` / `hooks/useExecutionShortcuts.ts`; these do not exist in the repo. We follow the established inline `keydown` pattern (`BoardPaletteShortcuts`) via `useGitDiffShortcut`, ready to be migrated to a central registry if Plan 2b lands one.
- **`CommitDiffSheet` overlap.** The existing `CommitEvidenceSection` → `CommitDiffSheet` path still works and is untouched. The Commits tab in `GitDiffModal` supersedes it with `@pierre/diffs` rendering; a later cleanup could route `CommitEvidenceSection` clicks into `GitDiffModal` and delete `CommitDiffSheet` — out of scope here.

---

## Self-Review (spec coverage)

| Requirement (from spec) | Task(s) |
| --- | --- |
| Diff types `uncommitted` + `branch` (full patches) | 1 (`WorkspaceDiff`), 2 (endpoint), 6–7 (service/hook), 10 (tabs) |
| **Commits** tab: browse history, per-commit diff, switch commit | 10 (`CommitsPane` reuses `useIssueCommitEvidence` + `getCommitEvidence` + commit `<select>`) |
| File-tree nav (folders-before-files, compact single-child chains) + flat toggle | 3 (`buildFileTree`), 9 (`GitDiffFileTree`) |
| Split + unified modes (persisted) | 5 (`diffViewMode`), 10 (toggle), 8 (`GitDiffViewer` layout) |
| Syntax highlighting + +/- per file | 4 (`diffStats`), 8 (`@pierre/diffs`/Shiki) |
| Multi-repo aware | 1 (`repo_states` per-repo), 2 (per-repo JSON), 10 (repo-prefixed single tree) |
| `@pierre/diffs` via `parsePatchFiles` + `/react` components | 8 |
| Lazy-loaded modal (Radix Dialog, reuse `ui/dialog.tsx`) | 11 (`React.lazy` + `Suspense`), 10 (Dialog/Tabs) |
| `useGitDiff(projectSlug, identifier, type)` hook + `services/gitDiff.ts` | 6, 7 |
| "Diff" toolbar button + `git.openDiff` (`⌘G`) shortcut | 11 |
| i18n `en` + `pt-BR` | 11 |
| Backend gap: small diff module + controller + route, scoped to workspace | 1, 2 |
| Security: scope to issue workspace, no arbitrary paths | 2 (`issue_workspace` mirrors `CommitEvidenceController`; `RunContract.repo_states/1` only) |

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The one external-API verification step (Task 8 Step 2) is a concrete read-and-confirm action with a fallback, required because `npm`/`node_modules` cannot be inspected during planning.

**Type consistency check (cross-task):**
- Backend `file_change` = `%{path, old_path, status, patch}` (Task 1) ⇄ frontend `GitDiffFile = {path, oldPath, status, patch}` (Task 6) ⇄ JSON normalizer `old_path → oldPath` (Task 6). ✓
- `repo_diff = %{repo, files}` (Task 1) ⇄ JSON `data: [repo_diff]` (Task 2) ⇄ `GitDiffRepo` (Task 6). ✓
- `getWorkspaceDiff(projectSlug, identifier, "uncommitted"|"branch")` (Task 6) ⇄ `useGitDiff({type})` (Task 7) ⇄ `WorkspaceDiffPane type` (Task 10). ✓
- `DiffViewMode = "split"|"unified"`; `diffsLayout → "split"|"stacked"` (Task 5) ⇄ `GitDiffViewer viewMode` (Task 8) ⇄ `ViewModeToggle` (Task 10). ✓
- `buildFileTree → DiffTreeNode[]` with `DiffTreeFolderNode.children`/`.name`/`.path` (Task 3) ⇄ consumed by `GitDiffFileTree` `TreeNode` (Task 9). ✓
- i18n keys used in code (`issue.diff.*`, including `errors.loadFailed`, `files`, `tabs.*`, `viewMode.*`, `list.*`, `commits.*`, `workspaceUnavailable`, `selectFile`, `empty`, `loading`, `button`, `shortcutHint`) all defined in Task 11. ✓
