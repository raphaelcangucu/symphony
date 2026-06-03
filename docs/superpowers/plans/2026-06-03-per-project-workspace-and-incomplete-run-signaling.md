# Per-Project Workspace Resolution + Incomplete-Run Signaling Implementation Plan

**Goal:** Fix two compounding orchestrator bugs that caused issue `DIS-1` (project `distributionmachine`) to run in the wrong repo's workspace, produce no PR/branch/workpad, and still be force-moved to Human Review as if it had succeeded.

**Architecture:** (Bug A) Make per-issue workspace/repo/hook resolution derive from the issue's *own project* config (`ProjectConfig` + `project.tracker_config` + registered repositories) instead of the single global active `WORKFLOW`. (Bug B) Have `AgentRunner` report whether a run actually completed or merely exhausted `max_turns`, and have the orchestrator post a workpad comment (and a warning label) when promoting an incomplete run to a wait state.

**Tech Stack:** Elixir 1.19 / OTP 28, Phoenix, Ecto + SQLite (`.symphony/tracker.sqlite3`), ExUnit. Quality gates: `mix specs.check`, `make all`.

---

## Context & Root Cause (evidence)

Observed: `http://localhost:4000/tracker/projects/distributionmachine/board/issues/DIS-1/agent` — no PR, no local workpad, yet moved to Human Review.

Confirmed timeline (logs in `elixir/log/symphony.log.4/.5`, DB `elixir/.symphony/tracker.sqlite3`):

- Agent ran 20 turns, then: `Reached agent.max_turns ... with issue still active; returning control to orchestrator` followed by `Moved issue after normal agent completion: ... Todo -> Human Review`.
- DB `local_tracker_issues` row for `DIS-1` (id 45): `status = Human Review`, `branch_name = NULL`, `url = NULL`, `agent_session_id = NULL`; **zero** rows in `tracker_pull_requests`.
- Workspace used (from logs): `~/code/macro-markets-workspaces/clouapp/front/DIS-1` — the **macro-markets** root + **clouapp/front** repo, containing `front/` + `back/` and an **empty `.git`**.
- `~/code/distributionmachine-workspaces` is **empty**; `local_tracker_repositories` for distributionmachine has `local_path = NULL`.
- Orchestrator was started with `WORKFLOW=./WORKFLOW.macromarkets.example.md` (single global config).
- `local_tracker_projects` for `distributionmachine`: `tracker_kind = "github"`, `tracker_config = {"repo":"clouapp/distributionmachine","project_id":"PVT_kwDOCpPais4BZjW1","status_field":"Status"}`. **No `local_tracker_project_setups` row** — so `workflow_config`, `after_create_hook`, and `workspace.root` are empty and inherit the global macro-markets values.

### Bug A — workspace/repo/hook resolution ignores the issue's project

`AgentRunner.run/3` calls `Workspace.create_for_issue(issue)`:

```17:35:elixir/lib/symphony_elixir/agent_runner.ex
    case Workspace.create_for_issue(issue) do
      {:ok, workspace} ->
        try do
          with :ok <- Workspace.run_before_run_hook(workspace, issue),
               :ok <- run_codex_turns(workspace, issue, codex_update_recipient, opts) do
```

`Workspace` resolves everything from the global `Config`:

```137:149:elixir/lib/symphony_elixir/workspace.ex
  defp workspace_path_for_issue(safe_id, project_slug) when is_binary(safe_id) do
    case Config.tracker_kind() do
      "github" ->
        repo = SymphonyElixir.GitHub.Config.repo() || ""
        Path.join([Config.workspace_root(), repo, safe_id])

      _ when is_binary(project_slug) and project_slug != "" ->
        Path.join([Config.workspace_root(), project_slug, safe_id])

      _ ->
        Path.join(Config.workspace_root(), safe_id)
    end
  end
```

```161:175:elixir/lib/symphony_elixir/workspace.ex
  defp maybe_run_after_create_hook(workspace, issue_context, created?) do
    case created? do
      true ->
        case Config.workspace_hooks()[:after_create] do
          nil ->
            :ok

          command ->
            run_hook(command, workspace, issue_context, "after_create")
        end
```

Only `agent_kind` is resolved per-project (`agent_runner.ex:50-58` via `ProjectConfig.resolve`). The workspace path, the repo segment, and the `after_create` clone hook all come from the global workflow. Result: a distributionmachine issue is cloned and worked on as a macro-markets workspace; the real repo is never present, so no PR/branch/workpad can exist.

Secondary config gap: even `ProjectConfig` would not currently help, because:

```52:56:elixir/lib/symphony_elixir/project_config.ex
      workspace_root: get_in(opts, [:workspace, :root]),
      after_create_hook: setup && setup.after_create_hook,
      agent_kind: Config.agent_kind_from_config(project_front_matter),
```

`after_create_hook` reads only the dedicated `ProjectSetup.after_create_hook` column — **not** `workflow_config.hooks.after_create`. The backfill task stores front matter into `workflow_config` and never populates that column:

```62:62:elixir/lib/mix/tasks/symphony.workflows.backfill.ex
        case Context.upsert_project_setup(slug, %{workflow_config: config, prompt_template: prompt}) do
```

So importing `WORKFLOW.distributionmachine.md` today would still not wire its `hooks.after_create` clone step.

