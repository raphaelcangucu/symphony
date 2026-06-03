# Multi-Orchestrator Projects — Implementation Plan

**Goal:** When the server boots, orchestrate every non-archived project in the local DB, each with its own DB-owned config + prompt, with observability showing all projects and a project modal that edits the prompt (markdown) and config with a "load default" action.

**Architecture:** Single process / single SQLite writer / single `Orchestrator` that already iterates `Context.list_projects/0`. Per-project config + prompt become DB-owned (`local_tracker_project_setups.workflow_config` + `prompt_template`), resolved by a new `SymphonyElixir.ProjectConfig` that layers a project's WORKFLOW-shaped front matter over the global workflow defaults. The `Issue` struct gains `project_slug` so the prompt/agent/observability paths resolve per-project config. Observability reports one entry per project (composite `runtime_id`).

**Tech Stack:** Elixir 1.19 / OTP 28, Ecto + SQLite, NimbleOptions, YamlElixir, Phoenix, React + Vite + Vitest (`tracker/`), `react-markdown` + `remark-gfm`.

**Spec:** `docs/superpowers/specs/2026-06-02-multi-orchestrator-projects-design.md`

**Phasing (each phase ships independently):**
- Phase 1 — `ProjectConfig` foundation + `Config` reuse helpers.
- Phase 2 — `Issue.project_slug` plumbing.
- Phase 3 — Per-project states in candidate fetch (orchestrator behavioral change).
- Phase 4 — Per-project prompt/agent/workspace at dispatch.
- Phase 5 — `ProjectSetup` upsert API + project modal (markdown editor + load default + edit parity).
- Phase 6 — Multi-project observability.
- Phase 7 — Boot backfill + auto-discovery.

**Conventions (from `elixir/AGENTS.md`):**
- Public `def` in `lib/` needs an adjacent `@spec`.
- Run targeted tests while iterating; `make all` before handoff; `mix specs.check` for specs.
- Commit after each task.

---

## File Structure

**Create:**
- `elixir/lib/symphony_elixir/project_config.ex` — `%ProjectConfig{}` struct + `resolve/1`.
- `elixir/test/symphony_elixir/project_config_test.exs`
- `elixir/lib/mix/tasks/symphony.workflows.backfill.ex` — one-time backfill + discovery mix task.
- `elixir/test/mix/tasks/symphony_workflows_backfill_test.exs`
- `tracker/src/components/ui/markdown-editor.tsx` — Write/Preview editor.
- `tracker/src/components/projects/LoadDefaultMenu.tsx` — template "load default" dropdown.

**Modify:**
- `elixir/lib/symphony_elixir/config.ex` — expose `workflow_front_matter/0` + `validate_front_matter/1`; refactor `validated_workflow_options/0` to reuse.
- `elixir/lib/symphony_elixir/issue.ex` — add `project_slug`.
- `elixir/lib/symphony_elixir/local_tracker/issue_mapper.ex` — populate `project_slug`.
- `elixir/lib/symphony_elixir/tracker/sync/local_first_tracker.ex` — per-project active states in `fetch_candidate_issues/0`; carry project on mapped issues.
- `elixir/lib/symphony_elixir/prompt_builder.ex` — resolve prompt from the issue's project.
- `elixir/lib/symphony_elixir/agent_runner.ex` — resolve agent kind/workspace from the issue's project config.
- `elixir/lib/symphony_elixir/local_tracker/context.ex` — `upsert_project_setup/2`.
- `elixir/lib/symphony_elixir_web/controllers/tracker/project_controller.ex` + `router.ex` — `PUT /projects/:id/setup`.
- `elixir/lib/symphony_elixir/observability/reporter.ex` — one report per project.
- `elixir/lib/symphony_elixir_web/presenter.ex` + `elixir/lib/symphony_elixir/orchestrator.ex` — project-scoped snapshot.
- `tracker/src/services/projects.ts` + `tracker/src/types/project*.ts` — setup update API.
- `tracker/src/components/projects/EditProjectDialog.tsx` — prompt editor + workflow_config + load default.

---

## Phase 1 — `ProjectConfig` foundation

### Task 1.1: Expose reusable validation in `Config`

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex` (around lines 761–765, 1087–1095)
- Test: `elixir/test/symphony_elixir/config_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
# elixir/test/symphony_elixir/config_test.exs (add)
describe "validate_front_matter/1" do
  test "validates an arbitrary front-matter map and applies schema defaults" do
    opts =
      SymphonyElixir.Config.validate_front_matter(%{
        "tracker" => %{"active_states" => ["Todo", "In Progress"]}
      })

    assert get_in(opts, [:tracker, :active_states]) == ["Todo", "In Progress"]
    assert is_list(get_in(opts, [:tracker, :terminal_states]))
  end

  test "workflow_front_matter/0 returns the normalized global front matter map" do
    assert is_map(SymphonyElixir.Config.workflow_front_matter())
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs -o "validate_front_matter"`
Expected: FAIL (`function SymphonyElixir.Config.validate_front_matter/1 is undefined`).

- [ ] **Step 3: Implement**

In `config.ex`, replace the private `workflow_config/0` consumers by exposing two public functions and refactoring `validated_workflow_options/0`:

```elixir
# Add public functions (with @spec) near the other public accessors.

@spec workflow_front_matter() :: map()
def workflow_front_matter, do: workflow_config()

@spec validate_front_matter(map()) :: map()
def validate_front_matter(front_matter) when is_map(front_matter) do
  front_matter
  |> normalize_keys()
  |> extract_workflow_options()
  |> NimbleOptions.validate!(@workflow_options_schema)
end
```

Refactor the existing private helper to delegate:

```elixir
# Replace validated_workflow_options/0 body (was lines ~761-765)
defp validated_workflow_options do
  validate_front_matter(workflow_config())
end
```

(`workflow_config/0` already calls `normalize_keys/1`; `validate_front_matter/1` calling `normalize_keys/1` again is idempotent.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/config.ex elixir/test/symphony_elixir/config_test.exs
git commit -m "feat(config): expose front-matter validation for per-project resolution"
```

### Task 1.2: `ProjectConfig` struct + `resolve/1`

