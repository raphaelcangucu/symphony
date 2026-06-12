# Per-Project Jira Board Filter (field / JQL) Implementation Plan

**Goal:** Let a Jira-backed Symphony project scope its synced board with a declarative per-project filter (a `fields` equality map plus a raw `jql` escape hatch), with bounded pagination, so the `advising` project can mirror `project = CDE AND "Product" = "Inspire"`.

**Architecture:** Add a pure JQL builder (`Jira.IssueAdapter.Filter`) that turns a project's `tracker_config` into a search JQL string. Wire it into the single chokepoint `Jira.IssueAdapter.list_issues/2` (used by both cold-start seed and background pull) and replace the single 100-row request with a `nextPageToken` loop capped at `max_results`. Add `project_key` validation for Jira projects. Visibility (board JQL) stays decoupled from execution (the orchestrator's existing `require_assignee_match` + `require_symphony_label` gates), so a Product=Inspire board can include colleagues' issues while only the user's assigned, labeled issues auto-dispatch.

**Tech Stack:** Elixir/Phoenix, `Req` HTTP client, ExUnit. No new dependencies. Tests use the existing inline-stub pattern (`Application.put_env(:symphony_elixir, :jira_client_module, Stub)`), no Mox/Bypass.

**Spec:** `docs/superpowers/specs/2026-06-11-jira-per-project-board-filter-design.md`

---

## Conventions for every task

- Backend tests: `cd elixir && mix test <path>`. Full gate before handoff:
  `cd elixir && make all` (format, lint, coverage, dialyzer) and
  `cd elixir && mix specs.check` (every `def` in `lib/` needs an adjacent
  `@spec`; `@impl` callbacks are exempt).
- Commit after each task. Work on the current branch (no worktree) unless told otherwise.
- Follow existing module/style patterns in `lib/symphony_elixir/jira/*`.

---

## File Structure

**Backend — new**
- `elixir/lib/symphony_elixir/jira/issue_adapter/filter.ex` — `Jira.IssueAdapter.Filter`:
  pure `build_jql/1` turning a `Project`'s `tracker_config` into the search JQL.
- `elixir/test/symphony_elixir/jira/issue_adapter_filter_test.exs` — builder unit tests.

**Backend — modified**
- `elixir/lib/symphony_elixir/jira/issue_adapter.ex` — `list_issues/2` uses
  `Filter.build_jql/1` and paginates via `nextPageToken` up to `max_results`.
- `elixir/test/symphony_elixir/jira/issue_adapter_test.exs` — add filter + pagination cases.
- `elixir/lib/symphony_elixir/local_tracker/project.ex` — validate `project_key` for `jira`.
- `elixir/test/symphony_elixir/local_tracker/project_test.exs` — add jira validation cases.

**Docs — modified**
- `elixir/WORKFLOW.jira.example.md` — document `fields` / `jql` / `order_by` / `max_results`.

**Ops — new (final task)**
- `advising-project.yaml` — portable project bundle for the `advising` project.

---

## Task 1: `Jira.IssueAdapter.Filter` JQL builder