### Bug B — `max_turns` exhaustion is treated as a successful completion

```195:198:elixir/lib/symphony_elixir/agent_runner.ex
      true ->
        Logger.info("Reached agent.max_turns for #{issue_context(refreshed_issue)} with issue still active; returning control to orchestrator")

        :ok
```

This returns `:ok`; the task exits `:normal`; the orchestrator treats it as a normal completion and applies the completion transition unconditionally:

```106:110:elixir/lib/symphony_elixir/orchestrator.ex
            :normal ->
              Logger.info("Agent task completed for issue_id=#{issue_id} session_id=#{session_id}; checking completion transition")

              apply_normal_completion(state, running_entry, issue_id)
```

```681:697:elixir/lib/symphony_elixir/orchestrator.ex
  defp apply_completion_transition(%State{} = state, issue_id) do
    transitions = Config.completion_transitions()

    with true <- map_size(transitions) > 0,
         {:ok, [%Issue{} = issue | _]} <- Tracker.fetch_issue_states_by_ids([issue_id]),
         destination when is_binary(destination) <- Map.get(transitions, issue.state) do
      case Tracker.update_issue_state(issue.id, destination) do
        :ok ->
          Logger.info("Moved issue after normal agent completion: #{issue_context(issue)} #{issue.state} -> #{destination}")

          {:transitioned, release_issue_claim(complete_issue(state, issue_id), issue_id)}
```

There is no signal distinguishing "agent finished the work" from "agent ran out of turns".

---

## Design Decisions

These are the choices locked in for this plan. Review before implementation.

1. **Bug A repo source:** the per-issue repo segment comes from the issue's project record (`project.tracker_config["repo"]`) for `tracker_kind == "github"`, falling back to the global `GitHub.Config.repo()` only when the issue has no resolvable project. This is the minimal change that puts the agent in the right repo path.

2. **Bug A clone step:** the `after_create` hook is resolved per-project from the **merged** front matter (`workflow_config.hooks.after_create`) OR the `ProjectSetup.after_create_hook` column, falling back to the global `Config.workspace_hooks()[:after_create]` **only when the issue has no project**. A project that resolves but has *no* hook configured runs **no** global hook (prevents cross-project contamination like cloning `clouapp/front` into a distributionmachine workspace).

3. **Bug A operational unblock:** `WORKFLOW.distributionmachine.md` already declares the correct `workspace.root` and `after_create` clone. We will (a) make `ProjectConfig.after_create_hook` read `workflow_config.hooks.after_create`, and (b) import the file via the backfill task. No new auto-clone subsystem is introduced in this plan (registered-repository auto-clone is noted as a future enhancement, intentionally out of scope — YAGNI for the immediate fix).

4. **Bug B behavior (per user):** an incomplete run (reached `max_turns` with the issue still in an active source state) **still** transitions per `completion_transitions` (e.g. Todo → Human Review), but the orchestrator first posts a `## Codex Workpad` comment summarizing the problem (max turns reached, no PR detected) and adds a warning label (`symphony:incomplete`). Completed runs behave exactly as today (no comment, no label).

5. **Bug B incomplete signal:** `AgentRunner.run/3` returns a structured outcome and stashes it where the orchestrator can read it after `:DOWN`. Because the orchestrator only receives `{:DOWN, ref, :process, pid, reason}`, `AgentRunner` will **send a message** `{:agent_outcome, issue_id, outcome}` to the recipient (the orchestrator) right before returning, and the orchestrator records it on the running entry. `outcome` is `:completed` or `{:incomplete, :max_turns}`.

6. **Secondary (optional, Task 7):** the PR-tab `{:invalid_issue_identifier, "DIS-1"}` warning is a display-only concern for local-first identifiers; fixing it is included as an isolated, optional task and does not block A/B.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `elixir/lib/symphony_elixir/project_config.ex` | per-project effective config | add `:repo`; source `after_create_hook` from merged front matter too |
| `elixir/lib/symphony_elixir/workspace.ex` | per-issue workspace path + hooks | resolve layout (root/segment/hook) from the issue's project |
| `elixir/lib/symphony_elixir/agent_runner.ex` | single-issue execution | return + report structured run outcome |
| `elixir/lib/symphony_elixir/orchestrator.ex` | dispatch + completion | record outcome; comment + label on incomplete completion |
| `elixir/lib/symphony_elixir/local_tracker/context.ex` | local tracker writes | add `ensure_issue_label` helper exposure (warning label) if not already callable |
| `elixir/test/symphony_elixir/workspace_test.exs` | tests | per-project path/hook tests |
| `elixir/test/symphony_elixir/project_config_test.exs` | tests | repo + hook resolution tests |
| `elixir/test/symphony_elixir/agent_runner_test.exs` | tests | outcome reporting tests |
| `elixir/test/symphony_elixir/orchestrator_test.exs` | tests | incomplete-completion comment/label tests |

> Before writing code in each task, open the listed file and confirm current line numbers (the repo evolves). Run `mix test <path>` for the touched test only while iterating; run `make all` before handoff.

---

## Task 1: `ProjectConfig` exposes per-project `repo` and resolves `after_create_hook` from front matter

**Files:**
- Modify: `elixir/lib/symphony_elixir/project_config.ex`
- Test: `elixir/test/symphony_elixir/project_config_test.exs`

