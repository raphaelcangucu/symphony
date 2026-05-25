# GitHub Projects v2 (GraphQL-only) Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Run tests from `elixir/` with `mix test path/to/test.exs` unless noted.

**Goal:** Replace the label-based REST GitHub tracker with a GraphQL-only adapter backed by repo-scoped GitHub Projects v2, including auto-bootstrap of a project board and `Symphony State` field.

**Architecture:** One `SymphonyElixir.GitHub.Client` module mirrors `Linear.Client`: `graphql/3` transport, poll via `projectV2.items`, writes via `updateProjectV2ItemFieldValue` + `updateIssue` + `addComment`. Project metadata (field IDs, option map) lives in `.symphony/github-project.json`, written by `GitHub.Bootstrap` on first startup when `github.project.mode: auto`.

**Tech Stack:** Elixir 1.19, Req, GraphQL (`https://api.github.com/graphql`), existing `SymphonyElixir.Tracker` behaviour.

**Spec:** `docs/superpowers/specs/2026-05-24-github-projects-design.md`

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `elixir/lib/symphony_elixir/github/project_metadata.ex` | Read/write/cache `.symphony/github-project.json` |
| Create | `elixir/lib/symphony_elixir/github/bootstrap.ex` | `createProjectV2`, `createProjectV2Field`, cache write |
| Rewrite | `elixir/lib/symphony_elixir/github/client.ex` | GraphQL-only tracker operations |
| Modify | `elixir/lib/symphony_elixir/github/config.ex` | Project config; remove `label_prefix` |
| Modify | `elixir/lib/symphony_elixir/github/tracker.ex` | Wire bootstrap in validate path if needed |
| Modify | `elixir/lib/symphony_elixir/status_dashboard.ex` | Project board URL |
| Modify | `elixir/.gitignore` | Ignore `.symphony/` |
| Rewrite | `elixir/test/symphony_elixir/github_client_test.exs` | GraphQL mocks |
| Create | `elixir/test/symphony_elixir/github/bootstrap_test.exs` | Bootstrap sequence tests |
| Create | `elixir/test/symphony_elixir/github/project_metadata_test.exs` | Cache read/write tests |
| Modify | `elixir/test/support/test_support.exs` | GitHub YAML helper (project config, no `label_prefix`) |
| Modify | `elixir/test/symphony_elixir/tracker_github_test.exs` | Drop `label_prefix` |
| Modify | `elixir/README.md` | GitHub Projects setup |
| Modify | `elixir/docs/troubleshooting.md` | GraphQL permissions, project bootstrap |

---

### Task 1: Project metadata cache

**Files:**
- Create: `elixir/lib/symphony_elixir/github/project_metadata.ex`
- Create: `elixir/test/symphony_elixir/github/project_metadata_test.exs`
- Modify: `elixir/.gitignore`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.GitHub.ProjectMetadataTest do
  use SymphonyElixir.TestSupport, async: true

  alias SymphonyElixir.GitHub.ProjectMetadata

  setup do
    tmp = System.tmp_dir!() |> Path.join("symphony-meta-#{:erlang.unique_integer()}")
    File.mkdir_p!(tmp)
    on_exit(fn -> File.rm_rf!(tmp) end)
    %{dir: tmp}
  end

  test "write then read round-trips metadata", %{dir: dir} do
    meta = %{
      "project_id" => "PVT_kwDO",
      "project_number" => 3,
      "status_field_id" => "PVTSSF_x",
      "state_options" => %{"Todo" => "opt1", "Done" => "opt2"},
      "bootstrapped_at" => "2026-05-24T00:00:00Z"
    }

    assert :ok = ProjectMetadata.write!(dir, meta)
    assert {:ok, ^meta} = ProjectMetadata.read(dir)
  end

  test "read returns error when file missing", %{dir: dir} do
    assert {:error, :missing_project_metadata} = ProjectMetadata.read(dir)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/github/project_metadata_test.exs`
Expected: FAIL — module `ProjectMetadata` not defined

- [ ] **Step 3: Implement `ProjectMetadata`**

```elixir
defmodule SymphonyElixir.GitHub.ProjectMetadata do
  @moduledoc false

  @filename "github-project.json"
  @default_rel_dir ".symphony"

  @spec cache_path(Path.t()) :: Path.t()
  def cache_path(base \\ File.cwd!()), do: Path.join(base, Path.join(@default_rel_dir, @filename))

  @spec read(Path.t()) :: {:ok, map()} | {:error, :missing_project_metadata | :invalid_project_metadata}
  def read(base \\ File.cwd!()) do
    path = cache_path(base)

    case File.read(path) do
      {:ok, raw} ->
        case Jason.decode(raw) do
          {:ok, map} when is_map(map) -> {:ok, map}
          _ -> {:error, :invalid_project_metadata}
        end

      {:error, :enoent} ->
        {:error, :missing_project_metadata}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec write!(Path.t(), map()) :: :ok
  def write!(base, metadata) when is_map(metadata) do
    path = cache_path(base)
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, Jason.encode!(metadata))
  end
