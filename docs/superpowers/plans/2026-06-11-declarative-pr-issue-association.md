# Declarative PR↔Issue Association Implementation Plan

**Goal:** Replace heuristic PR discovery with a declared contract — a machine-readable `Symphony-Issue:` marker in the PR body plus a parseable `symphony:prs` workpad block — and reconcile detected PRs back onto the task (DB + workpad) from the background monitor.

**Architecture:** A new `source_control` `workflow_markdown` section declares branch/title/marker conventions. Two pure modules (`GitHub.IssueMarker`, `Workpad.PullRequestBlock`) build/parse the marker and the workpad block. `GitHub.PullRequests.for_project_issue/3` unions live sources (workpad parse + deterministic marker search + native GitHub fallback), dropping the prefix/title heuristic. `tracker_pull_requests` gains `head_branch`. The finalizer writes the marker; the `PullRequestMonitor` reconciles detected PRs onto the task idempotently.

**Tech Stack:** Elixir/Phoenix (Ecto/SQLite, ExUnit), GitHub GraphQL+REST via `SymphonyElixir.GitHub.Client`.

**Spec:** `docs/superpowers/specs/2026-06-11-declarative-pr-issue-association-design.md`

> **Conventions:** All Elixir commands run from `elixir/`. If `mix` is not on PATH, prefix with `mise exec --` (e.g. `mise exec -- mix test ...`). Every public `def` in `lib/` needs an adjacent `@spec` (`mix specs.check`). Commit after each task.

---

## File map

**Create:**
| Path | Owns |
|---|---|
| `elixir/lib/symphony_elixir/github/issue_marker.ex` | build/parse the `Symphony-Issue` marker |
| `elixir/lib/symphony_elixir/workpad/pull_request_block.ex` | render/parse/upsert the `symphony:prs` block |
| `elixir/priv/repo/migrations/20260611140000_add_head_branch_to_tracker_pull_requests.exs` | `head_branch` column |
| `elixir/test/symphony_elixir/github/issue_marker_test.exs` | tests |
| `elixir/test/symphony_elixir/workpad/pull_request_block_test.exs` | tests |

**Modify:**
| Path | Change |
|---|---|
| `elixir/lib/symphony_elixir/tracker/sync/pull_request_record.ex` | add `head_branch` field + cast |
| `elixir/lib/symphony_elixir/tracker/sync/pull_requests.ex` | expose `head_branch` in reader map |
| `elixir/lib/symphony_elixir/tracker/sync/local_store.ex` | persist `head_branch` in discovered upsert |
| `elixir/lib/symphony_elixir/project_config.ex` | `:source_control` field + accessors + defaults |
| `elixir/lib/symphony_elixir/github/pull_requests.ex` | add `body` to PR fields; marker search; union rewrite; drop heuristic |
| `elixir/lib/symphony_elixir/run_contract/finalizer.ex` | inject marker into PR body |
| `elixir/lib/symphony_elixir/pull_request_monitor.ex` | reconcile detected PRs onto the task |
| `elixir/test/symphony_elixir/github/pull_requests_for_project_issue_test.exs` | replace heuristic test with marker/workpad union test |
| `elixir/test/symphony_elixir/project_config_test.exs` | `source_control` accessor tests |
| `elixir/test/symphony_elixir/run_contract/finalizer_test.exs` | assert marker in body |
| `elixir/test/symphony_elixir/pull_request_monitor_test.exs` | reconcile tests |
| `.claude/skills/workpad/SKILL.md` | document the `symphony:prs` block |
| `gamba-project.yaml` | `source_control` section + agent PR instructions |
| `elixir/README.md` | `source_control` config contract |

---

### Task 1: `head_branch` column + schema + reader

**Files:**
- Create: `elixir/priv/repo/migrations/20260611140000_add_head_branch_to_tracker_pull_requests.exs`
- Modify: `elixir/lib/symphony_elixir/tracker/sync/pull_request_record.ex`
- Modify: `elixir/lib/symphony_elixir/tracker/sync/pull_requests.ex`
- Modify: `elixir/lib/symphony_elixir/tracker/sync/local_store.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/local_store_pull_requests_test.exs` (existing)

- [ ] **Step 1: Write the failing test**

Append to `elixir/test/symphony_elixir/tracker/sync/local_store_pull_requests_test.exs` (inside the existing `describe`/module; reuse its `setup`):

```elixir
test "upsert_discovered_pull_requests persists head_branch", %{project: project} do
  :ok =
    LocalStore.upsert_discovered_pull_requests(project.id, "GAM-2", [
      %{
        remote_id: "https://github.com/GambaLabs/backend/pull/3997",
        url: "https://github.com/GambaLabs/backend/pull/3997",
        number: 3997,
        repo: "GambaLabs/backend",
        state: "open",
        head_branch: "symphony/1857",
        origin: "auto"
      }
    ])

  assert {:ok, [pr]} = SymphonyElixir.Tracker.Sync.PullRequests.for_issue(project.slug, "GAM-2")
  assert pr.head_branch == "symphony/1857"
end
```

> If that test file has no `%{project: project}` setup, mirror the project-creation setup already used by its sibling tests in the file before this step.

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/tracker/sync/local_store_pull_requests_test.exs`
Expected: FAIL — `KeyError`/missing `:head_branch` on the reader map (and the column does not exist).

- [ ] **Step 3: Create the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.AddHeadBranchToTrackerPullRequests do
  use Ecto.Migration

  def change do
    alter table(:tracker_pull_requests) do
      add(:head_branch, :string)
    end
  end
end
```