- [ ] **Step 1: Write failing tests**

Add to `project_config_test.exs` (create the file if absent; mirror existing fixture helpers used elsewhere — see `elixir/test/support` for project/setup factories):

```elixir
defmodule SymphonyElixir.ProjectConfigTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.LocalTracker.{Context, Project, ProjectSetup}
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.Repo

  test "resolve/1 exposes repo from tracker_config for github projects" do
    {:ok, project} =
      Context.ensure_project(%{
        name: "dm",
        slug: "dm",
        tracker_kind: "github",
        tracker_config: %{"repo" => "clouapp/distributionmachine", "project_id" => "PVT_x"}
      })

    config = ProjectConfig.resolve(project)

    assert config.repo == "clouapp/distributionmachine"
  end

  test "resolve/1 reads after_create_hook from workflow_config.hooks" do
    {:ok, project} =
      Context.ensure_project(%{name: "dm2", slug: "dm2", tracker_kind: "github",
        tracker_config: %{"repo" => "clouapp/x", "project_id" => "PVT_y"}})

    {:ok, _setup} =
      Context.upsert_project_setup("dm2", %{
        workflow_config: %{"hooks" => %{"after_create" => "gh repo clone clouapp/x . -- --depth 1"}}
      })

    config = ProjectConfig.resolve(Repo.preload(project, :setup))

    assert config.after_create_hook == "gh repo clone clouapp/x . -- --depth 1"
  end

  test "resolve/1 prefers the ProjectSetup.after_create_hook column when present" do
    {:ok, project} =
      Context.ensure_project(%{name: "dm3", slug: "dm3", tracker_kind: "github",
        tracker_config: %{"repo" => "clouapp/z", "project_id" => "PVT_z"}})

    {:ok, _setup} =
      Context.upsert_project_setup("dm3", %{
        after_create_hook: "echo column-wins",
        workflow_config: %{"hooks" => %{"after_create" => "echo front-matter-loses"}}
      })

    config = ProjectConfig.resolve(Repo.preload(project, :setup))

    assert config.after_create_hook == "echo column-wins"
  end
end
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/project_config_test.exs`
Expected: FAIL — `config.repo` undefined / `after_create_hook` is `nil`.

- [ ] **Step 3: Implement**

In `project_config.ex`, add `:repo` to `defstruct` (after `:tracker_config`) and set both fields in `resolve/1`:

```elixir
defstruct [
  :project_id,
  :project_slug,
  :tracker_kind,
  :tracker_config,
  :repo,
  :active_states,
  :dispatch_states,
  :wait_states,
  :terminal_states,
  :field_states,
  :workspace_root,
  :after_create_hook,
  :agent_kind,
  :prompt_template
]
```

```elixir
  def resolve(%Project{} = project) do
    setup = load_setup(project)
    project_front_matter = setup_front_matter(setup)
    merged = deep_merge(Config.workflow_front_matter(), project_front_matter)
    opts = Config.validate_front_matter(merged)

    %__MODULE__{
      project_id: project.id,
      project_slug: project.slug,
      tracker_kind: project.tracker_kind,
      tracker_config: project.tracker_config || %{},
      repo: project_repo(project),
      active_states: get_in(opts, [:tracker, :active_states]),
      dispatch_states: dispatch_states(opts),
      wait_states: get_in(opts, [:tracker, :wait_states]) || [],
      terminal_states: get_in(opts, [:tracker, :terminal_states]),
      field_states: field_states(opts),
      workspace_root: get_in(opts, [:workspace, :root]),
      after_create_hook: resolve_after_create_hook(setup, project_front_matter),
      agent_kind: Config.agent_kind_from_config(project_front_matter),
      prompt_template: resolve_prompt(setup)
    }
  end

  defp project_repo(%Project{tracker_config: %{} = cfg}) do
    case Map.get(cfg, "repo") do
      repo when is_binary(repo) and repo != "" -> repo
      _ -> nil
    end
  end

  defp project_repo(_project), do: nil

  defp resolve_after_create_hook(%ProjectSetup{after_create_hook: hook}, _front_matter)
       when is_binary(hook) and hook != "",
       do: hook

  defp resolve_after_create_hook(_setup, %{} = front_matter) do
    case get_in(front_matter, ["hooks", "after_create"]) do
      hook when is_binary(hook) and hook != "" -> hook
      _ -> nil
    end
  end

  defp resolve_after_create_hook(_setup, _front_matter), do: nil
```

Add `@spec` for any new public function (none here — all `defp`). The struct change needs no spec update beyond the existing `@type t`.

- [ ] **Step 4: Run tests; verify pass**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/project_config_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/project_config.ex elixir/test/symphony_elixir/project_config_test.exs
git commit -m "feat(config): expose per-project repo and resolve after_create hook from front matter"
```

---

## Task 2: `Workspace` resolves path + after_create hook from the issue's project

**Files:**
- Modify: `elixir/lib/symphony_elixir/workspace.ex`
- Test: `elixir/test/symphony_elixir/workspace_test.exs`

**Design:** add one private resolver `layout_for(issue_context)` returning `%{root, segment, after_create_hook, project_resolved?}`. All path/hook logic flows through it so `create_for_issue/1`, `path_for_issue/1`, `editor.ex`, `dev_server`, etc. stay consistent (they all call `path_for_issue/1` which calls `workspace_path_for_issue/2`).

- [ ] **Step 1: Write failing tests**

Add to `workspace_test.exs`:

```elixir
test "path_for_issue/1 uses the issue project's repo, not the global repo" do
  {:ok, _project} =
    Context.ensure_project(%{name: "dm", slug: "dm", tracker_kind: "github",
      tracker_config: %{"repo" => "clouapp/distributionmachine", "project_id" => "PVT_x"}})

  issue = %{id: "DIS-1", identifier: "DIS-1", project_slug: "dm"}

  path = Workspace.path_for_issue(issue)

  assert String.ends_with?(path, "/clouapp/distributionmachine/DIS-1")
  refute String.contains?(path, "/clouapp/front/")