end
```

Add to `elixir/.gitignore`:

```
.symphony/
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/github/project_metadata_test.exs`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/project_metadata.ex \
        elixir/test/symphony_elixir/github/project_metadata_test.exs \
        elixir/.gitignore
git commit -m "$(cat <<'EOF'
Add GitHub project metadata cache module for Projects v2 bootstrap.

EOF
)"
```

---

### Task 2: Extend GitHub config (remove label_prefix, add project keys)

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/config.ex`
- Modify: `elixir/test/support/test_support.exs`
- Modify: `elixir/test/symphony_elixir/core_test.exs` (if label_prefix assertions exist)

- [ ] **Step 1: Write the failing test** in `elixir/test/symphony_elixir/github_config_test.exs` (create file):

```elixir
defmodule SymphonyElixir.GitHub.ConfigTest do
  use SymphonyElixir.TestSupport, async: false

  alias SymphonyElixir.GitHub.Config
  alias SymphonyElixir.Workflow

  setup do
    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "github",
      tracker_repo: "raphaelcangucu/symphony",
      github_project_mode: "auto",
      github_project_title: "Symphony"
    )

    :ok
  end

  test "project_mode/0 returns auto" do
    assert Config.project_mode() == "auto"
  end

  test "status_field/0 defaults to Symphony State" do
    assert Config.status_field() == "Symphony State"
  end

  test "admission_label/0 defaults to symphony" do
    assert Config.admission_label() == "symphony"
  end
end
```

Extend `test_support.exs` `tracker_backend_yaml("github", ...)` to emit:

```elixir
defp tracker_backend_yaml("github", config) do
  repo = Keyword.get(config, :tracker_repo)
  project_mode = Keyword.get(config, :github_project_mode)
  project_title = Keyword.get(config, :github_project_title)

  [
    "github:",
    repo && "  repo: #{yaml_value(repo)}",
    project_mode && "  project:\n    mode: #{yaml_value(project_mode)}",
    project_title && "    title: #{yaml_value(project_title)}"
  ]
  |> Enum.reject(&is_nil/1)
  |> Enum.join("\n")
end
```

Add keyword passthrough in `write_workflow_file!/2` opts list.

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd elixir && mix test test/symphony_elixir/github_config_test.exs`

- [ ] **Step 3: Update `config.ex`**

Remove `label_prefix/0` entirely. Add:

```elixir
@default_status_field "Symphony State"
@default_admission_label "symphony"

@spec project_mode() :: String.t()
def project_mode, do: get_in(section("project"), ["mode"]) || "auto"

@spec project_title() :: String.t()
def project_title, do: get_in(section("project"), ["title"]) || "Symphony"

@spec status_field() :: String.t()
def status_field, do: section_value("status_field") || @default_status_field

@spec admission_label() :: String.t()
def admission_label, do: section_value("admission_label") || @default_admission_label
```

Update `validate!/0` to call `Bootstrap.ensure_project!/0` when mode is `auto` (stub returning `:ok` until Task 3).

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/config.ex \
        elixir/test/symphony_elixir/github_config_test.exs \
        elixir/test/support/test_support.exs
git commit -m "$(cat <<'EOF'
Replace GitHub label_prefix config with Projects v2 project settings.

EOF
)"
```

---

### Task 3: GraphQL transport layer

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/client.ex` (replace contents incrementally — start with transport only)
- Modify: `elixir/test/symphony_elixir/github_client_test.exs`

- [ ] **Step 1: Write failing test for `graphql/3`**

```elixir
test "graphql/3 posts to GitHub GraphQL endpoint" do
  request_fun = fn payload, headers ->
    assert payload["query"] =~ "viewer"
    assert {"Authorization", "Bearer test-gh-token"} in headers
    {:ok, %{status: 200, body: %{"data" => %{"viewer" => %{"login" => "octocat"}}}}}
  end

  assert {:ok, body} =
           Client.graphql("query { viewer { login } }", %{}, request_fun: request_fun)

  assert get_in(body, ["data", "viewer", "login"]) == "octocat"
end

test "graphql/3 returns error on top-level errors" do
  request_fun = fn _payload, _headers ->
    {:ok, %{status: 200, body: %{"errors" => [%{"message" => "bad"}]}}}
  end

  assert {:error, {:github_graphql_errors, _}} =
           Client.graphql("query { viewer { login } }", %{}, request_fun: request_fun)
end
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd elixir && mix test test/symphony_elixir/github_client_test.exs --only graphql_transport`
(tag tests or run whole file expecting failures)