**Files:**
- Create: `elixir/lib/symphony_elixir/jira/issue_adapter/filter.ex`
- Test: `elixir/test/symphony_elixir/jira/issue_adapter_filter_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Jira.IssueAdapter.FilterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Jira.IssueAdapter.Filter
  alias SymphonyElixir.LocalTracker.Project

  defp project(config), do: %Project{tracker_kind: "jira", tracker_config: config}

  test "bare project_key keeps today's behavior" do
    assert Filter.build_jql(project(%{"project_key" => "CDE"})) ==
             ~s|project = "CDE" ORDER BY created DESC|
  end

  test "a single fields entry adds an equality clause" do
    assert Filter.build_jql(project(%{"project_key" => "CDE", "fields" => %{"Product" => "Inspire"}})) ==
             ~s|project = "CDE" AND "Product" = "Inspire" ORDER BY created DESC|
  end

  test "multiple fields entries are AND-joined, ordered by key" do
    jql =
      Filter.build_jql(
        project(%{"project_key" => "CDE", "fields" => %{"Product" => "Inspire", "Institution" => "westhillscollege"}})
      )

    assert jql ==
             ~s|project = "CDE" AND "Institution" = "westhillscollege" AND "Product" = "Inspire" ORDER BY created DESC|
  end

  test "a raw jql fragment is parenthesized and ANDed after fields" do
    jql =
      Filter.build_jql(
        project(%{"project_key" => "CDE", "fields" => %{"Product" => "Inspire"}, "jql" => "updated >= -30d"})
      )

    assert jql ==
             ~s|project = "CDE" AND "Product" = "Inspire" AND (updated >= -30d) ORDER BY created DESC|
  end

  test "jql only (no fields)" do
    assert Filter.build_jql(project(%{"project_key" => "CDE", "jql" => ~s|cf[10050] = "Inspire"|})) ==
             ~s|project = "CDE" AND (cf[10050] = "Inspire") ORDER BY created DESC|
  end

  test "blank/whitespace fields and jql are ignored" do
    assert Filter.build_jql(
             project(%{"project_key" => "CDE", "fields" => %{"  " => "x", "Product" => "  "}, "jql" => "   "})
           ) == ~s|project = "CDE" ORDER BY created DESC|
  end

  test "values and names with embedded quotes are escaped" do
    assert Filter.build_jql(project(%{"project_key" => "CDE", "fields" => %{"Product" => ~s|In"spire|}})) ==
             ~s|project = "CDE" AND "Product" = "In\\"spire" ORDER BY created DESC|
  end

  test "custom order_by overrides the default" do
    assert Filter.build_jql(project(%{"project_key" => "CDE", "order_by" => "Rank ASC"})) ==
             ~s|project = "CDE" ORDER BY Rank ASC|
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/jira/issue_adapter_filter_test.exs`
Expected: FAIL with `Filter.build_jql/1` undefined (`UndefinedFunctionError` / module not available).

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.Jira.IssueAdapter.Filter do
  @moduledoc """
  Builds the per-project board search JQL for `Jira.IssueAdapter` from a
  project's `tracker_config`:

    * `project_key` (required) — always scoped as `project = "KEY"`.
    * `fields` (map) — `%{"Product" => "Inspire"}` → `"Product" = "Inspire"`
      equality clauses, AND-joined (ordered by field name for determinism).
    * `jql` (string) — optional raw fragment, parenthesized and ANDed after fields.
    * `order_by` (string) — optional, defaults to `created DESC`.

  Blank field names/values and a blank `jql` are dropped. With no `fields` and no
  `jql` the result is `project = "KEY" ORDER BY created DESC` (legacy behavior).
  """

  alias SymphonyElixir.LocalTracker.Project

  @default_order_by "created DESC"

  @spec build_jql(Project.t()) :: String.t()
  def build_jql(%Project{tracker_config: config}) when is_map(config) do
    project_key = Map.fetch!(config, "project_key")

    clauses =
      [project_clause(project_key)]
      |> Kernel.++(field_clauses(Map.get(config, "fields")))
      |> Kernel.++([raw_clause(Map.get(config, "jql"))])
      |> Enum.reject(&is_nil/1)

    Enum.join(clauses, " AND ") <> " ORDER BY " <> order_by(Map.get(config, "order_by"))
  end

  defp project_clause(project_key), do: "project = " <> quote_jql(project_key)

  defp field_clauses(fields) when is_map(fields) do
    fields
    |> Enum.map(fn {name, value} -> {present(name), present(value)} end)
    |> Enum.reject(fn {name, value} -> is_nil(name) or is_nil(value) end)
    |> Enum.sort_by(fn {name, _value} -> name end)
    |> Enum.map(fn {name, value} -> quote_jql(name) <> " = " <> quote_jql(value) end)
  end

  defp field_clauses(_fields), do: []

  defp raw_clause(jql) do
    case present(jql) do
      nil -> nil
      fragment -> "(" <> fragment <> ")"
    end
  end

  defp order_by(value), do: present(value) || @default_order_by

  defp quote_jql(value) do
    "\"" <> (value |> to_string() |> String.replace("\"", "\\\"")) <> "\""
  end

  defp present(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp present(value) when is_integer(value) or is_float(value), do: to_string(value)
  defp present(_value), do: nil
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/jira/issue_adapter_filter_test.exs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/jira/issue_adapter/filter.ex elixir/test/symphony_elixir/jira/issue_adapter_filter_test.exs
git commit -m "feat(jira): add per-project board JQL filter builder"
```

---

## Task 2: Wire the filter + pagination into `list_issues/2`

**Files:**
- Modify: `elixir/lib/symphony_elixir/jira/issue_adapter.ex` (`list_issues/2` + helpers)
- Test: `elixir/test/symphony_elixir/jira/issue_adapter_test.exs`

- [ ] **Step 1: Write the failing tests** — append these inside the existing
`SymphonyElixir.Jira.IssueAdapterTest` module (after the existing
`"list_issues searches with a project JQL clause and normalizes"` test). They use
the existing `@project`, `issue_body/1`, `Stub`, and `put_client/1` helpers.

```elixir
  test "list_issues applies the configured fields filter to the JQL" do
    project = %Project{
      id: 2,
      slug: "advising",
      tracker_kind: "jira",
      tracker_config: %{"project_key" => "CDE", "fields" => %{"Product" => "Inspire"}}
    }

    Stub.set(fn :post, "/rest/api/3/search/jql", body ->
      assert body["jql"] == ~s|project = "CDE" AND "Product" = "Inspire" ORDER BY created DESC|
      {:ok, %{"issues" => [issue_body("CDE-1")], "isLast" => true}}
    end)

    assert {:ok, [%IssueDTO{identifier: "CDE-1"}]} = IssueAdapter.list_issues(project, [])
  end

  test "list_issues follows nextPageToken across pages, in order" do
    parent = self()

    Stub.set(fn :post, "/rest/api/3/search/jql", body ->
      case body["nextPageToken"] do
        nil ->
          send(parent, :page_1)
          {:ok, %{"issues" => [issue_body("ABC-1")], "nextPageToken" => "tok-2", "isLast" => false}}

        "tok-2" ->
          send(parent, :page_2)
          {:ok, %{"issues" => [issue_body("ABC-2")], "isLast" => true}}
      end
    end)

    assert {:ok, [%IssueDTO{identifier: "ABC-1"}, %IssueDTO{identifier: "ABC-2"}]} =
             IssueAdapter.list_issues(@project, [])

    assert_received :page_1
    assert_received :page_2
  end

  test "list_issues stops at max_results and does not page further" do
    project = %Project{
      id: 3,
      slug: "capped",
      tracker_kind: "jira",
      tracker_config: %{"project_key" => "ABC", "max_results" => 1}
    }

    Stub.set(fn :post, "/rest/api/3/search/jql", body ->
      # The cap is hit on page 1, so a second page must never be requested.
      assert body["nextPageToken"] == nil
      {:ok, %{"issues" => [issue_body("ABC-1"), issue_body("ABC-2")], "nextPageToken" => "tok-2", "isLast" => false}}
    end)

    assert {:ok, [%IssueDTO{identifier: "ABC-1"}]} = IssueAdapter.list_issues(project, [])
  end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd elixir && mix test test/symphony_elixir/jira/issue_adapter_test.exs`
Expected: the three new tests FAIL (old `list_issues` ignores `fields`, sends `maxResults` without paging, and doesn't honor `max_results`). The existing `list_issues` / error-mapping tests still pass.

- [ ] **Step 3: Write the implementation** — in `elixir/lib/symphony_elixir/jira/issue_adapter.ex`:

Add `require Logger` and the `Filter` alias near the top:

```elixir
  require Logger

  alias SymphonyElixir.Jira.{Adf, Client, Config, Priority}
  alias SymphonyElixir.Jira.IssueAdapter.{Filter, Query}
```

Add module attributes next to `@search_path`:

```elixir
  @search_path "/rest/api/3/search/jql"
  @page_size 100
  @default_max_results 500
```

Replace the whole `list_issues/2` clause:

```elixir
  @impl true
  def list_issues(%Project{} = project, _filters) do
    search_all(project, Filter.build_jql(project), max_results(project), nil, [])
  end
```

Add these private helpers (place them near `ctx/1`):

```elixir
  defp search_all(project, jql, cap, token, acc) do
    case request(:post, @search_path, search_body(jql, token)) do
      {:ok, %{"issues" => issues} = response} when is_list(issues) ->
        acc = acc ++ Enum.map(issues, &Query.normalize_issue(&1, ctx(project)))

        cond do
          length(acc) >= cap -> {:ok, truncate(project, acc, cap)}
          last_page?(response) -> {:ok, acc}
          true -> search_all(project, jql, cap, response["nextPageToken"], acc)
        end

      {:ok, _response} ->
        {:ok, acc}

      error ->
        {:error, map_error(error)}
    end
  end

  defp search_body(jql, nil) do
    %{"jql" => jql, "fields" => Query.issue_fields(), "maxResults" => @page_size}
  end

  defp search_body(jql, token) do
    jql |> search_body(nil) |> Map.put("nextPageToken", token)
  end

  defp last_page?(%{"isLast" => true}), do: true
  defp last_page?(%{"nextPageToken" => token}) when is_binary(token) and token != "", do: false
  defp last_page?(_response), do: true

  defp truncate(project, issues, cap) do
    Logger.warning("jira board pull truncated project=#{project.slug} cap=#{cap}")
    Enum.take(issues, cap)
  end

  defp max_results(%Project{tracker_config: config}) do
    case Map.get(config, "max_results") do
      value when is_integer(value) and value > 0 -> value
      _ -> @default_max_results
    end
  end
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/jira/issue_adapter_test.exs`
Expected: PASS (all, including the three new cases and the unchanged ones).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/jira/issue_adapter.ex elixir/test/symphony_elixir/jira/issue_adapter_test.exs
git commit -m "feat(jira): build board JQL from tracker_config filter with paging"
```

---

## Task 3: Validate `project_key` for Jira projects

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/project.ex` (`validate_tracker_config/1`)
- Test: `elixir/test/symphony_elixir/local_tracker/project_test.exs`

- [ ] **Step 1: Write the failing tests** — add inside the existing
`describe "changeset/2 tracker_kind"` block:

```elixir
    test "accepts jira with a project_key" do
      changeset =
        Project.changeset(%Project{}, %{
          name: "Advising",
          slug: "advising",
          tracker_kind: "jira",
          tracker_config: %{"project_key" => "CDE"}
        })

      assert changeset.valid?
    end

    test "rejects jira without a project_key" do
      changeset =
        Project.changeset(%Project{}, %{
          name: "Advising",
          slug: "advising",
          tracker_kind: "jira",
          tracker_config: %{}
        })

      refute changeset.valid?
      assert %{tracker_config: _} = errors_on(changeset)
    end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/project_test.exs`
Expected: `"rejects jira without a project_key"` FAILS (today the jira branch is unvalidated, so the changeset is valid).

- [ ] **Step 3: Write the implementation** — in `validate_tracker_config/1`, add a `jira` clause:

```elixir
  defp validate_tracker_config(changeset) do
    case get_field(changeset, :tracker_kind) do
      "github" -> validate_config_keys(changeset, ["repo", "project_id"])
      "linear" -> validate_config_keys(changeset, ["project_id"])
      "jira" -> validate_config_keys(changeset, ["project_key"])
      _ -> changeset
    end
  end
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/project_test.exs`
Expected: PASS (all). Also run the import/export controller test to confirm no regression:
`cd elixir && mix test test/symphony_elixir_web/controllers/tracker/project_import_export_test.exs`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/project.ex elixir/test/symphony_elixir/local_tracker/project_test.exs
git commit -m "feat(jira): validate project_key on jira tracker projects"
```

---

## Task 4: Document the new `tracker_config` filter keys

**Files:**
- Modify: `elixir/WORKFLOW.jira.example.md`

- [ ] **Step 1: Update the per-project `tracker_config` comment block.** Replace
the existing comment that lists only `project_key` / `issue_type`:

```markdown
#
# Per-project tracker_config keys consumed by the UI adapter:
#   project_key  (required) — JIRA project key the board reads/writes
#   issue_type   (optional) — issue type used on create (defaults to "Task")
```

with:

```markdown
#
# Per-project tracker_config keys consumed by the UI adapter:
#   project_key  (required) — JIRA project key the board reads/writes
#   issue_type   (optional) — issue type used on create (defaults to "Task")
#   fields       (optional) — map of field => value equality clauses ANDed into
#                             the board JQL, e.g. {Product: Inspire} ->
#                             project = "KEY" AND "Product" = "Inspire".
#                             Custom field names work when unique in the site;
#                             otherwise use the `jql` key with cf[<id>].
#   jql          (optional) — raw JQL fragment ANDed after `fields`, for
#                             cf[<id>] references, OR-groups, date ranges, etc.
#   order_by     (optional) — JQL ORDER BY clause (default "created DESC").
#   max_results  (optional) — cap on issues pulled per sync (default 500).
#
# Board visibility (the JQL above) is independent of execution: the orchestrator
# only auto-dispatches issues assigned to the connected Jira account
# (require_assignee_match) and carrying a symphony:* label (require_symphony_label),
# so a broad board filter still keeps colleagues' issues view-only.
```

- [ ] **Step 2: Verify the example still parses.** The file's front-matter is
plain YAML in a comment-augmented block; confirm the doc reads cleanly:

Run: `cd elixir && sed -n '1,45p' WORKFLOW.jira.example.md`
Expected: the `tracker_config` comment block now lists `fields`, `jql`,
`order_by`, `max_results`, and the visibility/execution note.

- [ ] **Step 3: Commit**

```bash
git add elixir/WORKFLOW.jira.example.md
git commit -m "docs(jira): document per-project board filter tracker_config keys"
```

---

## Task 5: Full quality gate

- [ ] **Step 1:** `cd elixir && mix format`
- [ ] **Step 2:** `cd elixir && mix specs.check` — every new public `def` has an adjacent `@spec` (only `Filter.build_jql/1` is public here; `IssueAdapter.list_issues/2` is `@impl`).
- [ ] **Step 3:** `cd elixir && make all` — format check, Credo, coverage, Dialyzer all green.
- [ ] **Step 4:** Fix any format/spec/Dialyzer issues, then commit:

```bash
git add -A
git commit -m "chore(jira): satisfy quality gates for board filter"
```

---

## Task 6 (operational): create the `advising` project bundle

> This task produces config that depends on **live Jira** (the exact CDE status
> names and the `Product` field's JQL reference). Do it against a running
> Symphony with Jira credentials configured. It is intentionally last and is not
> a TDD/code task.

**Files:**
- Create: `advising-project.yaml`

- [ ] **Step 1: Resolve the `Product` field reference.** With Jira credentials
configured, confirm whether `"Product" = "Inspire"` is a valid JQL clause for CDE
(unique custom field name) or whether the field id is required. Either:
  - query the field catalog: `GET /rest/api/3/field` and find the entry whose
    `name == "Product"` → use its `id` (e.g. `cf[10050]`), or
  - run a probe search `POST /rest/api/3/search/jql` with
    `{"jql": "project = \"CDE\" AND \"Product\" = \"Inspire\"", "maxResults": 1}`
    and confirm a 2xx (not a 400 "Field 'Product' does not exist").
  If the name works, use `fields: {Product: Inspire}`. If not, use
  `jql: 'cf[<id>] = "Inspire"'`.

- [ ] **Step 2: Capture CDE's workflow statuses.** From the running instance
(`GET /rest/api/3/project/CDE/statuses`) record the status names + categories so
`workflow_statuses` mirrors the real Jira board (category mapping: `new` →
`unstarted`, `indeterminate` → `started`, `done` → `completed`).

- [ ] **Step 3: Write `advising-project.yaml`** (model on `gamba-project.yaml`;
fill `workflow_statuses` from Step 2 and the filter from Step 1):

```yaml
kind: symphony_project
version: 2
slug: advising
name: Advising
description: "Civitas Advising — Jira CDE (Product = Inspire) + civitaslearning/advising."
tracker:
  kind: jira
  config:
    project_key: CDE
    fields:
      Product: Inspire
    # If "Product" is not directly queryable by name, drop `fields` and use:
    # jql: 'cf[<PRODUCT_FIELD_ID>] = "Inspire"'
repositories:
  - github_full_name: civitaslearning/advising
    clone_url: https://github.com/civitaslearning/advising.git
    default_branch: pre-release
    selected_branch: pre-release
    role: primary
    workspace_path: advising
workflow_statuses:
  # Replace with the real CDE statuses captured in Step 2. Example shape:
  - { name: "To Do", category: "unstarted", position: 0, is_terminal: false }
  - { name: "Em andamento", category: "started", position: 1, is_terminal: false }
  - { name: "Done", category: "completed", position: 2, is_terminal: true }
setup:
  workflow_markdown: |
    ---
    tracker:
      active_states:
        - To Do
        - Em andamento
    source_control:
      branch_pattern: "symphony/{issue}"
      pr_title_pattern: "{issue}: {title}"
      issue_marker_key: "Symphony-Issue"
    ---

    You are working on Jira issue `{{ issue.identifier }}` in the **Advising** board (Jira project `CDE`, Product `Inspire`).

    Repository: `civitaslearning/advising` (path `advising/`), integration branch and PR base `pre-release`.

    - Sync before handoff: `cd advising && git fetch origin && git merge origin/pre-release`.
    - Open the PR against `pre-release`: `cd advising && gh pr create --base pre-release --title "{{ issue.identifier }}: ..."`.
    - **Every PR body MUST include the association marker on its own line** so Symphony links the PR to this issue: `Symphony-Issue: {{ issue.identifier }}`.
```

- [ ] **Step 4: Import the project.** Either via the tracker UI "Import project"
flow, or programmatically:
`SymphonyElixir.LocalTracker.Projects.import_yaml(File.read!("advising-project.yaml"))`.
Confirm it returns `{:ok, %Project{slug: "advising"}}`.

- [ ] **Step 5: Confirm the dispatch gate.** In Settings → orchestrator, verify
`require_assignee_match` and `require_symphony_label` are ON (defaults). Optionally
set the global `jira.assignee: me` for an explicit gate. This is what keeps
colleagues' Inspire issues view-only.

- [ ] **Step 6: Verify the board.** Open the `advising` board and confirm it
mirrors only `Product = Inspire` CDE issues (including colleagues' for tracking),
and that none of the non-assigned/unlabeled issues are auto-started.

---

## Self-Review

**Spec coverage:**
- Config schema (`fields` + `jql` + `order_by` + `max_results`) → Task 1 (builder) + Task 2 (`max_results`) + Task 4 (docs).
- JQL builder → Task 1.
- Pagination + cap → Task 2.
- `project_key` validation → Task 3.
- Visibility/execution split → documented (Task 4) + verified (Task 6 Steps 5-6); relies on existing orchestrator gates (no code change needed).
- Advising bundle → Task 6.
- Backward compatibility (no filter → legacy JQL) → Task 1 first test + existing `issue_adapter_test` left intact.

**Placeholder scan:** Task 6's `workflow_statuses` and the `Product` field id are
live-data values that genuinely require a running Jira (called out explicitly,
with the commands to obtain them) — not unresolved plan placeholders. All code
tasks (1-3) contain complete code.

**Type consistency:** `Filter.build_jql/1` takes a `%Project{}` and returns a
`String.t()`, used the same way in Task 1 and Task 2. `search_body/2`,
`last_page?/1`, `max_results/1`, and `truncate/3` names are consistent between the
implementation and the tests' expectations (`nextPageToken`, `isLast`,
`max_results`).