**Files:**
- Create: `elixir/lib/symphony_elixir/project_config.ex`
- Create: `elixir/test/symphony_elixir/project_config_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
# elixir/test/symphony_elixir/project_config_test.exs
defmodule SymphonyElixir.ProjectConfigTest do
  use SymphonyElixir.DataCase, async: false

  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.LocalTracker.{Context, ProjectSetup, Project}
  alias SymphonyElixir.Repo

  defp project_with_setup(slug, workflow_config, prompt) do
    {:ok, project} =
      Context.ensure_project(%{name: slug, slug: slug, tracker_kind: "local"})

    {:ok, _setup} =
      %ProjectSetup{}
      |> ProjectSetup.changeset(%{
        project_id: project.id,
        workflow_config: workflow_config,
        prompt_template: prompt,
        validation_commands: %{"commands" => []},
        scan_summary: %{}
      })
      |> Repo.insert()

    Repo.get!(Project, project.id) |> Repo.preload(:setup)
  end

  test "resolves per-project states from setup workflow_config" do
    project =
      project_with_setup(
        "alpha",
        %{"tracker" => %{"active_states" => ["Doing"], "terminal_states" => ["Shipped"]}},
        "Alpha prompt"
      )

    config = ProjectConfig.resolve(project)

    assert config.project_slug == "alpha"
    assert config.active_states == ["Doing"]
    assert config.terminal_states == ["Shipped"]
    assert config.prompt_template == "Alpha prompt"
  end

  test "falls back to global defaults when setup omits a key and to default prompt when blank" do
    {:ok, project} = Context.ensure_project(%{name: "beta", slug: "beta", tracker_kind: "local"})
    project = SymphonyElixir.Repo.preload(project, :setup)

    config = ProjectConfig.resolve(project)

    assert config.active_states == SymphonyElixir.Config.active_states()
    assert config.prompt_template == SymphonyElixir.Config.workflow_prompt()
    assert config.tracker_kind == "local"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/project_config_test.exs`
Expected: FAIL (`SymphonyElixir.ProjectConfig is undefined`).

- [ ] **Step 3: Implement**

```elixir
# elixir/lib/symphony_elixir/project_config.ex
defmodule SymphonyElixir.ProjectConfig do
  @moduledoc """
  Resolves the effective configuration + prompt for a single project.

  A project's DB-owned WORKFLOW front matter (`ProjectSetup.workflow_config`) is
  deep-merged over the global workflow front matter (`Config.workflow_front_matter/0`),
  then validated through the same schema the global config uses. Omitted keys
  inherit the global defaults; the prompt falls back to the global default when
  the project has no `prompt_template`.
  """

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.{Project, ProjectSetup}
  alias SymphonyElixir.Repo

  @enforce_keys [:project_id, :project_slug, :tracker_kind]
  defstruct [
    :project_id,
    :project_slug,
    :tracker_kind,
    :tracker_config,
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

  @type t :: %__MODULE__{}

  @spec resolve(Project.t()) :: t()
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
      active_states: get_in(opts, [:tracker, :active_states]),
      dispatch_states: dispatch_states(opts),
      wait_states: get_in(opts, [:tracker, :wait_states]) || [],
      terminal_states: get_in(opts, [:tracker, :terminal_states]),
      field_states: field_states(opts),
      workspace_root: get_in(opts, [:workspace, :root]),
      after_create_hook: setup && setup.after_create_hook,
      agent_kind: Config.default_agent_kind(),
      prompt_template: resolve_prompt(setup)
    }
  end

  defp load_setup(%Project{setup: %ProjectSetup{} = setup}), do: setup
  defp load_setup(%Project{setup: %Ecto.Association.NotLoaded{}} = project) do
    Repo.get_by(ProjectSetup, project_id: project.id)
  end
  defp load_setup(%Project{}), do: nil

  defp setup_front_matter(%ProjectSetup{workflow_config: %{} = config}) when map_size(config) > 0,
    do: config
  defp setup_front_matter(_setup), do: %{}

  defp resolve_prompt(%ProjectSetup{prompt_template: prompt}) when is_binary(prompt) do
    if String.trim(prompt) == "", do: Config.workflow_prompt(), else: prompt
  end
  defp resolve_prompt(_setup), do: Config.workflow_prompt()

  defp dispatch_states(opts) do
    case get_in(opts, [:tracker, :dispatch_states]) do
      states when is_list(states) and states != [] -> states
      _ -> get_in(opts, [:tracker, :active_states])
    end
  end

  defp field_states(opts) do
    case get_in(opts, [:tracker, :field_states]) do
      states when is_list(states) and states != [] ->
        Enum.uniq(states)

      _ ->
        Enum.uniq(get_in(opts, [:tracker, :active_states]) ++ get_in(opts, [:tracker, :terminal_states]))
    end
  end

  defp deep_merge(left, right) when is_map(left) and is_map(right) do
    Map.merge(left, right, fn _key, l, r -> deep_merge(l, r) end)
  end

  defp deep_merge(_left, right), do: right
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/project_config_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/project_config.ex elixir/test/symphony_elixir/project_config_test.exs
git commit -m "feat: add ProjectConfig.resolve/1 layering project front matter over global defaults"
```

---

## Phase 2 — `Issue.project_slug` plumbing

### Task 2.1: Add `project_slug` to the `Issue` struct

**Files:**
- Modify: `elixir/lib/symphony_elixir/issue.ex:6-43`
- Test: `elixir/test/symphony_elixir/issue_test.exs` (create if absent)

- [ ] **Step 1: Write the failing test**

```elixir
# elixir/test/symphony_elixir/issue_test.exs
defmodule SymphonyElixir.IssueTest do
  use ExUnit.Case, async: true

  test "issue struct carries project_slug defaulting to nil" do
    assert %SymphonyElixir.Issue{}.project_slug == nil
    assert %SymphonyElixir.Issue{project_slug: "alpha"}.project_slug == "alpha"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/issue_test.exs`
Expected: FAIL (`unknown key :project_slug`).

- [ ] **Step 3: Implement**

In `issue.ex`, add `project_slug: nil` to `defstruct` and `project_slug: String.t() | nil` to the `@type t`:

```elixir
  defstruct [
    :id,
    :identifier,
    :title,
    :description,
    :priority,
    :state,
    :branch_name,
    :url,
    :assignee_id,
    :agent_goal,
    :project_slug,
    blocked_by: [],
    labels: [],
    comments: [],
    agent_kind: nil,
    assigned_to_worker: true,
    created_at: nil,
    updated_at: nil
  ]
```