- [ ] **Step 4: Add the field to the schema + cast**

In `elixir/lib/symphony_elixir/tracker/sync/pull_request_record.ex`, add the field next to `:repo`:

```elixir
    field(:repo, :string)
    field(:head_branch, :string)
```

and add `:head_branch` to the `cast/3` field list (next to `:repo`):

```elixir
      :repo,
      :head_branch,
```

- [ ] **Step 5: Expose `head_branch` in the reader**

In `elixir/lib/symphony_elixir/tracker/sync/pull_requests.ex`, add to the `@type pr` map `head_branch: String.t() | nil` and to `to_map/1`:

```elixir
      repo: pr.repo,
      head_branch: pr.head_branch,
      origin: pr.origin
```

- [ ] **Step 6: Persist `head_branch` in the discovered upsert**

In `elixir/lib/symphony_elixir/tracker/sync/local_store.ex`, `upsert_one!/3` already passes through arbitrary keys via `PullRequestRecord.changeset`, so no change is needed there once the schema casts `:head_branch`. Confirm `upsert_discovered_pull_requests/3` forwards the map unchanged (it does). No code change in this step beyond verification.

- [ ] **Step 7: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/local_store_pull_requests_test.exs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add elixir/priv/repo/migrations/20260611140000_add_head_branch_to_tracker_pull_requests.exs elixir/lib/symphony_elixir/tracker/sync/pull_request_record.ex elixir/lib/symphony_elixir/tracker/sync/pull_requests.ex elixir/test/symphony_elixir/tracker/sync/local_store_pull_requests_test.exs
git commit -m "feat(tracker): add head_branch to tracker_pull_requests"
```

---

### Task 2: `GitHub.IssueMarker` (build/parse the marker)

**Files:**
- Create: `elixir/lib/symphony_elixir/github/issue_marker.ex`
- Test: `elixir/test/symphony_elixir/github/issue_marker_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.GitHub.IssueMarkerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.IssueMarker

  test "marker_line builds the default-key line" do
    assert IssueMarker.marker_line("GAM-2") == "Symphony-Issue: GAM-2"
  end

  test "marker_line honors a custom key and trims the identifier" do
    assert IssueMarker.marker_line("  GAM-2 ", "Linked-Issue") == "Linked-Issue: GAM-2"
  end

  test "extract finds one marker (case-insensitive key, surrounding text)" do
    body = "Recovery publish\n\nsymphony-issue:  GAM-2  \n\nMade with Cursor"
    assert IssueMarker.extract(body) == ["GAM-2"]
  end

  test "extract finds multiple distinct markers and dedups" do
    body = "Symphony-Issue: GAM-2\nSymphony-Issue: GAM-2\nSymphony-Issue: GAM-9"
    assert IssueMarker.extract(body) == ["GAM-2", "GAM-9"]
  end

  test "extract returns [] when absent or nil" do
    assert IssueMarker.extract("no marker here") == []
    assert IssueMarker.extract(nil) == []
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/github/issue_marker_test.exs`
Expected: FAIL — module/functions undefined.

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.GitHub.IssueMarker do
  @moduledoc """
  Builds and parses the machine-readable marker that links a pull request to a
  Symphony tracker issue, e.g. `Symphony-Issue: GAM-2`. This explicit marker
  replaces heuristic branch/title guessing for PR↔issue association.
  """

  @default_key "Symphony-Issue"

  @spec default_key() :: String.t()
  def default_key, do: @default_key

  @spec marker_line(String.t(), String.t()) :: String.t()
  def marker_line(identifier, key \\ @default_key)
      when is_binary(identifier) and is_binary(key) do
    "#{key}: #{String.trim(identifier)}"
  end

  @spec extract(String.t() | nil, String.t()) :: [String.t()]
  def extract(body, key \\ @default_key)

  def extract(body, key) when is_binary(body) and is_binary(key) do
    pattern = ~r/^\s*#{Regex.escape(key)}\s*:\s*(\S.*?)\s*$/im

    pattern
    |> Regex.scan(body)
    |> Enum.map(fn [_, id] -> String.trim(id) end)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  def extract(_body, _key), do: []
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/github/issue_marker_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/issue_marker.ex elixir/test/symphony_elixir/github/issue_marker_test.exs
git commit -m "feat(github): add IssueMarker for declarative PR↔issue links"
```

---

### Task 3: `Workpad.PullRequestBlock` (render/parse/upsert)