end
```

> Confirm the global test config's `Config.workspace_root()` value; assert on the project segment (`clouapp/distributionmachine/DIS-1`) rather than the absolute root to stay independent of host paths.

- [ ] **Step 2: Run; verify fail**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/workspace_test.exs`
Expected: FAIL — path contains the global repo (`clouapp/front`) or `dm` slug instead of `clouapp/distributionmachine`.

- [ ] **Step 3: Implement**

Replace `workspace_path_for_issue/2` usage with a layout-aware resolver. Edit `create_for_issue/1` and `path_for_issue/1` to compute layout from the full context, and rewrite `workspace_path_for_issue` + `maybe_run_after_create_hook`:

```elixir
  def create_for_issue(issue_or_identifier) do
    ctx = issue_context(issue_or_identifier)
    layout = layout_for(ctx)
    workspace = workspace_path_for_layout(safe_identifier(ctx.issue_identifier), layout)

    ensure_at(workspace, issue_or_identifier)
  end

  def path_for_issue(issue_or_identifier) do
    ctx = issue_context(issue_or_identifier)
    layout = layout_for(ctx)
    workspace_path_for_layout(safe_identifier(ctx.issue_identifier), layout)
  end

  defp layout_for(%{project_slug: slug} = ctx) do
    case resolve_project_config(ctx) do
      {:ok, config} ->
        %{
          root: config.workspace_root || Config.workspace_root(),
          segment: layout_segment(config),
          after_create_hook: config.after_create_hook,
          project_resolved?: true
        }

      :error ->
        %{
          root: Config.workspace_root(),
          segment: global_segment(slug),
          after_create_hook: Config.workspace_hooks()[:after_create],
          project_resolved?: false
        }
    end
  end

  defp resolve_project_config(%{project_slug: slug}) when is_binary(slug) and slug != "" do
    case SymphonyElixir.LocalTracker.Context.get_project(slug) do
      {:ok, project} ->
        {:ok, project |> SymphonyElixir.Repo.preload(:setup) |> SymphonyElixir.ProjectConfig.resolve()}

      _ ->
        :error
    end
  end

  defp resolve_project_config(%{issue_identifier: identifier}) when is_binary(identifier) do
    case SymphonyElixir.LocalTracker.Context.find_project_slug(identifier) do
      slug when is_binary(slug) and slug != "" -> resolve_project_config(%{project_slug: slug})
      _ -> :error
    end
  end

  defp resolve_project_config(_ctx), do: :error

  defp layout_segment(%{tracker_kind: "github", repo: repo}) when is_binary(repo) and repo != "", do: repo
  defp layout_segment(%{project_slug: slug}) when is_binary(slug) and slug != "", do: slug
  defp layout_segment(_config), do: ""

  defp global_segment(slug) do
    case Config.tracker_kind() do
      "github" -> SymphonyElixir.GitHub.Config.repo() || ""
      _ when is_binary(slug) and slug != "" -> slug
      _ -> ""
    end
  end

  defp workspace_path_for_layout(safe_id, %{root: root, segment: ""}) do
    Path.join(root, safe_id)
  end

  defp workspace_path_for_layout(safe_id, %{root: root, segment: segment}) do
    Path.join([root, segment, safe_id])
  end
```

Rewrite the hook runner to use the resolved layout's hook (thread the hook through `ensure_at`). Minimal approach: compute the layout once in `ensure_at` by resolving from the issue context, since `ensure_at` already has `issue_or_identifier`:

```elixir
  def ensure_at(workspace, issue_or_identifier) when is_binary(workspace) do
    issue_context = issue_context(issue_or_identifier)
    layout = layout_for(issue_context)

    try do
      with :ok <- validate_workspace_path(workspace),
           {:ok, created?} <- ensure_workspace(workspace),
           :ok <- maybe_run_after_create_hook(workspace, issue_context, layout, created?),
           :ok <- WorkspaceSkills.prepare(workspace) do
        {:ok, workspace}
      end
    rescue
      error in [ArgumentError, ErlangError, File.Error] ->
        Logger.error("Workspace ensure failed #{issue_log_context(issue_context)} error=#{Exception.message(error)}")
        {:error, error}
    end
  end

  defp maybe_run_after_create_hook(_workspace, _ctx, _layout, false), do: :ok

  defp maybe_run_after_create_hook(workspace, issue_context, %{after_create_hook: command}, true)
       when is_binary(command) and command != "" do
    run_hook(command, workspace, issue_context, "after_create")
  end

  defp maybe_run_after_create_hook(_workspace, _ctx, _layout, true), do: :ok
```