Add to `@type t`: `project_slug: String.t() | nil,`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/issue_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/issue.ex elixir/test/symphony_elixir/issue_test.exs
git commit -m "feat(issue): add project_slug to the normalized issue struct"
```

### Task 2.2: Populate `project_slug` in `IssueMapper`

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_mapper.ex:10-40`
- Test: `elixir/test/symphony_elixir/local_tracker/issue_mapper_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
# Add to issue_mapper_test.exs (create file/describe if needed)
test "maps the owning project slug onto the issue" do
  {:ok, project} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})
  {:ok, issue_record} = Context.create_issue("alpha", %{title: "T", state: hd(Context.list_statuses("alpha")).name})

  record =
    SymphonyElixir.LocalTracker.IssueRecord
    |> SymphonyElixir.Repo.get!(issue_record.id)
    |> SymphonyElixir.Repo.preload([:status, :labels, :comments, :source_relations, :project])

  issue = SymphonyElixir.LocalTracker.IssueMapper.to_issue(record)
  assert issue.project_slug == "alpha"
end
```

(Adjust `Context.create_issue/2` call to the real signature in `context.ex`; the key assertion is `issue.project_slug == "alpha"`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/issue_mapper_test.exs`
Expected: FAIL (`project_slug` is `nil`).

- [ ] **Step 3: Implement**

In `issue_mapper.ex`, add `project_slug: project_slug(record)` to the `%Issue{}` map in `to_issue/1` and a private resolver that reads the preloaded project (falling back to `nil` when not loaded):

```elixir
  defp project_slug(%IssueRecord{project: %SymphonyElixir.LocalTracker.Project{slug: slug}}), do: slug
  defp project_slug(_record), do: nil
```

Ensure the issue queries preload `:project`. Update `issue_preloads/0` in `local_first_tracker.ex` to add `:project`:

```elixir
# local_first_tracker.ex issue_preloads/0 — add :project to the list
[
  :status,
  :labels,
  :project,
  comments: ...,
  source_relations: ...
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/issue_mapper_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/issue_mapper.ex elixir/lib/symphony_elixir/tracker/sync/local_first_tracker.ex elixir/test/symphony_elixir/local_tracker/issue_mapper_test.exs
git commit -m "feat(issue): populate project_slug from the owning project"
```

---

## Phase 3 — Per-project candidate states

### Task 3.1: `fetch_candidate_issues/0` uses each project's active states

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/sync/local_first_tracker.ex:39-56,112-120,151-162`
- Test: `elixir/test/symphony_elixir/tracker/sync/local_first_tracker_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
# Add to local_first_tracker_test.exs
test "candidate fetch uses per-project active states" do
  # project A active state "Doing"; project B active state "Building"
  # seed an issue in each project in its own active state and one in a non-active state
  # ... seed projects + setups with distinct workflow_config tracker.active_states ...

  {:ok, issues} = LocalFirstTracker.fetch_candidate_issues()
  slugs_states = Enum.map(issues, &{&1.project_slug, &1.state}) |> Enum.sort()

  assert {"a", "Doing"} in slugs_states
  assert {"b", "Building"} in slugs_states
  refute Enum.any?(slugs_states, fn {_slug, state} -> state == "Backlog" end)
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/tracker/sync/local_first_tracker_test.exs -o "per-project active states"`
Expected: FAIL (today all projects share the global `Config.active_states()`).

- [ ] **Step 3: Implement**

Change `fetch_candidate_issues/0` to resolve states per project instead of passing one global list:

```elixir
@impl true
def fetch_candidate_issues do
  issues =
    list_orchestrator_projects()
    |> Enum.flat_map(fn project ->
      config = SymphonyElixir.ProjectConfig.resolve(project)

      case resolve_assignee_filter(project) do
        {:ok, filter} -> query_issues(project, config.active_states, filter)
        {:error, _reason} -> []
      end
    end)

  {:ok, issues}
end
```

Keep `fetch_issues_by_states/1` (used by startup cleanup with `Config.terminal_states()`) but make it per-project too so terminal-state cleanup honors each project:

```elixir
@impl true
def fetch_issues_by_states(states) when is_list(states) do
  issues =
    list_orchestrator_projects()
    |> Enum.flat_map(fn project ->
      case resolve_assignee_filter(project) do
        {:ok, filter} -> query_issues(project, states, filter)
        {:error, _reason} -> []
      end
    end)

  {:ok, issues}
end
```

`list_orchestrator_projects/0` must return projects with `:setup` preloaded so `ProjectConfig.resolve/1` does not N+1 query. Update it:

```elixir
defp list_orchestrator_projects do
  case Application.get_env(:symphony_elixir, :tracker_sync_project_slug) do
    slug when is_binary(slug) ->
      case find_or_backfill_project(slug) do
        {:ok, project} -> [SymphonyElixir.Repo.preload(project, :setup)]
        :skip -> []
      end

    _ ->
      Context.list_projects() |> SymphonyElixir.Repo.preload(:setup)
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/tracker/sync/local_first_tracker_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/tracker/sync/local_first_tracker.ex elixir/test/symphony_elixir/tracker/sync/local_first_tracker_test.exs
git commit -m "feat(tracker): fetch candidates using each project's active states"
```

---

## Phase 4 — Per-project prompt / agent / workspace

### Task 4.1: `PromptBuilder` resolves the prompt from the issue's project

**Files:**
- Modify: `elixir/lib/symphony_elixir/prompt_builder.ex:16-42,263-269`
- Test: `elixir/test/symphony_elixir/prompt_builder_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
test "uses the project's prompt_template when the issue carries a project_slug" do
  # seed project "alpha" with setup.prompt_template "ALPHA {{ issue.identifier }}"
  issue = %SymphonyElixir.Issue{identifier: "A-1", project_slug: "alpha", state: "Todo"}
  prompt = SymphonyElixir.PromptBuilder.build_prompt(issue, [])
  assert prompt =~ "ALPHA A-1"
end

test "falls back to the global workflow prompt when project_slug is nil" do
  issue = %SymphonyElixir.Issue{identifier: "G-1", project_slug: nil, state: "Todo"}
  assert is_binary(SymphonyElixir.PromptBuilder.build_prompt(issue, []))
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/prompt_builder_test.exs`
Expected: FAIL (prompt comes from global `Workflow.current()` regardless of project).

- [ ] **Step 3: Implement**

In `prompt_builder.ex`, resolve the template from the issue's project when present, else keep the current global behavior:

```elixir
@spec build_prompt(SymphonyElixir.Issue.t(), keyword()) :: String.t()
def build_prompt(issue, opts \\ []) do
  template =
    issue
    |> resolve_template()
    |> parse_template!()

  rendered =
    template
    |> Solid.render!(
      %{
        "attempt" => Keyword.get(opts, :attempt),
        "issue" => issue |> Map.from_struct() |> to_solid_map()
      },
      @render_opts
    )
    |> ...  # unchanged tail

  rendered <> discussion_section(issue) <> artifacts_section(Keyword.get(opts, :workspace))
end

defp resolve_template(%SymphonyElixir.Issue{project_slug: slug}) when is_binary(slug) do
  case SymphonyElixir.LocalTracker.Context.get_project(slug) do
    {:ok, project} ->
      project = SymphonyElixir.Repo.preload(project, :setup)
      SymphonyElixir.ProjectConfig.resolve(project).prompt_template

    {:error, _} ->
      global_template()
  end
end

defp resolve_template(_issue), do: global_template()

defp global_template do
  case Workflow.current() do
    {:ok, %{prompt_template: prompt}} -> default_prompt(prompt)
    {:error, reason} -> raise RuntimeError, "workflow_unavailable: #{inspect(reason)}"
  end
end
```

Keep `default_prompt/1` and `parse_template!/1` as-is.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/prompt_builder_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/prompt_builder.ex elixir/test/symphony_elixir/prompt_builder_test.exs
git commit -m "feat(prompt): build prompt from the issue's project template"
```

### Task 4.2: `AgentRunner`/`Workspace` resolve agent + workspace from the issue's project

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex:46-47`
- Modify: `elixir/lib/symphony_elixir/workspace.ex` (workspace root + after_create hook resolution)
- Test: `elixir/test/symphony_elixir/agent_runner_test.exs`, `elixir/test/symphony_elixir/workspace_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
# agent_runner_test.exs — issue agent kind still respects explicit issue.agent_kind,
# but the project default is used when the issue has none.
test "uses the project's default agent kind when issue.agent_kind is blank" do
  # project "alpha" setup.workflow_config agent.kind ... (or rely on global default)
  issue = %SymphonyElixir.Issue{identifier: "A-1", project_slug: "alpha", agent_kind: nil}
  assert SymphonyElixir.AgentRunner.issue_agent_kind(issue) in ~w(codex claude)
end
```

(Expose `issue_agent_kind/1` as a public `def` with `@spec` for testability, or test via behavior. Prefer a thin public function.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/agent_runner_test.exs`
Expected: FAIL (`issue_agent_kind/1` private/undefined) — adjust to drive the change.

- [ ] **Step 3: Implement**

Make agent kind resolve via the project config when the issue carries a slug:

```elixir
@spec issue_agent_kind(SymphonyElixir.Issue.t()) :: String.t()
def issue_agent_kind(%SymphonyElixir.Issue{agent_kind: kind}) when is_binary(kind) and kind != "",
  do: kind

def issue_agent_kind(%SymphonyElixir.Issue{project_slug: slug}) when is_binary(slug) do
  case SymphonyElixir.LocalTracker.Context.get_project(slug) do
    {:ok, project} ->
      project |> SymphonyElixir.Repo.preload(:setup) |> SymphonyElixir.ProjectConfig.resolve() |> Map.get(:agent_kind)

    {:error, _} ->
      Config.default_agent_kind()
  end
end

def issue_agent_kind(_issue), do: Config.default_agent_kind()
```

In `workspace.ex`, where `Config.workspace_root/0` and `Config.workspace_hooks/0` (after_create) are read for an issue, resolve them from the issue's `ProjectConfig` when `issue.project_slug` is present; otherwise keep the global values. (Wrap the existing reads in a `project_config_or_global(issue)` helper that returns `%ProjectConfig{}` or a global-equivalent map.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/agent_runner_test.exs test/symphony_elixir/workspace_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/agent_runner.ex elixir/lib/symphony_elixir/workspace.ex elixir/test/symphony_elixir/agent_runner_test.exs elixir/test/symphony_elixir/workspace_test.exs
git commit -m "feat(agent): resolve agent kind and workspace from the issue's project config"
```

---

## Phase 5 — `ProjectSetup` upsert + project modal

### Task 5.1: `Context.upsert_project_setup/2`

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex` (near 154-160, 446-454, 546-559)
- Test: `elixir/test/symphony_elixir/local_tracker/context_setup_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.LocalTracker.ContextSetupTest do
  use SymphonyElixir.DataCase, async: false
  alias SymphonyElixir.LocalTracker.Context

  test "upsert_project_setup creates then updates a project's setup" do
    {:ok, _project} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "github", tracker_config: %{"repo" => "o/r", "project_id" => "PVT_1"}})

    {:ok, setup} =
      Context.upsert_project_setup("alpha", %{
        workflow_config: %{"tracker" => %{"active_states" => ["Todo"]}},
        prompt_template: "P1",
        after_create_hook: "echo hi",
        validation_commands: ["npm test"]
      })

    assert setup.prompt_template == "P1"

    {:ok, updated} = Context.upsert_project_setup("alpha", %{prompt_template: "P2"})
    assert updated.prompt_template == "P2"
    assert updated.workflow_config == %{"tracker" => %{"active_states" => ["Todo"]}}
  end

  test "returns error for unknown project" do
    assert {:error, :project_not_found} = Context.upsert_project_setup("nope", %{})
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_setup_test.exs`
Expected: FAIL (`upsert_project_setup/2` undefined).

- [ ] **Step 3: Implement**

```elixir
@spec upsert_project_setup(String.t(), map()) ::
        {:ok, ProjectSetup.t()} | {:error, :project_not_found | Ecto.Changeset.t()}
def upsert_project_setup(project_slug, attrs) when is_binary(project_slug) and is_map(attrs) do
  with {:ok, project} <- fetch_project(project_slug) do
    existing = Repo.get_by(ProjectSetup, project_id: project.id) || %ProjectSetup{}

    existing
    |> ProjectSetup.changeset(setup_attrs(project, normalize_setup_attrs(attrs)))
    |> Repo.insert_or_update()
    |> case do
      {:ok, setup} ->
        Broadcaster.project_changed("project_updated", project)
        {:ok, setup}

      {:error, changeset} ->
        {:error, changeset}
    end
  end
end

defp normalize_setup_attrs(attrs) do
  attrs
  |> Map.new(fn {k, v} -> {to_string(k), v} end)
end
```

Reuse the existing `setup_attrs/2` (it already maps `workflow_config`, `after_create_hook`, `prompt_template`, `validation_commands`, `scan_summary` and wraps validation commands). `setup_attrs/2` reads via `attr/3`, which accepts string keys.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_setup_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/local_tracker/context_setup_test.exs
git commit -m "feat(context): add upsert_project_setup/2"
```

### Task 5.2: `PUT /projects/:id/setup` endpoint

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/router.ex:35-51`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/project_controller.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/project_setup_update_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
test "PUT /projects/:id/setup upserts setup and returns the project DTO", %{conn: conn} do
  {:ok, _p} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})

  conn =
    conn
    |> put_req_header("authorization", "Bearer #{token()}")
    |> put("/api/tracker/v1/projects/alpha/setup", %{
      "setup" => %{"prompt_template" => "Hello", "workflow_config" => %{"tracker" => %{"active_states" => ["Todo"]}}}
    })

  assert %{"data" => %{"setup" => %{"prompt_template" => "Hello"}}} = json_response(conn, 200)
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/project_setup_update_test.exs`
Expected: FAIL (route/action missing).

- [ ] **Step 3: Implement**

Router (add inside the tracker scope, before `resources("/projects", ...)`):

```elixir
put("/projects/:id/setup", ProjectController, :update_setup)
```

Controller action:

```elixir
@spec update_setup(Conn.t(), map()) :: Conn.t()
def update_setup(conn, %{"id" => slug, "setup" => setup}) when is_map(setup) do
  case Context.upsert_project_setup(slug, setup) do
    {:ok, _setup} ->
      {:ok, project} = Context.get_project(slug)
      statuses = Context.list_statuses(slug)
      repositories = Context.list_repositories(slug)
      setup_dto = Context.get_project_setup(slug)
      json(conn, %{data: TrackerPresenter.project(project, statuses, repositories, setup_dto)})

    {:error, :project_not_found} ->
      TrackerErrors.not_found(conn, "project not found")

    {:error, %Ecto.Changeset{} = changeset} ->
      TrackerErrors.render(conn, changeset)
  end
end

def update_setup(conn, _params), do: TrackerErrors.validation(conn, "setup is required")
```

(Confirm `TrackerErrors.not_found/2` exists; if the helper is named differently in `tracker_errors.ex`, use the existing one.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/project_setup_update_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/router.ex elixir/lib/symphony_elixir_web/controllers/tracker/project_controller.ex elixir/test/symphony_elixir_web/controllers/tracker/project_setup_update_test.exs
git commit -m "feat(api): add PUT /projects/:id/setup to upsert project workflow + prompt"
```

### Task 5.3: Frontend setup service + types

**Files:**
- Modify: `tracker/src/services/projects.ts:23-112`
- Modify: `tracker/src/types/project.ts` (add `setup` to `Project`, if not present) + `tracker/src/services/mappers.ts`
- Test: `tracker/src/services/__tests__/projects.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// projects.test.ts (add)
it("updateProjectSetup PUTs the setup payload", async () => {
  const put = vi.spyOn(http, "put").mockResolvedValue({ data: { data: backendProjectFixture } });
  await updateProjectSetup("alpha", { promptTemplate: "Hi", workflowConfig: { tracker: { active_states: ["Todo"] } } });
  expect(put).toHaveBeenCalledWith(
    trackerPath("/projects/alpha/setup"),
    { setup: { prompt_template: "Hi", workflow_config: { tracker: { active_states: ["Todo"] } } } },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npm run test:unit -- src/services/__tests__/projects.test.ts`
Expected: FAIL (`updateProjectSetup` undefined).

- [ ] **Step 3: Implement**

```ts
// projects.ts (add)
export interface UpdateProjectSetupInput {
  workflowConfig?: Record<string, unknown>;
  promptTemplate?: string | null;
  afterCreateHook?: string | null;
  validationCommands?: string[];
}

export async function updateProjectSetup(projectSlug: string, input: UpdateProjectSetupInput): Promise<Project> {
  const slug = requireProjectSlug(projectSlug);
  const setup = compactPayload({
    workflow_config: input.workflowConfig,
    prompt_template: input.promptTemplate,
    after_create_hook: input.afterCreateHook,
    validation_commands: input.validationCommands,
  });
  const response = await http.put(trackerPath(`/projects/${encodeURIComponent(slug)}/setup`), { setup });
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}
```

If `Project`/`normalizeProject` does not already include `setup` (`workflowConfig`, `promptTemplate`, `afterCreateHook`), add it in `types/project.ts` and `mappers.ts` mirroring the backend `project_setup` DTO (`workflow_config`, `prompt_template`, `after_create_hook`, `validation_commands`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npm run test:unit -- src/services/__tests__/projects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/services/projects.ts tracker/src/types/project.ts tracker/src/services/mappers.ts tracker/src/services/__tests__/projects.test.ts
git commit -m "feat(tracker): add updateProjectSetup service + project setup type"
```

### Task 5.4: Markdown editor component (Write/Preview)

**Files:**
- Create: `tracker/src/components/ui/markdown-editor.tsx`
- Test: `tracker/src/components/ui/__tests__/markdown-editor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// markdown-editor.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "@/components/ui/markdown-editor";

describe("MarkdownEditor", () => {
  it("edits in Write and renders in Preview", () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value="# Hello" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "# Hi" } });
    expect(onChange).toHaveBeenCalledWith("# Hi");
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npm run test:unit -- src/components/ui/__tests__/markdown-editor.test.tsx`
Expected: FAIL (component missing).

- [ ] **Step 3: Implement**

```tsx
// tracker/src/components/ui/markdown-editor.tsx
import { useState } from "react";

import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

export function MarkdownEditor({ value, onChange, placeholder, rows = 12 }: MarkdownEditorProps) {
  const [tab, setTab] = useState<"write" | "preview">("write");

  return (
    <div className="rounded-md border">
      <div className="flex gap-1 border-b bg-muted/30 p-1">
        <TabButton active={tab === "write"} onClick={() => setTab("write")}>
          Write
        </TabButton>
        <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
          Preview
        </TabButton>
      </div>
      {tab === "write" ? (
        <Textarea
          className="rounded-none border-0 focus-visible:ring-0"
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <div className="min-h-[8rem] p-3">
          {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-muted-foreground">Nothing to preview.</p>}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded px-3 py-1 text-sm", active ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npm run test:unit -- src/components/ui/__tests__/markdown-editor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/ui/markdown-editor.tsx tracker/src/components/ui/__tests__/markdown-editor.test.tsx
git commit -m "feat(tracker): add Write/Preview markdown editor"
```

### Task 5.5: Load-default menu (from templates)

**Files:**
- Create: `tracker/src/components/projects/LoadDefaultMenu.tsx`
- Test: `tracker/src/components/projects/__tests__/LoadDefaultMenu.test.tsx`

Uses the existing templates service. Confirm the function names in `tracker/src/services/templates.ts` (`listTemplates`, `getTemplate`); the menu lists templates and calls `onLoad({ promptTemplate, afterCreateHook, validationCommands })` from the selected template.

- [ ] **Step 1: Write the failing test**

```tsx
// LoadDefaultMenu.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoadDefaultMenu } from "@/components/projects/LoadDefaultMenu";
import * as templates from "@/services/templates";

describe("LoadDefaultMenu", () => {
  it("loads the selected template into the form", async () => {
    vi.spyOn(templates, "listTemplates").mockResolvedValue([
      { slug: "macro-markets", name: "Macro Markets", promptTemplate: "PROMPT", afterCreateHook: "HOOK", validationCommands: ["npm test"], repositories: [], description: null },
    ] as never);
    const onLoad = vi.fn();
    render(<LoadDefaultMenu onLoad={onLoad} />);
    fireEvent.click(await screen.findByRole("button", { name: /load default/i }));
    fireEvent.click(await screen.findByText("Macro Markets"));
    await waitFor(() => expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({ promptTemplate: "PROMPT" })));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npm run test:unit -- src/components/projects/__tests__/LoadDefaultMenu.test.tsx`
Expected: FAIL (component missing).

- [ ] **Step 3: Implement**

```tsx
// tracker/src/components/projects/LoadDefaultMenu.tsx
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { listTemplates } from "@/services/templates";
import type { WorkspaceTemplate } from "@/types/template";

export interface LoadedDefault {
  promptTemplate: string;
  afterCreateHook: string | null;
  validationCommands: string[];
}

export function LoadDefaultMenu({ onLoad }: { onLoad: (value: LoadedDefault) => void }) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);

  useEffect(() => {
    if (!open) return;
    listTemplates()
      .then(setTemplates)
      .catch((cause) => toast.error(cause instanceof Error ? cause.message : "Failed to load templates"));
  }, [open]);

  return (
    <div className="relative">
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
        <Download className="h-4 w-4" />
        Load default
      </Button>
      {open ? (
        <div className="absolute z-10 mt-1 w-56 rounded-md border bg-popover p-1 shadow-md">
          {templates.length === 0 ? (
            <p className="px-2 py-1 text-sm text-muted-foreground">No templates.</p>
          ) : (
            templates.map((template) => (
              <button
                key={template.slug}
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onLoad({
                    promptTemplate: template.promptTemplate ?? "",
                    afterCreateHook: template.afterCreateHook ?? null,
                    validationCommands: template.validationCommands ?? [],
                  });
                  setOpen(false);
                }}
              >
                {template.name}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npm run test:unit -- src/components/projects/__tests__/LoadDefaultMenu.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/projects/LoadDefaultMenu.tsx tracker/src/components/projects/__tests__/LoadDefaultMenu.test.tsx
git commit -m "feat(tracker): add load-default menu sourced from workspace templates"
```

### Task 5.6: Wire editor + load-default + workflow_config into `EditProjectDialog`

**Files:**
- Modify: `tracker/src/components/projects/EditProjectDialog.tsx:24-145`
- Test: `tracker/src/components/projects/__tests__/EditProjectDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("saves prompt + workflow_config via updateProjectSetup on save", async () => {
  const updateSetup = vi.spyOn(projects, "updateProjectSetup").mockResolvedValue(projectFixture);
  vi.spyOn(projects, "updateProject").mockResolvedValue(projectFixture);
  render(<EditProjectDialog project={localProjectFixture} open onOpenChange={() => {}} onSaved={() => {}} />);
  fireEvent.change(screen.getByRole("textbox", { name: /prompt/i }), { target: { value: "New prompt" } });
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
  await waitFor(() => expect(updateSetup).toHaveBeenCalledWith("alpha", expect.objectContaining({ promptTemplate: "New prompt" })));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npm run test:unit -- src/components/projects/__tests__/EditProjectDialog.test.tsx`
Expected: FAIL (no prompt field / no setup save).

- [ ] **Step 3: Implement**

In `EditProjectDialog.tsx`:
- Add state `promptTemplate`, `workflowConfig` initialized from `project.setup` (default `""` / `{}`), reset in the existing `useEffect`.
- Add a labeled section with `<MarkdownEditor value={promptTemplate} onChange={setPromptTemplate} />` (the textbox label "Prompt") and `<LoadDefaultMenu onLoad={(d) => { setPromptTemplate(d.promptTemplate); }} />`.
- In `handleSubmit`, after the existing `updateProject(...)` call, also call `updateProjectSetup(project.slug, { promptTemplate, workflowConfig })` and use its returned project for `onSaved`. Run both sequentially; surface errors via `toast.error`.

```tsx
// imports
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { LoadDefaultMenu } from "@/components/projects/LoadDefaultMenu";
import { updateProject, updateProjectSetup } from "@/services/projects";

// state
const [promptTemplate, setPromptTemplate] = useState(project.setup?.promptTemplate ?? "");

// inside useEffect reset block
setPromptTemplate(project.setup?.promptTemplate ?? "");

// JSX (before the action buttons)
<div className="space-y-2">
  <div className="flex items-center justify-between">
    <label className="text-sm font-medium" htmlFor="edit-project-prompt">Prompt</label>
    <LoadDefaultMenu onLoad={(d) => setPromptTemplate(d.promptTemplate)} />
  </div>
  <MarkdownEditor value={promptTemplate} onChange={setPromptTemplate} placeholder="Per-project agent prompt (markdown)" />
</div>

// in handleSubmit, after updateProject(...)
const saved = await updateProjectSetup(project.slug, { promptTemplate });
onSaved(saved);
```

(Apply the same prompt field to `ProjectCreateDialog` only if creating non-workspace projects should set a prompt; otherwise leave creation to the existing workspace wizard. MVP: edit dialog only.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npm run test:unit -- src/components/projects/__tests__/EditProjectDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/projects/EditProjectDialog.tsx tracker/src/components/projects/__tests__/EditProjectDialog.test.tsx
git commit -m "feat(tracker): edit per-project prompt + workflow with markdown editor and load default"
```

---

## Phase 6 — Multi-project observability

### Task 6.1: Project-scoped orchestrator snapshot

**Files:**
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex:956-1005` (snapshot tracks project per running issue)
- Modify: `elixir/lib/symphony_elixir_web/presenter.ex:8-32`
- Test: `elixir/test/symphony_elixir_web/presenter_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
test "state_payload/3 scopes running/retrying to the given project_slug" do
  # build a fake orchestrator snapshot with running entries carrying project_slug "a" and "b"
  payload = SymphonyElixirWeb.Presenter.state_payload(fake_orchestrator, 1000, "a")
  assert Enum.all?(payload.running, &(&1.project_slug == "a"))
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/presenter_test.exs`
Expected: FAIL (`state_payload/3` undefined; running entries lack `project_slug`).

- [ ] **Step 3: Implement**

- The orchestrator already tracks per-issue metadata in `state.running`. Ensure the dispatch path stores `project_slug` in the running metadata (it has the `%Issue{}` at dispatch — add `project_slug: issue.project_slug` to the metadata map). Then in `handle_call(:snapshot, ...)` include `project_slug` in each running/retrying entry.
- Add `state_payload/3` overload that filters by project:

```elixir
@spec state_payload(GenServer.name(), timeout(), String.t() | nil) :: map()
def state_payload(orchestrator, snapshot_timeout_ms, nil),
  do: state_payload(orchestrator, snapshot_timeout_ms)

def state_payload(orchestrator, snapshot_timeout_ms, project_slug) when is_binary(project_slug) do
  base = state_payload(orchestrator, snapshot_timeout_ms)

  case base do
    %{running: running, retrying: retrying} ->
      filtered_running = Enum.filter(running, &(&1.project_slug == project_slug))
      filtered_retrying = Enum.filter(retrying, &(&1.project_slug == project_slug))

      %{
        base
        | running: filtered_running,
          retrying: filtered_retrying,
          counts: %{running: length(filtered_running), retrying: length(filtered_retrying)}
      }

    other ->
      other
  end
end
```

Update `running_entry_payload/1` and `retry_entry_payload/1` to include `project_slug`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir_web/presenter_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/orchestrator.ex elixir/lib/symphony_elixir_web/presenter.ex elixir/test/symphony_elixir_web/presenter_test.exs
git commit -m "feat(observability): project-scoped orchestrator snapshot"
```

### Task 6.2: Reporter emits one report per project

**Files:**
- Modify: `elixir/lib/symphony_elixir/observability/reporter.ex:60-101,131-146`
- Test: `elixir/test/symphony_elixir/observability/reporter_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
test "do_report delivers one report per non-archived project with composite runtime_id" do
  # seed projects "a" and "b"
  delivered = :ets.new(:delivered, [:bag, :public])
  deliver = fn report -> :ets.insert(delivered, {report["runtime_id"], report}); :ok end

  state = %{
    deliver_fun: deliver,
    snapshot_fun: fn _slug -> %{counts: %{running: 0, retrying: 0}, running: [], retrying: []} end,
    identity_fun: &Reporter.project_identities/0,
    # ...other state keys...
  }

  Reporter.do_report(state)

  ids = :ets.tab2list(delivered) |> Enum.map(&elem(&1, 0)) |> Enum.sort()
  assert Enum.any?(ids, &String.ends_with?(&1, ":a"))
  assert Enum.any?(ids, &String.ends_with?(&1, ":b"))
end
```

(Adjust to the test seams that exist; the essential behavior: one delivered report per project, `runtime_id` ends with `:<slug>`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/observability/reporter_test.exs`
Expected: FAIL (single report; no per-project identities).

- [ ] **Step 3: Implement**

Change `do_report/1` to iterate projects. Replace the single identity+snapshot build with a per-project loop. Introduce a `snapshot_fun` that takes a `project_slug` and an `identities_fun` that returns a list of `{identity_map}`:

```elixir
defp do_report(state) do
  reports =
    project_identities()
    |> Enum.map(fn identity ->
      Map.put(identity, "snapshot", state.snapshot_fun.(identity["project_slug"]))
    end)

  consecutive_failures =
    Enum.reduce(reports, state.consecutive_failures, fn report, acc ->
      case safe_deliver(state.deliver_fun, report) do
        :ok -> handle_delivery_success(acc)
        {:error, reason} -> handle_delivery_failure(acc, reason)
        other -> handle_delivery_failure(acc, {:unexpected, other})
      end
    end)

  %{state | last_report_ms: System.monotonic_time(:millisecond), pending?: false, consecutive_failures: consecutive_failures}
end

@spec project_identities() :: [map()]
def project_identities do
  base_runtime = Config.observability_runtime_id()

  case SymphonyElixir.LocalTracker.Context.list_projects() do
    [] -> [global_identity(base_runtime)]
    projects -> Enum.map(projects, &project_identity(&1, base_runtime))
  end
end

defp project_identity(project, base_runtime) do
  %{
    "runtime_id" => "#{base_runtime}:#{project.slug}",
    "label" => project.name,
    "project_slug" => project.slug,
    "tracker_kind" => project.tracker_kind,
    "agent_kind" => Config.agent_kind(),
    "source_url" => source_url()
  }
end

defp global_identity(base_runtime) do
  %{
    "runtime_id" => base_runtime,
    "label" => Config.observability_label() || Path.basename(SymphonyElixir.Workflow.workflow_file_path()),
    "project_slug" => Config.local_project_slug(),
    "tracker_kind" => Config.tracker_kind(),
    "agent_kind" => Config.agent_kind(),
    "source_url" => source_url()
  }
end
```

Update `init/1` to default `snapshot_fun` to `&default_snapshot/1`:

```elixir
defp default_snapshot(project_slug) do
  Presenter.state_payload(SymphonyElixir.Orchestrator, @snapshot_timeout_ms, project_slug)
end
```

(Set `snapshot_fun` default in `init/1` to `&default_snapshot/1`; drop the old `default_identity/0`/`default_snapshot/0`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/observability/reporter_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/observability/reporter.ex elixir/test/symphony_elixir/observability/reporter_test.exs
git commit -m "feat(observability): report one runtime entry per project"
```

---

## Phase 7 — Boot backfill + auto-discovery

### Task 7.1: Backfill/discovery mix task

**Files:**
- Create: `elixir/lib/mix/tasks/symphony.workflows.backfill.ex`
- Create: `elixir/test/mix/tasks/symphony_workflows_backfill_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule Mix.Tasks.Symphony.Workflows.BackfillTest do
  use SymphonyElixir.DataCase, async: false
  alias SymphonyElixir.LocalTracker.Context

  @tmp Path.expand("../../../tmp/workflows_backfill_test", __DIR__)

  setup do
    File.rm_rf!(@tmp)
    File.mkdir_p!(@tmp)
    File.write!(Path.join(@tmp, "WORKFLOW.alpha.md"), """
    ---
    tracker:
      active_states:
        - Todo
    ---
    Alpha prompt body.
    """)
    on_exit(fn -> File.rm_rf!(@tmp) end)
    :ok
  end

  test "creates a missing project and imports its workflow into setup" do
    Mix.Tasks.Symphony.Workflows.Backfill.run(["--dir", @tmp])

    assert {:ok, project} = Context.get_project("alpha")
    setup = Context.get_project_setup("alpha")
    assert setup.prompt_template =~ "Alpha prompt body."
    assert get_in(setup.workflow_config, ["tracker", "active_states"]) == ["Todo"]
  end

  test "does not overwrite an existing project's DB-owned setup" do
    {:ok, _} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})
    {:ok, _} = Context.upsert_project_setup("alpha", %{prompt_template: "KEEP"})

    Mix.Tasks.Symphony.Workflows.Backfill.run(["--dir", @tmp])

    assert Context.get_project_setup("alpha").prompt_template == "KEEP"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/mix/tasks/symphony_workflows_backfill_test.exs`
Expected: FAIL (task missing).

- [ ] **Step 3: Implement**

```elixir
# elixir/lib/mix/tasks/symphony.workflows.backfill.ex
defmodule Mix.Tasks.Symphony.Workflows.Backfill do
  @shortdoc "Import WORKFLOW.<slug>.md files into per-project setups (idempotent)."
  @moduledoc """
  Scans a directory for `WORKFLOW.<slug>.md` files. For each, creates the project
  if missing and imports the workflow front matter + prompt body into the project's
  setup — but never overwrites a project that already has DB-owned setup config.
  """
  use Mix.Task

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Workflow

  @impl true
  def run(args) do
    {opts, _, _} = OptionParser.parse(args, switches: [dir: :string])
    Mix.Task.run("app.start")
    dir = Keyword.get(opts, :dir, File.cwd!())

    dir
    |> workflow_files()
    |> Enum.each(&import_file/1)
  end

  defp workflow_files(dir) do
    dir
    |> Path.join("WORKFLOW.*.md")
    |> Path.wildcard()
    |> Enum.reject(&String.contains?(Path.basename(&1), ".example."))
  end

  defp import_file(path) do
    slug = path |> Path.basename() |> slug_from_filename()

    with true <- is_binary(slug),
         {:ok, %{config: config, prompt_template: prompt}} <- Workflow.load(path) do
      maybe_create_project(slug, config)

      if needs_setup?(slug) do
        {:ok, _} = Context.upsert_project_setup(slug, %{workflow_config: config, prompt_template: prompt})
        Mix.shell().info("multi_orchestrator: imported project=#{slug}")
      else
        Mix.shell().info("multi_orchestrator: skipped (db-owned) project=#{slug}")
      end
    else
      _ -> Mix.shell().info("multi_orchestrator: skipped (unreadable) path=#{path}")
    end
  end

  defp slug_from_filename(filename) do
    case Regex.run(~r/^WORKFLOW\.(.+)\.md$/, filename) do
      [_, slug] -> slug
      _ -> nil
    end
  end

  defp maybe_create_project(slug, config) do
    case Context.get_project(slug) do
      {:ok, _project} -> :ok
      {:error, :project_not_found} -> Context.ensure_project(project_attrs(slug, config))
    end
  end

  defp project_attrs(slug, config) do
    base = %{name: slug, slug: slug}

    case config do
      %{"github" => %{} = gh} ->
        Map.merge(base, %{tracker_kind: "github", tracker_config: take_github(gh)})

      _ ->
        Map.put(base, :tracker_kind, "local")
    end
  end

  defp take_github(gh) do
    project = Map.get(gh, "project", %{})
    %{"repo" => Map.get(gh, "repo"), "project_id" => Map.get(project, "id")}
  end

  defp needs_setup?(slug) do
    case Context.get_project_setup(slug) do
      nil -> true
      setup -> map_size(setup.workflow_config || %{}) == 0 and is_nil(setup.prompt_template)
    end
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/mix/tasks/symphony_workflows_backfill_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/mix/tasks/symphony.workflows.backfill.ex elixir/test/mix/tasks/symphony_workflows_backfill_test.exs
git commit -m "feat: add symphony.workflows.backfill mix task (import + discover, never overwrite)"
```

### Task 7.2: Run backfill for the live DB + docs

**Files:**
- Modify: `elixir/README.md` (multi-orchestrator section), `elixir/WORKFLOW.md` notes if config contract changed.

- [ ] **Step 1: Run the backfill against the dev DB**

Run: `cd elixir && mix symphony.workflows.backfill --dir .`
Expected output: `multi_orchestrator: imported project=macro-markets` (and any other `WORKFLOW.<slug>.md`).

- [ ] **Step 2: Verify in the DB**

Run: `cd elixir && mix run -e 'IO.inspect(SymphonyElixir.LocalTracker.Context.get_project_setup("macro-markets") |> Map.take([:prompt_template]))'`
Expected: a non-nil `prompt_template`.

- [ ] **Step 3: Document**

Add a "Multi-orchestrator projects" subsection to `elixir/README.md` describing: DB is the source of truth for per-project config/prompt; `mix symphony.workflows.backfill` imports `WORKFLOW.*.md` once; new projects are created/edited in the tracker UI (prompt markdown editor + load default).

- [ ] **Step 4: Commit**

```bash
git add elixir/README.md
git commit -m "docs: document multi-orchestrator projects + backfill task"
```

---

## Final Validation

- [ ] `cd elixir && make all` — format check, credo, coverage, dialyzer all green.
- [ ] `cd elixir && mix specs.check` — all new public `def`s have `@spec`.
- [ ] `cd tracker && npm run lint && npm run test:unit` — green.
- [ ] Manual smoke: `make serve WORKFLOW=./WORKFLOW.macro-markets.md`, confirm the observability page shows one card per non-archived project and that editing a project's prompt in the modal persists and is used on the next dispatch.

---

## Self-Review Checklist (run after writing; see writing-plans skill)

1. **Spec coverage:** data model (Phase 1/5), per-project config (Phase 1), orchestrator multi-project (Phase 3/4), observability (Phase 6), modal (Phase 5), boot/backfill/discovery (Phase 7). ✅
2. **Type consistency:** `%ProjectConfig{}` fields (`active_states`, `prompt_template`, `agent_kind`, ...) used identically in Phases 3/4/6; `updateProjectSetup` payload (`promptTemplate`/`workflowConfig`) consistent across service + dialog. ✅
3. **No placeholders:** every code step shows real code; commands have expected outcomes. ✅
```