- [ ] **Step 3: Implement transport** (mirror `Linear.Client.graphql/3`):

```elixir
@endpoint "https://api.github.com/graphql"

@spec graphql(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
def graphql(query, variables \\ %{}, opts \\ []) do
  request_fun = Keyword.get(opts, :request_fun, &post_graphql_request/2)

  with {:ok, token} <- require_token(),
       payload <- %{"query" => query, "variables" => variables},
       headers <- [{"Authorization", "Bearer #{token}"}, {"Content-Type", "application/json"}],
       {:ok, %{status: 200, body: body}} <- request_fun.(payload, headers) do
    decode_graphql_response(body)
  else
    {:ok, %{status: status}} -> {:error, {:github_api_status, status}}
    {:error, reason} -> {:error, {:github_api_request, reason}}
  end
end

defp decode_graphql_response(%{"errors" => errors}), do: {:error, {:github_graphql_errors, errors}}
defp decode_graphql_response(body) when is_map(body), do: {:ok, body}
defp decode_graphql_response(_), do: {:error, :github_unknown_payload}

defp post_graphql_request(payload, headers) do
  Req.post(@endpoint, json: payload, headers: headers, connect_options: [timeout: 30_000])
end
```

Keep `parse_repo/0` and `require_token/0` from existing client (reuse or move to shared helper).

- [ ] **Step 4: Run transport tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "$(cat <<'EOF'
Add GraphQL transport to GitHub client.

EOF
)"
```

---

### Task 4: Bootstrap module

**Files:**
- Create: `elixir/lib/symphony_elixir/github/bootstrap.ex`
- Create: `elixir/test/symphony_elixir/github/bootstrap_test.exs`

- [ ] **Step 1: Write failing bootstrap test**

Mock `Client.graphql/3` to return sequential responses for:
1. Repository owner lookup
2. `createProjectV2`
3. `createProjectV2Field`
4. Fields query (status field + options)

Assert `ProjectMetadata.read/1` returns populated cache after `Bootstrap.run!/1`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `Bootstrap`**

Key mutations:

```graphql
mutation($ownerId: ID!, $title: String!) {
  createProjectV2(input: { ownerId: $ownerId, title: $title }) {
    projectV2 { id number url }
  }
}
```

```graphql
mutation($projectId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
  createProjectV2Field(input: {
    projectId: $projectId
    name: $name
    dataType: SINGLE_SELECT
    singleSelectOptions: $options
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField { id options { id name } }
    }
  }
}
```

Build `$options` from `Config.active_states() ++ Config.terminal_states()` with `{name, color: GRAY, description: name}`.

`ensure_project!/0`:
- If `ProjectMetadata.read/0` is `{:ok, _}`, return `:ok`
- Else if `project_mode() == "auto"`, call `run!/0`
- Else `{:error, "GitHub project metadata missing"}`

Wire into `GitHub.Config.validate!/0`.

- [ ] **Step 4: Run bootstrap tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/bootstrap.ex \
        elixir/test/symphony_elixir/github/bootstrap_test.exs
git commit -m "$(cat <<'EOF'
Bootstrap repo-level GitHub Project with Symphony State field on first run.

EOF
)"
```

---

### Task 5: Poll and normalize issues

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/client.ex`
- Modify: `elixir/test/symphony_elixir/github_client_test.exs`

- [ ] **Step 1: Write failing test** — `fetch_candidate_issues/1` returns issues filtered by `active_states`

Fixture GraphQL response with two project items:
- Issue #1, Symphony State = `"Todo"` → included
- Issue #2, Symphony State = `"Done"` → excluded

Assert `issue.id` is node ID (`"I_abc"`), `identifier` is `"1"`, `state` is `"Todo"`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement poll**

- Load metadata via `ProjectMetadata.read/0`
- Paginate `projectV2.items` (page size 50, mirror Linear)
- `normalize_project_item/2` extracts issue + Symphony State field by `Config.status_field/0`
- Filter: state ∈ `Config.active_states()` (case-sensitive name match to WORKFLOW)
- Filter: issue repository matches `github.repo`

Expose `@doc false def normalize_project_item_for_test/1` for unit tests (pattern from Linear).

- [ ] **Step 4: Implement `fetch_issues_by_states/2` and `fetch_issue_states_by_ids/2`**

- `fetch_issues_by_states`: same poll, filter by given state list
- `fetch_issue_states_by_ids`: GraphQL `nodes(ids: $ids)` on issue node IDs stored by orchestrator

- [ ] **Step 5: Run tests — PASS**

- [ ] **Step 6: Commit**

```bash
git commit -am "$(cat <<'EOF'
Poll GitHub Project items and normalize issues from Symphony State field.