Remove the now-unused `workspace_path_for_issue/2` and the old global `maybe_run_after_create_hook/3`. Keep `validate_workspace_path/1` using `Config.workspace_root()` — but note it must validate against the **layout root**, not the global root. Update `validate_workspace_path/1` to accept the root:

```elixir
defp validate_workspace_path(workspace) do
  validate_workspace_path(workspace, Config.workspace_root())
end

defp validate_workspace_path(workspace, root_value) when is_binary(workspace) do
  expanded_workspace = Path.expand(workspace)
  root = Path.expand(root_value)
  root_prefix = root <> "/"
  # ... existing cond unchanged, using `root`/`root_prefix` ...
end
```

And in `ensure_at`, call `validate_workspace_path(workspace, layout.root)`.

> Add/keep `@spec` on the public functions whose signatures changed (`create_for_issue/1`, `path_for_issue/1`, `ensure_at/2` keep their specs). New helpers are `defp` (no spec required). Run `mix specs.check` after.

- [ ] **Step 4: Run tests; verify pass**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/workspace_test.exs`
Expected: PASS. Then run the broader workspace-dependent tests:
`cd elixir && mise exec -- mix test test/symphony_elixir/agent_runner_test.exs test/symphony_elixir/workspace_test.exs`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/workspace.ex elixir/test/symphony_elixir/workspace_test.exs
git commit -m "fix(workspace): resolve per-issue path, repo segment, and after_create hook from the issue's project"
```

---

## Task 3: Verify validation root + path consistency across callers

**Files:**
- Read: `elixir/lib/symphony_elixir/editor.ex:41`, `elixir/lib/symphony_elixir/dev_server/manager.ex:145`, `elixir/lib/symphony_elixir/dev_server.ex:53`, `elixir/lib/symphony_elixir/assistant/read_tools.ex:325`, `elixir/lib/symphony_elixir/assistant/issue_documents.ex:53`
- Test: `elixir/test/symphony_elixir/workspace_test.exs`

These callers pass an identifier (sometimes without `project_slug`). The `layout_for/1` resolver handles that by falling back to `find_project_slug/1`.

- [ ] **Step 1: Write a regression test that identifier-only resolution matches issue-map resolution**

```elixir
test "path_for_issue/1 is identical for identifier-only and issue-map inputs" do
  {:ok, _p} = Context.ensure_project(%{name: "dm", slug: "dm", tracker_kind: "github",
    tracker_config: %{"repo" => "clouapp/distributionmachine", "project_id" => "PVT_x"}})
  {:ok, _issue} = Context.create_issue("dm", %{identifier: "DIS-1", title: "t"})

  from_map = Workspace.path_for_issue(%{id: "DIS-1", identifier: "DIS-1", project_slug: "dm"})
  from_id = Workspace.path_for_issue("DIS-1")

  assert from_map == from_id
end
```

> Confirm `Context.create_issue/2`'s real signature before using it; adjust to the actual issue-creation helper used in tests (`grep "def create_issue" elixir/lib/symphony_elixir/local_tracker/context.ex`).

- [ ] **Step 2: Run; verify it passes (resolver should already satisfy this) or fails and fix**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/workspace_test.exs -k "identical"`
Expected: PASS. If FAIL, ensure `find_project_slug/1` is used in the identifier-only branch.

- [ ] **Step 3: Commit (only if changes were needed)**

```bash
git add elixir/lib/symphony_elixir/workspace.ex elixir/test/symphony_elixir/workspace_test.exs
git commit -m "test(workspace): lock identifier-only and issue-map path resolution parity"
```

---

## Task 4: Backfill task wires `after_create_hook` and import `WORKFLOW.distributionmachine.md`

**Files:**
- Modify: `elixir/lib/mix/tasks/symphony.workflows.backfill.ex:62`
- Read: `elixir/lib/symphony_elixir/local_tracker/context.ex` (`upsert_project_setup/2`)

Because Task 1 makes `ProjectConfig` read `workflow_config.hooks.after_create`, importing the file is now sufficient. (No code change strictly required for the hook to take effect; this task is the operational unblock + an optional convenience.)

- [ ] **Step 1: Import the orphaned workflow into the DB**

Run (from `elixir/`, with the dev DB the orchestrator uses):

```bash
cd elixir && set -a && . ./.env && set +a && mise exec -- mix symphony.workflows.backfill --dir .
```

Expected output includes: `multi_orchestrator: imported project=distributionmachine` (or `skipped (db-owned)` if a setup already exists — in which case configure it via the UI Project setup form instead).

- [ ] **Step 2: Verify the hook resolves**

Run a one-off IEx check:

```bash
cd elixir && mise exec -- mix run -e '
  {:ok, p} = SymphonyElixir.LocalTracker.Context.get_project("distributionmachine")
  cfg = p |> SymphonyElixir.Repo.preload(:setup) |> SymphonyElixir.ProjectConfig.resolve()
  IO.inspect({cfg.repo, cfg.workspace_root, cfg.after_create_hook}, label: "dm config")
'
```

Expected: `repo` = `"clouapp/distributionmachine"`, `workspace_root` = `~/code/distributionmachine-workspaces` (expanded), `after_create_hook` = the `gh repo clone clouapp/distributionmachine . -- --depth 1` command.

- [ ] **Step 3 (optional code): also populate the dedicated column on import**

If you want the column populated for UI display, modify `upsert_if_needed/3`:

```elixir
        case Context.upsert_project_setup(slug, %{
               workflow_config: config,
               prompt_template: prompt,
               after_create_hook: get_in(config, ["hooks", "after_create"])
             }) do