**Files:**
- Create: `elixir/lib/symphony_elixir/workpad/pull_request_block.ex`
- Test: `elixir/test/symphony_elixir/workpad/pull_request_block_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Workpad.PullRequestBlockTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Workpad.PullRequestBlock

  @prs [
    %{repo: "GambaLabs/frontend", number: 1866, branch: "feat/DailyTipLimit", url: "https://github.com/GambaLabs/frontend/pull/1866"},
    %{repo: "GambaLabs/backend", number: 3997, branch: "symphony/1857", url: "https://github.com/GambaLabs/backend/pull/3997"}
  ]

  test "render round-trips through parse" do
    parsed = @prs |> PullRequestBlock.render() |> PullRequestBlock.parse()

    assert parsed == [
             %{repo: "GambaLabs/frontend", number: 1866, branch: "feat/DailyTipLimit", url: "https://github.com/GambaLabs/frontend/pull/1866"},
             %{repo: "GambaLabs/backend", number: 3997, branch: "symphony/1857", url: "https://github.com/GambaLabs/backend/pull/3997"}
           ]
  end

  test "parse returns [] when block absent or malformed" do
    assert PullRequestBlock.parse("## Codex Workpad\n\n### Plan\n- [ ] do it") == []
    assert PullRequestBlock.parse(nil) == []
    assert PullRequestBlock.parse("<!-- symphony:prs\ngarbage\n-->") == []
  end

  test "upsert_block inserts when absent, preserving other sections" do
    body = "## Codex Workpad\n\n### Plan\n- [x] done\n\n### Outcome\nin-progress"
    updated = PullRequestBlock.upsert_block(body, @prs)

    assert updated =~ "### Plan"
    assert updated =~ "### Outcome"
    assert PullRequestBlock.parse(updated) |> length() == 2
  end

  test "upsert_block replaces an existing block in place (idempotent on same input)" do
    body = PullRequestBlock.upsert_block("## Codex Workpad\n\n### Plan\n- [x] done", @prs)
    again = PullRequestBlock.upsert_block(body, @prs)

    assert again == body
    # only one block exists
    assert Regex.scan(~r/<!--\s*symphony:prs/, again) |> length() == 1
  end

  test "upsert_block on nil body creates a minimal workpad" do
    updated = PullRequestBlock.upsert_block(nil, @prs)
    assert updated =~ "## Codex Workpad"
    assert PullRequestBlock.parse(updated) |> length() == 2
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/workpad/pull_request_block_test.exs`
Expected: FAIL — module/functions undefined.

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Workpad.PullRequestBlock do
  @moduledoc """
  Renders and parses the machine-readable `symphony:prs` block embedded in an
  issue's `## Codex Workpad` comment. The block is an HTML comment (invisible in
  rendered markdown) carrying the issue's associated PRs so discovery can parse
  them deterministically.
  """

  @begin_marker "<!-- symphony:prs"
  @end_marker "-->"
  @block_regex ~r/<!--\s*symphony:prs\b.*?-->/s

  @type pr_ref :: %{
          repo: String.t() | nil,
          number: integer() | nil,
          branch: String.t() | nil,
          url: String.t() | nil
        }

  @spec render([map()]) :: String.t()
  def render(prs) when is_list(prs) do
    body = prs |> Enum.map(&render_one/1) |> Enum.join("\n")
    @begin_marker <> "\n" <> body <> "\n" <> @end_marker
  end

  @spec parse(String.t() | nil) :: [pr_ref()]
  def parse(body) when is_binary(body) do
    case Regex.run(@block_regex, body) do
      [block] -> parse_block(block)
      _ -> []
    end
  end

  def parse(_body), do: []

  @spec upsert_block(String.t() | nil, [map()]) :: String.t()
  def upsert_block(body, prs) when is_binary(body) and is_list(prs) do
    rendered = render(prs)

    if Regex.match?(@block_regex, body) do
      Regex.replace(@block_regex, body, fn _ -> rendered end)
    else
      String.trim_trailing(body) <> "\n\n" <> rendered <> "\n"
    end
  end

  def upsert_block(nil, prs) when is_list(prs) do
    "## Codex Workpad\n\n" <> render(prs) <> "\n"
  end

  defp render_one(pr) do
    [
      "- repo: #{field(pr, :repo)}",
      "  number: #{field(pr, :number)}",
      "  branch: #{field(pr, :branch) || field(pr, :head_ref)}",
      "  url: #{field(pr, :url)}"
    ]
    |> Enum.join("\n")
  end

  defp parse_block(block) do
    block
    |> String.split("\n")
    |> Enum.reduce({[], nil}, fn line, {items, current} ->
      cond do
        Regex.match?(~r/^\s*-\s+/, line) ->
          items = if current, do: [current | items], else: items
          {items, parse_kv(strip_dash(line), %{})}

        current != nil ->
          {items, parse_kv(line, current)}

        true ->
          {items, current}
      end
    end)
    |> close_items()
    |> Enum.map(&to_ref/1)
    |> Enum.reject(&(is_nil(&1.url) and is_nil(&1.repo)))
    |> Enum.reverse()
  end

  defp close_items({items, nil}), do: items
  defp close_items({items, current}), do: [current | items]

  defp parse_kv(line, acc) do
    case Regex.run(~r/^\s*(repo|number|branch|url)\s*:\s*(.*?)\s*$/, line) do
      [_, key, value] -> Map.put(acc, key, blank_to_nil(value))
      _ -> acc
    end
  end

  defp strip_dash(line), do: Regex.replace(~r/^\s*-\s+/, line, "")

  defp to_ref(fields) do
    %{
      repo: fields["repo"],
      number: to_int(fields["number"]),
      branch: fields["branch"],
      url: fields["url"]
    }
  end

  defp field(map, key), do: Map.get(map, key) || Map.get(map, to_string(key))

  defp blank_to_nil(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp to_int(nil), do: nil

  defp to_int(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, _} -> n
      :error -> nil
    end
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/workpad/pull_request_block_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/workpad/pull_request_block.ex elixir/test/symphony_elixir/workpad/pull_request_block_test.exs
git commit -m "feat(workpad): add parseable symphony:prs block"
```

---

### Task 4: `ProjectConfig` `source_control` section + accessors

**Files:**
- Modify: `elixir/lib/symphony_elixir/project_config.ex`
- Test: `elixir/test/symphony_elixir/project_config_test.exs` (existing)

- [ ] **Step 1: Write the failing test**

Append to `elixir/test/symphony_elixir/project_config_test.exs`:

```elixir
describe "source_control accessors" do
  test "default when section is absent" do
    config = %SymphonyElixir.ProjectConfig{project_id: 1, project_slug: "p", tracker_kind: "github"}

    assert ProjectConfig.source_control_issue_marker_key(config) == "Symphony-Issue"
    assert ProjectConfig.source_control_branch_pattern(config) == "symphony/{issue}"
    assert ProjectConfig.source_control_pr_title_pattern(config) == "{issue}: {title}"
  end

  test "reads configured values" do
    config = %SymphonyElixir.ProjectConfig{
      project_id: 1,
      project_slug: "p",
      tracker_kind: "github",
      source_control: %{
        "issue_marker_key" => "Linked-Issue",
        "branch_pattern" => "agent/{issue}",
        "pr_title_pattern" => "[{issue}] {title}"
      }
    }

    assert ProjectConfig.source_control_issue_marker_key(config) == "Linked-Issue"
    assert ProjectConfig.source_control_branch_pattern(config) == "agent/{issue}"
    assert ProjectConfig.source_control_pr_title_pattern(config) == "[{issue}] {title}"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/project_config_test.exs`
Expected: FAIL — unknown struct field `:source_control` / undefined functions.

- [ ] **Step 3: Implement — add struct field, resolve, accessors**

In `defstruct`, add `:source_control` (next to `:dev_server`):

```elixir
    :dev_server,
    :source_control,
    :pr_monitor,
```

In `resolve/1`, add:

```elixir
      dev_server: front_matter_section(project_front_matter, "dev_server"),
      source_control: front_matter_section(project_front_matter, "source_control"),
      pr_monitor: front_matter_section(project_front_matter, "pr_monitor"),
```

Add accessors (near `pr_monitor_*`):

```elixir
  @default_branch_pattern "symphony/{issue}"
  @default_pr_title_pattern "{issue}: {title}"

  @doc "Branch naming convention (advisory; the marker is the authoritative link)."
  @spec source_control_branch_pattern(t()) :: String.t()
  def source_control_branch_pattern(%__MODULE__{source_control: %{"branch_pattern" => p}})
      when is_binary(p) and p != "",
      do: p

  def source_control_branch_pattern(%__MODULE__{}), do: @default_branch_pattern

  @doc "PR title convention (advisory)."
  @spec source_control_pr_title_pattern(t()) :: String.t()
  def source_control_pr_title_pattern(%__MODULE__{source_control: %{"pr_title_pattern" => p}})
      when is_binary(p) and p != "",
      do: p

  def source_control_pr_title_pattern(%__MODULE__{}), do: @default_pr_title_pattern

  @doc "Key of the PR-body marker that authoritatively links a PR to the issue."
  @spec source_control_issue_marker_key(t()) :: String.t()
  def source_control_issue_marker_key(%__MODULE__{source_control: %{"issue_marker_key" => k}})
      when is_binary(k) and k != "",
      do: k

  def source_control_issue_marker_key(%__MODULE__{}),
    do: SymphonyElixir.GitHub.IssueMarker.default_key()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/project_config_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/project_config.ex elixir/test/symphony_elixir/project_config_test.exs
git commit -m "feat(config): add source_control contract to ProjectConfig"
```

---

### Task 5: Marker discovery + union rewrite in `GitHub.PullRequests`

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/pull_requests.ex`
- Test: `elixir/test/symphony_elixir/github/pull_requests_for_project_issue_test.exs` (replace the heuristic test added earlier this session)

- [ ] **Step 1: Add `body` to PR fields + parser (prerequisite for marker confirm)**

In `@pr_fields`, add `body` (right after `url`):

```elixir
  number
  title
  url
  body
  state
```

In `parse_pr_node/1`, add to the returned map (next to `:title`):

```elixir
      title: string_or_nil(Map.get(node, "title")),
      body: string_or_nil(Map.get(node, "body")),
```

- [ ] **Step 2: Write the failing test**

Replace the body of `elixir/test/symphony_elixir/github/pull_requests_for_project_issue_test.exs`'s second test (the `"... symphony branch prefix and title search"` test added earlier) and its `BranchSearchClientStub` with a marker/workpad-based stub and test:

```elixir
  defmodule MarkerClientStub do
    @moduledoc false

    def graphql(query, variables, _opts) do
      cond do
        query =~ "SymphonyTrackerIssuePullRequests" ->
          {:ok, %{"data" => %{"repository" => %{"issue" => %{
             "linkedBranches" => %{"nodes" => []},
             "closedByPullRequestsReferences" => %{"nodes" => []},
             "timelineItems" => %{"nodes" => []}
           }}}}}

        query =~ "issueNodeId" or query =~ "IssueNodeId" ->
          {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => "I_remote"}}}}}

        query =~ "SymphonyPullRequestByNumber" ->
          {:ok, %{"data" => %{"repository" => %{"pullRequest" => pr_for(variables)}}}}

        true ->
          {:ok, %{"data" => %{"repository" => %{"pullRequests" => %{"nodes" => []}}}}}
      end
    end

    # Marker candidate search: only the backend PR carries the marker in its body.
    def rest_get("/search/issues?" <> query, _opts) do
      if String.contains?(query, "backend") do
        {:ok, %{status: 200, body: %{"items" => [%{"number" => 3997,
           "pull_request" => %{"url" => "https://github.com/GambaLabs/backend/pull/3997"}}]}}}
      else
        {:ok, %{status: 200, body: %{"items" => []}}}
      end
    end

    defp pr_for(%{"name" => "backend", "number" => 3997}),
      do: pr_node(3997, "GambaLabs/backend", "symphony/1857", "Recovery publish\n\nSymphony-Issue: GAM-2")

    defp pr_for(%{"name" => "frontend", "number" => 1866}),
      do: pr_node(1866, "GambaLabs/frontend", "feat/DailyTipLimit", "test")

    defp pr_for(_), do: nil

    defp pr_node(number, repo, head, body) do
      %{
        "number" => number, "title" => "#{number}: test", "url" => "https://github.com/#{repo}/pull/#{number}",
        "body" => body, "state" => "OPEN", "repository" => %{"nameWithOwner" => repo},
        "isDraft" => false, "merged" => false, "mergedAt" => nil,
        "createdAt" => "2026-06-11T19:49:00Z", "updatedAt" => "2026-06-11T19:49:00Z",
        "headRefName" => head, "baseRefName" => "dev", "author" => %{"login" => "agent"},
        "commits" => %{"nodes" => []}, "comments" => %{"nodes" => []}, "reviews" => %{"nodes" => []}
      }
    end
  end

  test "for_project_issue unions workpad block + marker search" do
    {:ok, project} =
      Context.ensure_project(%{
        name: "Gamba", slug: "gamba-marker", tracker_kind: "github",
        tracker_config: %{"repo" => "GambaLabs/frontend", "project_id" => "PVT_test"}
      })

    {:ok, _repos} =
      Context.replace_repositories(project.slug, [
        %{github_full_name: "GambaLabs/frontend", role: "primary", workspace_path: "frontend", selected_branch: "development"},
        %{github_full_name: "GambaLabs/backend", role: "backend", workspace_path: "backend", selected_branch: "dev"}
      ])

    {:ok, issue} = Context.create_issue(project.slug, %{title: "Daily tip limit", status: "Human Review"})

    issue
    |> IssueRecord.changeset(%{
      identifier: "GAM-2", remote_number: 1_857,
      remote_url: "https://github.com/GambaLabs/frontend/issues/1857",
      url: "https://github.com/GambaLabs/frontend/issues/1857"
    })
    |> Repo.update!()

    # Workpad block lists the frontend PR; marker search finds the backend PR.
    workpad = SymphonyElixir.Workpad.PullRequestBlock.upsert_block(nil, [
      %{repo: "GambaLabs/frontend", number: 1866, branch: "feat/DailyTipLimit",
        url: "https://github.com/GambaLabs/frontend/pull/1866"}
    ])

    {:ok, _c} = Context.add_comment(project.slug, "GAM-2", workpad)

    assert {:ok, prs} = PullRequests.for_project_issue(project, "GAM-2", client_module: MarkerClientStub)

    pairs = prs |> Enum.map(&{&1.repo, &1.number}) |> Enum.sort()
    assert {"GambaLabs/backend", 3997} in pairs
    assert {"GambaLabs/frontend", 1866} in pairs
  end
```

> Keep the existing `"resolves local identifiers via remote_number"` test and its `ClientStub` unchanged. Remove the now-obsolete `BranchSearchClientStub` and the stub-isolation test added earlier this session.

- [ ] **Step 3: Run test to verify it fails**

Run: `mix test test/symphony_elixir/github/pull_requests_for_project_issue_test.exs`
Expected: FAIL — `for_project_issue/3` does not yet union workpad + marker.

- [ ] **Step 4: Implement — replace heuristic with workpad + marker union**

In `for_project_issue/3`, replace the `branch_prs <- search_branch_linked_prs(...)` clause and merge body with:

```elixir
  def for_project_issue(%Project{} = project, identifier, opts \\ []) when is_binary(identifier) do
    with {:ok, issue_repo} <- IssueRepo.resolve(project, identifier, opts),
         {:ok, number} <- resolve_issue_number(project, identifier),
         {:ok, issue_prs} <-
           for_issue(issue_repo, issue_number_identifier(number), Keyword.put(opts, :annotate, false)) do
      workpad_prs = workpad_pull_requests(project, identifier, opts)
      marker_prs = marker_pull_requests(project, identifier, opts)

      merged =
        (workpad_prs ++ marker_prs ++ issue_prs)
        |> dedupe_by_url()
        |> sort_prs()
        |> annotate_branch_status_per_repo(opts)

      {:ok, merged}
    end
  end
```

Delete the now-unused heuristic helpers: `search_branch_linked_prs/4`,
`branch_search_prefixes/3`, `search_prs_by_head_prefix/3`, `search_prs_by_title/3`,
`pr_hits_from_search_items/2`, `local_branch_name/2`, `prepend_string/2`,
`branch_search_prefixes` and the `configured_repos/1` usages tied to them.
Keep `configured_repos/1` (reused below). Add the deterministic helpers:

```elixir
  defp workpad_pull_requests(%Project{slug: slug} = _project, identifier, opts) do
    case Context.latest_workpad(slug, identifier) do
      {:ok, %{body: body}} when is_binary(body) ->
        body
        |> Workpad.PullRequestBlock.parse()
        |> Enum.map(&enrich_ref(&1, opts))
        |> Enum.reject(&is_nil/1)

      _ ->
        []
    end
  end

  defp marker_pull_requests(%Project{} = project, identifier, opts) do
    key = marker_key(project)
    marker = IssueMarker.marker_line(identifier, key)

    project
    |> configured_repos()
    |> Enum.flat_map(&marker_candidates(&1, marker, opts))
    |> Enum.flat_map(&fetch_search_hit/1)
    |> Enum.filter(&marker_confirmed?(&1, identifier, key))
    |> dedupe_by_url()
  end

  defp marker_key(%Project{} = project) do
    project
    |> ProjectConfig.resolve()
    |> ProjectConfig.source_control_issue_marker_key()
  rescue
    _ -> IssueMarker.default_key()
  end

  defp marker_candidates(repo, marker, opts) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         query = ~s(repo:#{owner}/#{name} type:pr in:body "#{marker}"),
         {:ok, %{body: %{"items" => items}}} <- search_issues(query, opts),
         true <- is_list(items) do
      items
      |> Enum.filter(&is_map/1)
      |> Enum.filter(&(Map.get(&1, "pull_request") != nil))
      |> Enum.map(fn item ->
        number = Map.get(item, "number")
        if is_integer(number) and number > 0, do: {repo, number}, else: nil
      end)
      |> Enum.reject(&is_nil/1)
    else
      _ -> []
    end
  end

  defp marker_confirmed?(pr, identifier, key) do
    body = Map.get(pr, :body)
    wanted = String.downcase(String.trim(identifier))

    body
    |> IssueMarker.extract(key)
    |> Enum.map(&String.downcase/1)
    |> Enum.member?(wanted)
  end

  defp enrich_ref(%{url: url} = ref, opts) when is_binary(url) do
    case ref do
      %{repo: repo, number: number} when is_binary(repo) and is_integer(number) ->
        case for_pull_request(repo, number, Keyword.put(opts, :annotate, false)) do
          {:ok, pr} when is_map(pr) -> pr
          _ -> ref_to_pr(ref)
        end

      _ ->
        ref_to_pr(ref)
    end
  end

  defp enrich_ref(_ref, _opts), do: nil

  defp ref_to_pr(%{repo: repo, number: number, branch: branch, url: url}) do
    %{
      number: number,
      title: nil,
      url: url,
      state: "unknown",
      repo: repo,
      head_ref: branch,
      base_ref: nil,
      is_draft: false,
      merged: false,
      head_sha: nil,
      author: nil,
      created_at: nil,
      updated_at: nil,
      merged_at: nil,
      checks_state: nil,
      pipelines: [],
      statuses: [],
      conversation: [],
      base_behind_by: nil
    }
  end
```

Ensure the module aliases include the new deps (top of file): add
`Workpad.PullRequestBlock`, `IssueMarker`, `ProjectConfig`:

```elixir
  alias SymphonyElixir.GitHub.{BranchStatus, Client, Config, IssueMarker, IssueRepo, RepoSpec}
  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.Workpad.PullRequestBlock
```

Keep the `search_issues/2` helper from earlier (single-arg query form). Confirm
`fetch_search_hit/1` still exists (it does) and `configured_repos/1` remains.

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/github/pull_requests_for_project_issue_test.exs test/symphony_elixir/github/pull_requests_test.exs`
Expected: PASS (both files).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/github/pull_requests.ex elixir/test/symphony_elixir/github/pull_requests_for_project_issue_test.exs
git commit -m "feat(github): deterministic PR discovery via marker + workpad block"
```

---

### Task 6: Finalizer injects the marker into PR bodies

**Files:**
- Modify: `elixir/lib/symphony_elixir/run_contract/finalizer.ex`
- Test: `elixir/test/symphony_elixir/run_contract/finalizer_test.exs` (existing)

- [ ] **Step 1: Write the failing test**

Add to `elixir/test/symphony_elixir/run_contract/finalizer_test.exs`:

```elixir
  test "pull_request_body includes the Symphony-Issue marker" do
    issue = %SymphonyElixir.Issue{identifier: "GAM-9", title: "Daily tip limit", description: "do it"}
    body = SymphonyElixir.RunContract.Finalizer.pull_request_body(issue)

    assert body =~ "Symphony-Issue: GAM-9"
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/run_contract/finalizer_test.exs`
Expected: FAIL — `pull_request_body/1` undefined.

- [ ] **Step 3: Implement**

In `elixir/lib/symphony_elixir/run_contract/finalizer.ex`, add the aliases:

```elixir
  alias SymphonyElixir.GitHub.IssueMarker
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.ProjectConfig
```

Rename the private `pr_body/1` to a public `pull_request_body/1` with a `@spec`,
append the marker, and update its single caller in `create_pull_request/4`:

```elixir
  @doc false
  @spec pull_request_body(Issue.t()) :: String.t()
  def pull_request_body(%Issue{} = issue) do
    description =
      case Map.get(issue, :description) do
        text when is_binary(text) and text != "" -> String.slice(text, 0, 4_000)
        _missing -> "(no issue description)"
      end

    marker = IssueMarker.marker_line(issue.identifier, marker_key(issue))

    """
    ## Summary

    Automated publish for **#{issue.identifier}: #{issue.title}**.

    #{description}

    > ⚠️ Symphony run-contract finalizer: the agent completed work in this
    > workspace but did not publish it. Symphony pushed the branch and opened
    > this PR mechanically. Review with extra care.

    #{marker}
    """
  end

  defp marker_key(%Issue{project_slug: slug}) when is_binary(slug) and slug != "" do
    case Context.get_project(slug) do
      {:ok, project} ->
        ProjectConfig.source_control_issue_marker_key(ProjectConfig.resolve(project))

      _ ->
        IssueMarker.default_key()
    end
  rescue
    _ -> IssueMarker.default_key()
  end

  defp marker_key(_issue), do: IssueMarker.default_key()
```

Update the caller inside `create_pull_request/4`:

```elixir
    File.write!(body_file, pull_request_body(issue))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/run_contract/finalizer_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/run_contract/finalizer.ex elixir/test/symphony_elixir/run_contract/finalizer_test.exs
git commit -m "feat(finalizer): write Symphony-Issue marker into finalizer PRs"
```

---

### Task 7: Monitor reconciles detected PRs onto the task

**Files:**
- Modify: `elixir/lib/symphony_elixir/pull_request_monitor.ex`
- Test: `elixir/test/symphony_elixir/pull_request_monitor_test.exs` (existing)

- [ ] **Step 1: Write the failing test**

Add to `elixir/test/symphony_elixir/pull_request_monitor_test.exs` (reuse the file's existing project/issue setup helpers; create a wait-state issue `GAM-2` mirrored to remote_number 1857 if the file lacks one):

```elixir
  test "process_issue reconciles detected PRs to DB and workpad", %{project: project} do
    prs = [
      %{url: "https://github.com/GambaLabs/backend/pull/3997", number: 3997,
        repo: "GambaLabs/backend", state: "open", head_ref: "symphony/1857", title: "x"}
    ]

    test_pid = self()

    opts = [
      config: %SymphonyElixir.ProjectConfig{
        project_id: project.id, project_slug: project.slug, tracker_kind: "github",
        pr_monitor: %{"enabled" => true}, wait_states: ["Human Review"]
      },
      pull_request_reader: fn _project, _identifier, _opts -> {:ok, prs} end,
      workpad_upsert: fn issue_id, body -> send(test_pid, {:workpad, issue_id, body}); :ok end
    ]

    :ok = SymphonyElixir.PullRequestMonitor.process_issue(project, %{identifier: "GAM-2"}, opts)

    # DB updated
    assert {:ok, [row]} = SymphonyElixir.Tracker.Sync.PullRequests.for_issue(project.slug, "GAM-2")
    assert row.url == "https://github.com/GambaLabs/backend/pull/3997"
    assert row.head_branch == "symphony/1857"

    # Workpad block written, carrying the PR url
    assert_received {:workpad, _issue_id, body}
    assert body =~ "symphony:prs"
    assert body =~ "https://github.com/GambaLabs/backend/pull/3997"
  end
```

> The test stubs `resolve_repo` indirectly via the project's `tracker_config["repo"]`; ensure the test project has `tracker_config: %{"repo" => "GambaLabs/frontend"}` in its setup, and `GAM-2` exists in `Human Review`. If the file's setup does not create these, add them in this test before calling `process_issue/3`.

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/pull_request_monitor_test.exs`
Expected: FAIL — no DB rows / no workpad message (reconcile not implemented).

- [ ] **Step 3: Implement**

In `elixir/lib/symphony_elixir/pull_request_monitor.ex`, add aliases:

```elixir
  alias SymphonyElixir.Tracker
  alias SymphonyElixir.Tracker.Sync.LocalStore
  alias SymphonyElixir.Workpad.PullRequestBlock
```

In `process_issue/3`, call the reconciler right after the reader returns, before the per-PR loop:

```elixir
         {:ok, prs} <- reader.(project, identifier, opts) do
      Logger.info("PR monitor evaluated issue_identifier=#{identifier} project_slug=#{project.slug} prs=#{length(prs)}")

      reconcile_task_pull_requests(project, identifier, prs, opts)
      Enum.each(prs, &process_pr(project, config, repo, identifier, &1, opts))
```

Add the private functions:

```elixir
  defp reconcile_task_pull_requests(project, identifier, prs, opts) do
    records =
      prs
      |> Enum.filter(&is_binary(pr_field(&1, :url)))
      |> Enum.map(fn pr ->
        %{
          remote_id: pr_field(pr, :url),
          url: pr_field(pr, :url),
          number: pr_field(pr, :number),
          title: pr_field(pr, :title),
          state: pr_field(pr, :state) || "unknown",
          repo: pr_field(pr, :repo),
          head_branch: pr_field(pr, :head_ref),
          origin: "auto"
        }
      end)

    if records != [] do
      LocalStore.upsert_discovered_pull_requests(project.id, identifier, records)
      reconcile_workpad_block(project, identifier, records, opts)
    end

    :ok
  rescue
    error ->
      Logger.warning("PR monitor reconcile failed issue=#{identifier} reason=#{inspect(error)}")
      :ok
  end

  defp reconcile_workpad_block(project, identifier, records, opts) do
    upsert_fun = Keyword.get(opts, :workpad_upsert, &Tracker.upsert_workpad/2)

    current =
      case Context.latest_workpad(project.slug, identifier) do
        {:ok, %{body: body}} when is_binary(body) -> body
        _ -> nil
      end

    refs =
      Enum.map(records, fn r ->
        %{repo: r.repo, number: r.number, branch: r.head_branch, url: r.url}
      end)

    new_body = PullRequestBlock.upsert_block(current, refs)

    if new_body != current do
      case Context.get_issue(project.slug, identifier) do
        {:ok, issue} -> upsert_fun.(to_string(issue.id), new_body)
        _ -> :ok
      end
    end

    :ok
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/pull_request_monitor_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/pull_request_monitor.ex elixir/test/symphony_elixir/pull_request_monitor_test.exs
git commit -m "feat(pr-monitor): reconcile detected PRs onto the task (DB + workpad)"
```

---

### Task 8: Documentation & project contract

**Files:**
- Modify: `.claude/skills/workpad/SKILL.md`
- Modify: `gamba-project.yaml`
- Modify: `elixir/README.md`

- [ ] **Step 1: Document the `symphony:prs` block in the workpad skill**

In `.claude/skills/workpad/SKILL.md`, after the `## Structure` section, add:

```markdown
## PR registry block (machine-readable)

When you open or update PRs for this issue, keep a single machine-readable block
at the end of the workpad. Symphony parses it to associate PRs with the task:

\```markdown
<!-- symphony:prs
- repo: <owner>/<name>
  number: <pr_number>
  branch: <head_branch>
  url: <pr_url>
-->
\```

One `- repo:` item per PR (front + back + any others). Symphony also reconciles
this block automatically when its monitor detects PRs, but writing it yourself
makes association immediate.
```

- [ ] **Step 2: Instruct agents to write the marker + block (gamba workflow)**

In `gamba-project.yaml`, inside the `workflow_markdown` front matter, add a
`source_control` section (next to `pr_monitor`):

```yaml
    source_control:
      branch_pattern: "symphony/{issue}"
      pr_title_pattern: "{issue}: {title}"
      issue_marker_key: "Symphony-Issue"
```

And in the workflow body's PR section (where `gh pr create` is described), add:

```markdown
    - Every PR body MUST include the association marker on its own line:
      `Symphony-Issue: {{ issue.identifier }}`
    - Keep the `<!-- symphony:prs ... -->` block in the Codex Workpad updated with
      every PR you open (repo, number, branch, url).
```

- [ ] **Step 3: Document `source_control` in the Elixir README**

In `elixir/README.md`, in the `workflow_markdown` configuration section, add a
short `source_control` subsection describing `branch_pattern`,
`pr_title_pattern`, and `issue_marker_key` (the authoritative PR↔issue link),
noting defaults `symphony/{issue}`, `{issue}: {title}`, `Symphony-Issue`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/workpad/SKILL.md gamba-project.yaml elixir/README.md
git commit -m "docs: declare source_control contract and symphony:prs workpad block"
```

---

### Task 9: Full gates

- [ ] **Step 1: Run the full Elixir gate**

Run (from `elixir/`): `make all`
Expected: format check, lint (Credo), coverage, and Dialyzer all pass.

- [ ] **Step 2: Run spec check**

Run (from `elixir/`): `mix specs.check`
Expected: PASS — every new public `def` has an adjacent `@spec`.

- [ ] **Step 3: Fix any gate failures, then commit**

```bash
git add -A
git commit -m "chore: satisfy gates for declarative PR association"
```

---

## Self-Review

**Spec coverage:**
- Contract (`source_control`) → Task 4 + Task 8.
- Marker build/parse → Task 2; marker discovery → Task 5.
- Workpad block render/parse/upsert → Task 3; discovery via workpad → Task 5; write-back → Task 7.
- Discovery union (workpad + marker + native), heuristic removed → Task 5.
- `head_branch` persistence → Task 1.
- Finalizer writes marker → Task 6.
- Reconcile onto task (DB + workpad, monitor-only, idempotent) → Task 7.
- Legacy PRs (native fallback / manual link) → unchanged paths; no task needed.
- Docs/agent instructions → Task 8.

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The one
"verification-only" step (Task 1 Step 6) explicitly states no code change and why.

**Type consistency:**
- `IssueMarker.marker_line/2` (identifier, key), `IssueMarker.extract/2` (body, key),
  `IssueMarker.default_key/0` — used consistently in Tasks 4, 5, 6.
- `PullRequestBlock.render/1`, `parse/1`, `upsert_block/2` — used consistently in
  Tasks 5, 7; refs use keys `:repo, :number, :branch, :url`.
- PR maps from `parse_pr_node/1` use `:head_ref` (not `:branch`); `render_one/1`
  reads `:branch || :head_ref`; reconcile builds refs with `:branch` from
  `head_ref`. Consistent.
- `ProjectConfig.source_control_issue_marker_key/1` returns the key used by both
  `marker_pull_requests/3` (discovery) and the finalizer.