EOF
)"
```

---

### Task 6: State transitions and comments

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/client.ex`
- Modify: `elixir/test/symphony_elixir/github_client_test.exs`

- [ ] **Step 1: Write failing test for `update_issue_state/3`**

Given cached metadata with option IDs, assert GraphQL calls:
1. `updateProjectV2ItemFieldValue` with correct `singleSelectOptionId`
2. `updateIssue` with `state: CLOSED` when terminal

- [ ] **Step 2: Write failing test for `create_comment/3`**

Assert `addComment(input: {subjectId, body})` mutation.

- [ ] **Step 3: Implement**

Maintain in-memory or process-local cache `issue_id → project_item_id` populated during poll; for writes outside poll, query project item by issue node ID.

`update_issue_state(issue_id, state_name, opts)`:
- Resolve `option_id` from metadata `state_options`
- Resolve `project_item_id`
- GraphQL field update
- Close/reopen via `updateIssue` when crossing terminal/active boundary

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "$(cat <<'EOF'
Add GraphQL issue state transitions and comments for GitHub tracker.

EOF
)"
```

---

### Task 7: Issue admission (label gate)

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/client.ex`
- Modify: `elixir/test/symphony_elixir/github_client_test.exs`

- [ ] **Step 1: Write failing test**

During poll, issue in repo with label `symphony` but not on board triggers:
1. `addProjectV2ItemById`
2. `updateProjectV2ItemFieldValue` → first `active_states` entry

- [ ] **Step 2: Implement admission scan**

Before or after main poll, query open issues with label `admission_label` (GraphQL `repository.issues(labels: [...])`), diff against project items, admit missing ones.

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -am "$(cat <<'EOF'
Admit labeled GitHub issues into Symphony project board during poll.

EOF
)"
```

---

### Task 8: Delete legacy REST code and update docs

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/client.ex` — ensure zero REST (`Req.get/post` to `api.github.com/repos`)
- Modify: `elixir/test/symphony_elixir/tracker_github_test.exs`
- Modify: `elixir/README.md`
- Modify: `elixir/docs/troubleshooting.md`
- Modify: `elixir/lib/symphony_elixir/status_dashboard.ex`

- [ ] **Step 1: Grep for legacy references**

Run: `cd elixir && rg 'label_prefix|symphony:todo|api\.github\.com/repos' lib test`

Expected: zero matches after cleanup.

- [ ] **Step 2: Update dashboard project URL**

```elixir
defp project_url("github", repo) do
  case SymphonyElixir.GitHub.ProjectMetadata.read() do
    {:ok, %{"project_number" => n}} -> "https://github.com/#{repo}/projects/#{n}"
    _ -> "https://github.com/#{repo}/issues"
  end
end
```

- [ ] **Step 3: Update README and troubleshooting**

Document:
- `github.project.mode: auto`
- `GITHUB_TOKEN` needs Projects read/write
- Admission label `symphony`
- Bootstrap creates `.symphony/github-project.json`

Remove all `label_prefix` / `symphony:todo` instructions.

- [ ] **Step 4: Run full test suite**

Run: `cd elixir && make all`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add elixir/README.md elixir/docs/troubleshooting.md \
        elixir/lib/symphony_elixir/status_dashboard.ex
git commit -am "$(cat <<'EOF'
Remove legacy GitHub label tracker and document Projects v2 setup.

EOF
)"
```

---

### Task 9: Example WORKFLOW for fork

**Files:**
- Create: `elixir/WORKFLOW.github.example.md` (or document in README only)

- [ ] **Step 1: Add example WORKFLOW snippet** targeting `raphaelcangucu/symphony`:

```yaml
github:
  repo: raphaelcangucu/symphony
  project:
    mode: auto
    title: Symphony
  admission_label: symphony

tracker:
  active_states:
    - Todo
    - In Progress
    - Merging
    - Rework
  terminal_states:
    - Done
    - Cancelled
```

- [ ] **Step 2: Commit and push branch**

```bash
git add elixir/WORKFLOW.github.example.md
git commit -m "$(cat <<'EOF'
Add example WORKFLOW for GitHub Projects v2 tracker on the fork.

EOF
)"
git push -u origin feat/github-projects-v2
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| GraphQL-only client | 3, 8 |
| Repo-level project bootstrap | 4 |
| `Symphony State` custom field | 4 |
| Poll respects `active_states` | 5 |
| State transitions + close/reopen | 6 |
| `create_comment` via GraphQL | 6 |
| Label admission gate | 7 |
| Delete REST / label_prefix | 2, 8 |
| `.symphony/github-project.json` | 1, 4 |
| Docs update | 8, 9 |

## Phase 2+ (separate plans)

- Assignee filter (`github.assignee`)
- WORKFLOW state mismatch detection
- `github_graphql` agent tool
- Blockers via issue links