```

- [ ] **Step 4: Commit (if Step 3 applied)**

```bash
git add elixir/lib/mix/tasks/symphony.workflows.backfill.ex
git commit -m "feat(backfill): populate project after_create_hook column from imported workflow"
```

---

## Task 5: `AgentRunner` reports a structured run outcome

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex`
- Test: `elixir/test/symphony_elixir/agent_runner_test.exs`

**Design:** `run_codex_turns` already knows when it hit `max_turns` (the `true ->` branch at lines 195-198). Thread the outcome up to `run/3`, and have `run/3` send `{:agent_outcome, issue_id, outcome}` to the recipient before returning. `outcome :: :completed | {:incomplete, :max_turns}`.

- [ ] **Step 1: Write failing test**

```elixir
test "run/3 reports {:incomplete, :max_turns} when the loop exhausts turns with the issue still active" do
  # Use the existing test doubles: a fake CodingAgent that always 'completes a turn'
  # and an issue_state_fetcher that keeps the issue active so the loop runs to max_turns.
  recipient = self()
  issue = build_issue(identifier: "DIS-1", project_slug: "dm")

  AgentRunner.run(issue, recipient,
    max_turns: 2,
    issue_state_fetcher: fn _ids -> {:ok, [%{id: "DIS-1", state: "Todo"}]} end,
    # inject fake agent module via opts if supported; otherwise via Application env
  )

  assert_receive {:agent_outcome, "DIS-1", {:incomplete, :max_turns}}
end
```

> Inspect `agent_runner_test.exs` for the established injection pattern (how `CodingAgent` and `issue_state_fetcher` are faked today). Reuse it; do not invent a new mocking mechanism.

- [ ] **Step 2: Run; verify fail**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/agent_runner_test.exs -k "incomplete"`
Expected: FAIL — no `:agent_outcome` message received.

- [ ] **Step 3: Implement**

Return the outcome from the loop. Change the `:ok` returns to outcomes:

```elixir
      true ->
        Logger.info("Reached agent.max_turns for #{issue_context(refreshed_issue)} with issue still active; returning control to orchestrator")

        {:incomplete, :max_turns}
```

The `{:done, _refreshed_issue} -> :ok` branch becomes `-> :completed`, and the `goal_mode?` branch returns `:completed`. Propagate the loop's return value through `do_run_codex_turns/.../run_codex_turns`. Then in `run/3`:

```elixir
  def run(issue, codex_update_recipient \\ nil, opts \\ []) do
    opts = issue_goal_opts(issue, opts)
    Logger.info("Starting agent run for #{issue_context(issue)}")

    outcome = do_run(issue, codex_update_recipient, opts)
    report_outcome(codex_update_recipient, issue, outcome)
    :ok
  end

  defp do_run(issue, recipient, opts) do
    case Workspace.create_for_issue(issue) do
      {:ok, workspace} ->
        try do
          with :ok <- Workspace.run_before_run_hook(workspace, issue),
               outcome when outcome in [:completed] or (is_tuple(outcome) and elem(outcome, 0) == :incomplete) <-
                 run_codex_turns(workspace, issue, recipient, opts) do
            outcome
          else
            {:error, reason} ->
              Logger.error("Agent run failed for #{issue_context(issue)}: #{inspect(reason)}")
              raise RuntimeError, "Agent run failed for #{issue_context(issue)}: #{inspect(reason)}"
          end
        after
          Workspace.run_after_run_hook(workspace, issue)
        end

      {:error, reason} ->
        Logger.error("Agent run failed for #{issue_context(issue)}: #{inspect(reason)}")
        raise RuntimeError, "Agent run failed for #{issue_context(issue)}: #{inspect(reason)}"
    end
  end

  defp report_outcome(recipient, %Issue{id: id}, outcome) when is_pid(recipient) and is_binary(id) do
    send(recipient, {:agent_outcome, id, outcome})
    :ok
  end

  defp report_outcome(_recipient, _issue, _outcome), do: :ok
```

Update `@spec run/3` to keep `:: :ok | no_return()`. Add `@spec` only on new public functions (none; `do_run`/`report_outcome` are `defp`).

> Keep raising on `{:error, _}` so genuine failures still hit the `:DOWN` non-normal retry path. Only normal-exit outcomes are reported.

- [ ] **Step 4: Run; verify pass**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/agent_runner_test.exs`
Expected: PASS (incomplete + existing completed-path tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/agent_runner.ex elixir/test/symphony_elixir/agent_runner_test.exs
git commit -m "feat(agent_runner): report structured run outcome (completed vs incomplete max_turns)"
```

---

## Task 6: Orchestrator records outcome and annotates incomplete completions

**Files:**
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex` (expose a warning-label helper if needed)
- Test: `elixir/test/symphony_elixir/orchestrator_test.exs`

**Design:** store the last reported outcome on the running entry; when `apply_normal_completion` runs and the outcome is `{:incomplete, _}`, post a workpad comment and add the `symphony:incomplete` label *before* the transition log line. Completed runs are unchanged.

- [ ] **Step 1: Write failing test**

```elixir
test "incomplete run still transitions but posts a workpad comment and warning label" do
  # Arrange a running entry whose agent reported {:incomplete, :max_turns},
  # with completion_transitions configured (Todo -> Human Review) and a Todo issue.
  # Use the existing Tracker test double to capture create_comment/update_issue_state calls.

  # ... set up state with running entry for issue_id "DIS-1", outcome {:incomplete, :max_turns}

  state = Orchestrator.handle_agent_down(state, ref, :normal)  # or drive via handle_info

  assert_received {:tracker_comment, "DIS-1", body}
  assert body =~ "max turns"
  assert body =~ "No pull request"
  assert_received {:tracker_state, "DIS-1", "Human Review"}
  assert_received {:tracker_label, "DIS-1", "symphony:incomplete"}
end
```

> Match the orchestrator's existing test harness (it likely drives `handle_info({:DOWN, ...})` directly and uses an injected Tracker double). Reuse those exact helpers; align assertion message shapes with the double's emitted messages.

- [ ] **Step 2: Run; verify fail**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/orchestrator_test.exs -k "incomplete"`
Expected: FAIL — no comment/label emitted.

- [ ] **Step 3: Implement**

Add an `:agent_outcome` handler and store it:

```elixir
  def handle_info({:agent_outcome, issue_id, outcome}, %{running: running} = state) do
    case Map.get(running, issue_id) do
      nil -> {:noreply, state}
      entry -> {:noreply, %{state | running: Map.put(running, issue_id, Map.put(entry, :agent_outcome, outcome))}}
    end
  end
```

In `apply_normal_completion/3`, branch on the stored outcome before applying the transition:

```elixir
  defp apply_normal_completion(%State{} = state, running_entry, issue_id) do
    maybe_annotate_incomplete(running_entry, issue_id)

    case apply_completion_transition(state, issue_id) do
      # ... unchanged ...
    end
  end

  defp maybe_annotate_incomplete(running_entry, issue_id) do
    case Map.get(running_entry, :agent_outcome) do
      {:incomplete, reason} ->
        Logger.warning("Agent run incomplete for issue_id=#{issue_id} reason=#{inspect(reason)}; annotating before completion transition")
        post_incomplete_workpad_comment(issue_id, reason, running_entry)
        add_incomplete_label(running_entry)

      _ ->
        :ok
    end
  end

  defp post_incomplete_workpad_comment(issue_id, reason, running_entry) do
    body = """
    ## Codex Workpad

    > ⚠️ Symphony auto-note: this run ended **incomplete** (#{incomplete_reason_text(reason)}).
    >
    > - No pull request was detected for this issue at handoff.
    > - The issue was moved to its review state automatically by the orchestrator, not by the agent finishing the work.
    > - Please review the workspace state and re-dispatch (Rework) if the task is not actually done.
    """

    case Tracker.create_comment(issue_id, body) do
      :ok -> :ok
      {:error, reason} -> Logger.warning("Failed to post incomplete workpad comment issue_id=#{issue_id}: #{inspect(reason)}")
    end
  end

  defp incomplete_reason_text(:max_turns), do: "reached the configured max turns with the issue still active"
  defp incomplete_reason_text(other), do: "reason=#{inspect(other)}"
```

For the label, add a small helper in `LocalTracker.Context` if there is no public path to attach a label by name (there is `ensure_label/2` + `ensure_issue_label/2` used privately at `context.ex:1139-1140`). Expose:

```elixir
  @spec add_issue_label(String.t(), String.t(), String.t()) :: {:ok, term()} | {:error, term()}
  def add_issue_label(project_slug, identifier, label_name)
      when is_binary(project_slug) and is_binary(identifier) and is_binary(label_name) do
    with {:ok, project} <- fetch_project(project_slug),
         {:ok, issue} <- fetch_project_issue(project.id, identifier),
         {:ok, label} <- ensure_label(project.id, label_name),
         {:ok, _} <- ensure_issue_label(issue.id, label.id) do
      {:ok, issue}
    end
  end
```

Then in the orchestrator:

```elixir
  defp add_incomplete_label(%{issue: %Issue{identifier: identifier, project_slug: slug}})
       when is_binary(identifier) and is_binary(slug) do
    case SymphonyElixir.LocalTracker.Context.add_issue_label(slug, identifier, "symphony:incomplete") do
      {:ok, _} -> :ok
      {:error, reason} -> Logger.warning("Failed to add incomplete label issue=#{identifier}: #{inspect(reason)}")
    end
  end

  defp add_incomplete_label(_running_entry), do: :ok
```

> The label only persists locally (and syncs via the outbox for github-backed projects only if a label-create operation is supported — verify; if not, the local label still drives the UI warning, which satisfies the requirement). Keep the comment via `Tracker.create_comment/2` so it works in both live and local-first modes.

- [ ] **Step 4: Run; verify pass**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/orchestrator_test.exs`
Expected: PASS — incomplete path emits comment + label + transition; completed path unchanged.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/orchestrator.ex elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/orchestrator_test.exs
git commit -m "feat(orchestrator): annotate incomplete agent completions with workpad comment and warning label"
```

---

## Task 7 (optional, isolated): stop logging `invalid_issue_identifier` for local-first identifiers

**Files:**
- Read: `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_controller.ex`
- Modify: `elixir/lib/symphony_elixir/github/pull_requests.ex:526-535`
- Test: `elixir/test/symphony_elixir/github/pull_requests_test.exs`

**Design:** for non-numeric identifiers (local-first keys like `DIS-1`), the GitHub-issue-number discovery is simply not applicable. Treat it as "no live discovery" (`{:ok, []}`) rather than a warning, mirroring `issue_adapter.ex:200`'s existing handling. Persisted PRs (keyed by `(project_id, issue_identifier)`) still surface.

- [ ] **Step 1: Write failing test**

```elixir
test "discovery returns no live PRs (no warning) for non-numeric identifiers" do
  assert {:ok, []} = SymphonyElixir.GitHub.PullRequests.discover_for_issue("DIS-1", client_module: StubClient)
end
```

> Use the real public entry point the controller calls; confirm its name in `pull_request_controller.ex` (`SyncPullRequests` / `PullRequests`). Adjust the function name accordingly.

- [ ] **Step 2: Run; verify fail**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/pull_requests_test.exs -k "non-numeric"`
Expected: FAIL — returns `{:error, {:invalid_issue_identifier, "DIS-1"}}`.

- [ ] **Step 3: Implement**

At the call site that currently surfaces `{:error, {:invalid_issue_identifier, _}}` to the controller (and logs `PR lookup failed for DIS-1`), map a non-numeric identifier to `{:ok, []}` for live discovery. Prefer fixing in the controller's `respond/3` path so the persisted-PR merge still runs:

```elixir
case PullRequests.discover_for_issue(identifier, ...) do
  {:ok, prs} -> prs
  {:error, {:invalid_issue_identifier, _}} -> []   # local-first id: no live discovery, persisted PRs still merged
  {:error, reason} -> log_and_empty(reason, identifier)
end
```

- [ ] **Step 4: Run; verify pass + no warning**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/pull_requests_test.exs`
Expected: PASS; manual check: PR tab for `DIS-1` no longer logs `PR lookup failed`.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_controller.ex elixir/test/symphony_elixir/github/pull_requests_test.exs
git commit -m "fix(tracker): treat non-numeric issue ids as no-live-PR-discovery instead of warning"
```

---

## Task 8: Full gates + manual end-to-end verification

- [ ] **Step 1: Specs + full quality gate**

Run: `cd elixir && mise exec -- mix specs.check && make all`
Expected: format clean, credo clean, tests green, dialyzer clean.

- [ ] **Step 2: Manual end-to-end (re-dispatch DIS-1)**

1. Confirm `WORKFLOW.distributionmachine.md` is imported (Task 4 Step 2).
2. Restart the orchestrator: `cd elixir && make stop && sleep 2 && set -a && . ./.env && set +a && make serve WORKFLOW=./WORKFLOW.macromarkets.example.md`.
3. Move `DIS-1` back to `Todo` and let it dispatch.
4. Verify in `log/symphony.log`: `workspace=~/code/distributionmachine-workspaces/clouapp/distributionmachine/DIS-1` and a `Running workspace hook hook=after_create` line cloning `clouapp/distributionmachine`.
5. Verify on disk: `ls ~/code/distributionmachine-workspaces/clouapp/distributionmachine/DIS-1` contains the cloned repo with a populated `.git`.
6. If the agent exhausts turns again: confirm a `## Codex Workpad` auto-note comment and the `symphony:incomplete` label appear on `DIS-1`, and the issue still shows in Human Review.

- [ ] **Step 3: Final commit (docs)**

Update `elixir/README.md` / `elixir/WORKFLOW.md` if the per-project resolution behavior changes the documented contract (per `elixir/AGENTS.md` Docs Update Policy).

```bash
git add elixir/README.md elixir/WORKFLOW.md
git commit -m "docs: document per-project workspace resolution and incomplete-run signaling"
```

---

## Self-Review

**1. Spec coverage:**
- Bug A "wrong repo / no clone" → Tasks 1 (repo + hook in config), 2 (Workspace uses them), 3 (caller parity), 4 (import the orphaned workflow). ✓
- Bug B "incomplete run force-promoted, no PR, no workpad" → Tasks 5 (outcome signal), 6 (comment + warning label, per the user's chosen behavior: still transitions, but comments and tags). ✓
- Secondary `invalid_issue_identifier` warning → Task 7 (optional). ✓

**2. Placeholder scan:** Code steps include concrete code. Test bodies that depend on the existing harness include an explicit instruction to confirm/reuse the established double pattern (acceptable because the harness API is repo-specific and must be matched exactly, not invented).

**3. Type consistency:** `outcome` is `:completed | {:incomplete, :max_turns}` in Tasks 5 and 6. `ProjectConfig` gains `:repo` (Task 1) consumed by `layout_segment/1` (Task 2). `add_issue_label/3` defined in Task 6 (Context) and called in Task 6 (orchestrator). Label name `symphony:incomplete` consistent across Task 6.

**Known design decision needing sign-off before coding:** Decision 3 (no auto-clone-of-registered-repositories subsystem; rely on workflow import). If you'd rather Symphony *always* clone a project's registered repositories when no `after_create` hook exists, that is a larger feature (new clone step in workspace creation using `local_tracker_repositories` + `ClonerWorker`) and should be its own plan.
