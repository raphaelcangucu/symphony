# Multi-PR Issue Association (front + back, cross-repo) Implementation Plan

**Goal:** Let a tracker issue surface one or more associated PRs — including PRs in a different repository — by unioning live GitHub discovery (now cross-repo aware) with PRs persisted in `tracker_pull_requests`, plus a manual link/unlink path, and fix issue #510 to show `clouapp/back#277`.

**Architecture:** Extend `tracker_pull_requests` with `repo` + `origin`. `GitHub.PullRequests.for_issue/3` unions all discovery strategies and stops dropping cross-repo PRs. `PullRequestController.index` discovers live, persists discovered rows (`origin: "auto"`), loads persisted rows, and merges both deduped by URL. New `link`/`unlink` controller actions persist manual associations (`origin: "manual"`). Frontend shows a repo badge, a "link PR" form, and a remove control for manual links.

**Tech Stack:** Elixir/Phoenix, Ecto + SQLite, ExUnit; React/TypeScript (tracker UI), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-multi-pr-issue-association-design.md`

---

## File Structure

- Modify: `elixir/lib/symphony_elixir/tracker/sync/pull_request_record.ex` — add `repo`, `origin`; widen `@states`.
- Create: `elixir/priv/repo/migrations/20260601120000_add_repo_origin_to_tracker_pull_requests.exs` — columns + backfill.
- Modify: `elixir/lib/symphony_elixir/github/pull_requests.ex` — union strategies, cross-repo, `repo` field.
- Create: `elixir/lib/symphony_elixir/github/pull_request_url.ex` — parse a GitHub PR URL.
- Modify: `elixir/lib/symphony_elixir/tracker/sync/local_store.ex` — persist `repo`/`origin`, `link_manual_pull_request/2`, `unlink_pull_request/2`.
- Modify: `elixir/lib/symphony_elixir/tracker/sync/pull_requests.ex` — reader returns `repo`, `origin`.
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_controller.ex` — merge + `link`/`unlink`.
- Modify: `elixir/lib/symphony_elixir_web/router.ex` — `link`/`unlink` routes.
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_record.ex` — `has_many(:pull_requests, ...)`.
- Modify: `elixir/test/symphony_elixir/github/pull_requests_test.exs` — cross-repo now included.
- Create: `elixir/test/symphony_elixir/github/pull_request_url_test.exs`.
- Modify/Create: store + controller tests.
- Modify: `tracker/src/types/pull-request.ts`, `tracker/src/services/pullRequests.ts`, `tracker/src/components/issues/issue-detail/PullRequestTab.tsx`, `tracker/src/components/issues/pull-request/PullRequestPanel.tsx` (key fix).
- Create: `elixir/lib/mix/tasks/symphony.link_pr.ex` — CLI to link #510 ↔ back#277.

---

## Task 1: Schema + migration for `repo` / `origin`

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/sync/pull_request_record.ex:11-33`
- Create: `elixir/priv/repo/migrations/20260601120000_add_repo_origin_to_tracker_pull_requests.exs`
- Test: `elixir/test/symphony_elixir/tracker/sync/pull_request_record_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/sync/pull_request_record_test.exs`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.PullRequestRecordTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Tracker.Sync.PullRequestRecord

  test "accepts repo, origin and the unknown state" do
    cs =
      PullRequestRecord.changeset(%PullRequestRecord{}, %{
        issue_id: 1,
        remote_id: "https://github.com/clouapp/back/pull/277",
        number: 277,
        url: "https://github.com/clouapp/back/pull/277",
        repo: "clouapp/back",
        origin: "manual",
        state: "unknown"
      })

    assert cs.valid?
  end

  test "rejects an unknown origin value" do
    cs = PullRequestRecord.changeset(%PullRequestRecord{}, %{issue_id: 1, remote_id: "x", state: "open", origin: "bogus"})
    refute cs.valid?
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/tracker/sync/pull_request_record_test.exs`
Expected: FAIL — `repo`/`origin` not cast, `unknown`/origin validation missing.

- [ ] **Step 3: Create the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.AddRepoOriginToTrackerPullRequests do
  use Ecto.Migration

  def up do
    alter table(:tracker_pull_requests) do
      add(:repo, :string)
      add(:origin, :string, null: false, default: "auto")
    end

    # Backfill repo from the PR url: https://github.com/<owner>/<name>/pull/<n>
    execute("""
    UPDATE tracker_pull_requests
    SET repo = (
      SELECT substr(
        url,
        length('https://github.com/') + 1,
        instr(substr(url, length('https://github.com/') + 1), '/pull/') - 1
      )
    )
    WHERE url LIKE 'https://github.com/%/pull/%' AND repo IS NULL
    """)
  end

  def down do
    alter table(:tracker_pull_requests) do
      remove(:repo)
      remove(:origin)
    end
  end
end
```

- [ ] **Step 4: Update the schema**

In `pull_request_record.ex` replace the `@states` line and add fields + validation:

```elixir
  @states ~w(open closed merged draft unknown)
  @origins ~w(auto manual)

  schema "tracker_pull_requests" do
    field(:remote_id, :string)
    field(:number, :integer)
    field(:url, :string)
    field(:title, :string)
    field(:state, :string)
    field(:repo, :string)
    field(:origin, :string, default: "auto")
    field(:last_synced_at, :utc_datetime_usec)

    belongs_to(:issue, IssueRecord)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [:issue_id, :remote_id, :number, :url, :title, :state, :repo, :origin, :last_synced_at])
    |> validate_required([:issue_id, :remote_id, :state])
    |> validate_inclusion(:state, @states)
    |> validate_inclusion(:origin, @origins)
    |> unique_constraint([:issue_id, :remote_id])
  end
```

- [ ] **Step 5: Run migration + test**

Run: `cd elixir && mix ecto.migrate && mix test test/symphony_elixir/tracker/sync/pull_request_record_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add elixir/priv/repo/migrations/20260601120000_add_repo_origin_to_tracker_pull_requests.exs elixir/lib/symphony_elixir/tracker/sync/pull_request_record.ex elixir/test/symphony_elixir/tracker/sync/pull_request_record_test.exs
git commit -m "feat(tracker): add repo/origin to tracker_pull_requests"
```

---

## Task 2: GitHub PR URL parser

**Files:**
- Create: `elixir/lib/symphony_elixir/github/pull_request_url.ex`
- Test: `elixir/test/symphony_elixir/github/pull_request_url_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.GitHub.PullRequestUrlTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.PullRequestUrl

  test "parses owner/name/number from a PR url" do
    assert {:ok, %{repo: "clouapp/back", owner: "clouapp", name: "back", number: 277}} =
             PullRequestUrl.parse("https://github.com/clouapp/back/pull/277")
  end

  test "tolerates trailing path and query" do
    assert {:ok, %{number: 277}} =
             PullRequestUrl.parse("https://github.com/clouapp/back/pull/277/files?w=1")
  end

  test "rejects non-PR urls" do
    assert {:error, :invalid_pr_url} = PullRequestUrl.parse("https://github.com/clouapp/back/issues/10")
    assert {:error, :invalid_pr_url} = PullRequestUrl.parse("not a url")
    assert {:error, :invalid_pr_url} = PullRequestUrl.parse(nil)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/github/pull_request_url_test.exs`
Expected: FAIL — module not defined.

- [ ] **Step 3: Implement the parser**

```elixir
defmodule SymphonyElixir.GitHub.PullRequestUrl do
  @moduledoc "Parses a GitHub pull request URL into its owner/name/number parts."

  @pattern ~r{^https?://github\.com/([^/\s]+)/([^/\s]+)/pull/(\d+)}

  @type parsed :: %{repo: String.t(), owner: String.t(), name: String.t(), number: pos_integer()}

  @spec parse(String.t() | nil) :: {:ok, parsed()} | {:error, :invalid_pr_url}
  def parse(url) when is_binary(url) do
    case Regex.run(@pattern, String.trim(url)) do
      [_, owner, name, number] ->
        {:ok, %{repo: "#{owner}/#{name}", owner: owner, name: name, number: String.to_integer(number)}}

      _ ->
        {:error, :invalid_pr_url}
    end
  end

  def parse(_url), do: {:error, :invalid_pr_url}
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/github/pull_request_url_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/pull_request_url.ex elixir/test/symphony_elixir/github/pull_request_url_test.exs
git commit -m "feat(github): add pull request url parser"
```

---

## Task 3: Union discovery + cross-repo + `repo` field

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/pull_requests.ex:28-84` (`@pr_fields`), `:165-208` (resolution), `:241-264` (`parse_pr_node`)
- Modify: `elixir/test/symphony_elixir/github/pull_requests_test.exs:333-379`

- [ ] **Step 1: Update the cross-repo test to expect inclusion**

Replace the test `"ignores cross-repository cross-references and dedups by number"` (lines 333-379) with:

```elixir
    test "includes cross-repository cross-references and dedups by url" do
      request_fun = fn payload, _headers ->
        cond do
          payload["query"] =~ "SymphonyTrackerIssuePullRequests" ->
            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "repository" => %{
                     "issue" => %{
                       "linkedBranches" => %{"nodes" => []},
                       "closedByPullRequestsReferences" => %{"nodes" => []},
                       "timelineItems" => %{
                         "nodes" => [
                           %{
                             "isCrossRepository" => true,
                             "source" =>
                               Map.merge(pr_node(%{}), %{
                                 "__typename" => "PullRequest",
                                 "number" => 999,
                                 "url" => "https://github.com/other/repo/pull/999",
                                 "repository" => %{"nameWithOwner" => "other/repo"}
                               })
                           },
                           %{
                             "isCrossRepository" => false,
                             "source" => Map.put(pr_node(%{}), "__typename", "PullRequest")
                           },
                           %{
                             "isCrossRepository" => false,
                             "source" => Map.put(pr_node(%{}), "__typename", "PullRequest")
                           }
                         ]
                       }
                     }
                   }
                 }
               }
             }}
        end
      end

      assert {:ok, prs} =
               PullRequests.for_issue("acme/app", "508",
                 client_module: TestClient,
                 request_fun: request_fun
               )

      numbers = prs |> Enum.map(& &1.number) |> Enum.sort()
      assert numbers == [503, 999]
      assert Enum.find(prs, &(&1.number == 999)).repo == "other/repo"
    end
```

> Note: the `pr_node/1` helper in this test file builds the base node. Confirm it sets `"url"` and `"number" => 503`; if the helper lacks `"repository"`, the same-repo PRs will derive `repo` from their `url` (still `acme/app`). No change needed to the helper for this assertion.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/github/pull_requests_test.exs -k "cross-repository"`
Expected: FAIL — cross-repo currently filtered; `repo` key absent.

- [ ] **Step 3: Add `repository { nameWithOwner }` to `@pr_fields`**

In `@pr_fields` (starts line 28), add after `url`:

```
  number
  title
  url
  state
  repository { nameWithOwner }
  isDraft
```

- [ ] **Step 4: Union the strategies + drop cross-repo filter**

Replace `resolve_from_issue/4` and `resolve_without_closing_refs/4` (lines 165-181) with:

```elixir
  defp resolve_from_issue(issue, owner, name, opts) do
    closing = extract_closing_prs(issue)
    cross_referenced = extract_cross_referenced_prs(issue)

    branch_prs =
      case fetch_by_branch(extract_branch(issue), owner, name, opts) do
        {:ok, prs} -> prs
        {:error, _reason} -> []
      end

    merged =
      (closing ++ branch_prs ++ cross_referenced)
      |> dedupe_by_url()
      |> sort_prs()

    {:ok, merged}
  end

  defp dedupe_by_url(prs) do
    Enum.uniq_by(prs, fn pr -> pr.url || {pr.repo, pr.number} end)
  end
```

Replace `cross_referenced_pr_node/1` (lines 202-208) with (no `isCrossRepository` filter):

```elixir
  defp cross_referenced_pr_node(%{"source" => %{"__typename" => "PullRequest"} = pr}), do: pr
  defp cross_referenced_pr_node(_event), do: nil
```

Change `extract_closing_prs/1` and `extract_cross_referenced_prs/1` to dedupe by url instead of number (replace `Enum.uniq_by(& &1.number)` in both with `Enum.uniq_by(fn pr -> pr.url || pr.number end)`).

- [ ] **Step 5: Surface `repo` on each PR map**

In `parse_pr_node/1` (line 244 map), add a `repo` key:

```elixir
      author: extract_author(node),
      repo: extract_repo(node),
      created_at: string_or_nil(Map.get(node, "createdAt")),
```

Add the helper near `extract_author/1`:

```elixir
  defp extract_repo(node) do
    case get_in_safe(node, ["repository", "nameWithOwner"]) do
      repo when is_binary(repo) and repo != "" -> repo
      _ -> repo_from_url(string_or_nil(Map.get(node, "url")))
    end
  end

  defp repo_from_url(url) when is_binary(url) do
    case Regex.run(~r{github\.com/([^/]+/[^/]+)/pull/\d+}, url) do
      [_, repo] -> repo
      _ -> nil
    end
  end

  defp repo_from_url(_url), do: nil
```

- [ ] **Step 6: Run the PR discovery tests**

Run: `cd elixir && mix test test/symphony_elixir/github/pull_requests_test.exs`
Expected: PASS. If a prior test asserted branch-error propagation as `{:error, _}`, update it to expect `{:ok, _}` (errors now degrade to the other strategies). Search the file for `{:error,` assertions in `for_issue` and adjust to `{:ok,` where branch fetch was the only failing path.

- [ ] **Step 7: Commit**

```bash
git add elixir/lib/symphony_elixir/github/pull_requests.ex elixir/test/symphony_elixir/github/pull_requests_test.exs
git commit -m "feat(github): union PR strategies and include cross-repo PRs"
```

---

## Task 4: Store helpers (persist repo/origin, link, unlink, read)

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/sync/local_store.ex:56-72`
- Modify: `elixir/lib/symphony_elixir/tracker/sync/pull_requests.ex:35-37`
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_record.ex` (add `has_many`)
- Test: `elixir/test/symphony_elixir/tracker/sync/local_store_pull_requests_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Tracker.Sync.LocalStorePullRequestsTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Tracker.Sync.{LocalStore, PullRequests}
  alias SymphonyElixir.Support.TrackerFixtures

  setup do
    {:ok, issue: TrackerFixtures.github_issue!()}
  end

  test "link_manual_pull_request persists a manual cross-repo PR", %{issue: issue} do
    {:ok, _pr} =
      LocalStore.link_manual_pull_request(issue, %{
        url: "https://github.com/clouapp/back/pull/277",
        repo: "clouapp/back",
        number: 277
      })

    {:ok, [pr]} = PullRequests.for_issue(issue_project_slug(issue), issue.identifier)
    assert pr.repo == "clouapp/back"
    assert pr.origin == "manual"
    assert pr.state == "unknown"
    assert pr.url == "https://github.com/clouapp/back/pull/277"
  end

  test "unlink_pull_request removes a manual PR by url", %{issue: issue} do
    {:ok, _} =
      LocalStore.link_manual_pull_request(issue, %{
        url: "https://github.com/clouapp/back/pull/277",
        repo: "clouapp/back",
        number: 277
      })

    :ok = LocalStore.unlink_pull_request(issue, "https://github.com/clouapp/back/pull/277")
    {:ok, prs} = PullRequests.for_issue(issue_project_slug(issue), issue.identifier)
    assert prs == []
  end

  test "upsert_pull_requests stores repo and origin auto", %{issue: issue} do
    :ok =
      LocalStore.upsert_pull_requests(issue, [
        %{remote_id: "https://github.com/clouapp/front/pull/12", number: 12,
          url: "https://github.com/clouapp/front/pull/12", title: "FE", state: "open",
          repo: "clouapp/front", origin: "auto"}
      ])

    {:ok, [pr]} = PullRequests.for_issue(issue_project_slug(issue), issue.identifier)
    assert pr.repo == "clouapp/front"
    assert pr.origin == "auto"
  end

  defp issue_project_slug(issue) do
    SymphonyElixir.Repo.preload(issue, :project).project.slug
  end
end
```

> If `SymphonyElixir.Support.TrackerFixtures.github_issue!/0` does not exist, create a minimal fixture in `elixir/test/support/tracker_fixtures.ex` that inserts a `github` Project (with `tracker_config: %{"repo" => "clouapp/front", "project_id" => "1"}`), a default `WorkflowStatus`, and an `IssueRecord` with `identifier: "#510"`, returning the issue. Mirror existing fixtures used by other tracker tests (search `test/support` for `Project`/`IssueRecord` inserts and reuse their helpers).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/tracker/sync/local_store_pull_requests_test.exs`
Expected: FAIL — `link_manual_pull_request/2` and `unlink_pull_request/2` undefined; reader lacks `repo`/`origin`.

- [ ] **Step 3: Extend `upsert_pull_requests/2` and add link/unlink**

In `local_store.ex`, the existing `upsert_pull_requests/2` already forwards the full `pr` map into the changeset, so `repo`/`origin` flow through once the schema casts them (Task 1). Add below it:

```elixir
  @spec link_manual_pull_request(IssueRecord.t(), map()) ::
          {:ok, PullRequestRecord.t()} | {:error, Ecto.Changeset.t()}
  def link_manual_pull_request(%IssueRecord{} = issue, %{url: url} = attrs) when is_binary(url) do
    base = %{
      issue_id: issue.id,
      remote_id: url,
      url: url,
      number: Map.get(attrs, :number),
      repo: Map.get(attrs, :repo),
      title: Map.get(attrs, :title) || manual_title(Map.get(attrs, :number)),
      state: Map.get(attrs, :state) || "unknown",
      origin: "manual",
      last_synced_at: DateTime.utc_now()
    }

    case Repo.get_by(PullRequestRecord, issue_id: issue.id, remote_id: url) do
      nil -> %PullRequestRecord{}
      %PullRequestRecord{} = existing -> existing
    end
    |> PullRequestRecord.changeset(base)
    |> Repo.insert_or_update()
  end

  @spec unlink_pull_request(IssueRecord.t(), String.t()) :: :ok
  def unlink_pull_request(%IssueRecord{} = issue, url) when is_binary(url) do
    Repo.delete_all(
      from(pr in PullRequestRecord, where: pr.issue_id == ^issue.id and pr.remote_id == ^url)
    )

    :ok
  end

  defp manual_title(number) when is_integer(number), do: "##{number}"
  defp manual_title(_number), do: nil
```

- [ ] **Step 4: Extend the reader's `to_map/1`**

In `pull_requests.ex` replace `to_map/1` and the `@type`:

```elixir
  @type pr :: %{
          remote_id: String.t(),
          number: integer() | nil,
          url: String.t() | nil,
          title: String.t() | nil,
          state: String.t(),
          repo: String.t() | nil,
          origin: String.t()
        }
```

```elixir
  defp to_map(%PullRequestRecord{} = pr) do
    %{
      remote_id: pr.remote_id,
      number: pr.number,
      url: pr.url,
      title: pr.title,
      state: pr.state,
      repo: pr.repo,
      origin: pr.origin
    }
  end
```

- [ ] **Step 5: Add the association on `IssueRecord`**

In `issue_record.ex`, alongside the other `has_many` lines, add:

```elixir
    has_many(:pull_requests, SymphonyElixir.Tracker.Sync.PullRequestRecord, foreign_key: :issue_id)
```

- [ ] **Step 6: Run the store tests**

Run: `cd elixir && mix test test/symphony_elixir/tracker/sync/local_store_pull_requests_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add elixir/lib/symphony_elixir/tracker/sync/local_store.ex elixir/lib/symphony_elixir/tracker/sync/pull_requests.ex elixir/lib/symphony_elixir/local_tracker/issue_record.ex elixir/test/symphony_elixir/tracker/sync/local_store_pull_requests_test.exs
git commit -m "feat(tracker): persist + link/unlink pull requests with repo/origin"
```

---

## Task 5: Controller merge + link/unlink endpoints

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex:65-66`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/pull_request_controller_test.exs`

- [ ] **Step 1: Write the failing controller test**

Add to (or create) the controller test file:

```elixir
  test "merges a manual cross-repo PR with live discovery", %{conn: conn} do
    issue = SymphonyElixir.Support.TrackerFixtures.github_issue!(identifier: "#510")
    slug = SymphonyElixir.Repo.preload(issue, :project).project.slug

    {:ok, _} =
      SymphonyElixir.Tracker.Sync.LocalStore.link_manual_pull_request(issue, %{
        url: "https://github.com/clouapp/back/pull/277",
        repo: "clouapp/back",
        number: 277
      })

    conn = get(conn, "/api/tracker/v1/projects/#{slug}/issues/510/pull_requests")
    body = json_response(conn, 200)

    urls = Enum.map(body["data"], & &1["url"])
    assert "https://github.com/clouapp/back/pull/277" in urls

    manual = Enum.find(body["data"], &(&1["url"] == "https://github.com/clouapp/back/pull/277"))
    assert manual["repo"] == "clouapp/back"
    assert manual["origin"] == "manual"
  end

  test "link then unlink a PR", %{conn: conn} do
    issue = SymphonyElixir.Support.TrackerFixtures.github_issue!(identifier: "#510")
    slug = SymphonyElixir.Repo.preload(issue, :project).project.slug
    url = "https://github.com/clouapp/back/pull/277"

    conn = post(conn, "/api/tracker/v1/projects/#{slug}/issues/510/pull_requests/link", %{url: url})
    assert json_response(conn, 200)["data"]["url"] == url

    conn = delete(build_conn(), "/api/tracker/v1/projects/#{slug}/issues/510/pull_requests/link", %{url: url})
    assert json_response(conn, 200)["data"]["unlinked"] == true
  end
```

> The full API prefix is `/api/tracker/v1` (confirm by reading `router.ex` scope around line 30). If the test setup lacks a GitHub token, live discovery returns `available: true` but `[]` data; the merge must still surface the manual PR. The existing controller test file likely stubs `PullRequests`; follow its `setup` to inject a `client_module`/token. If no such file exists, create it mirroring `comment_controller_test.exs` patterns.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/pull_request_controller_test.exs`
Expected: FAIL — manual PR not surfaced; `link`/`unlink` routes/actions missing.

- [ ] **Step 3: Add routes**

In `router.ex`, after line 65 (`get(... pull_requests ...)`) add:

```elixir
    post("/projects/:project_slug/issues/:identifier/pull_requests/link", PullRequestController, :link)
    delete("/projects/:project_slug/issues/:identifier/pull_requests/link", PullRequestController, :unlink)
```

- [ ] **Step 4: Rewrite the controller**

Replace `pull_request_controller.ex` body with:

```elixir
defmodule SymphonyElixirWeb.Tracker.PullRequestController do
  @moduledoc """
  Endpoint exposing the pull request(s) related to an issue.

  `index` merges live GitHub discovery (CI pipelines, jobs, statuses,
  conversation) with PRs persisted in `tracker_pull_requests` (manual links and
  previously discovered rows), deduped by URL. `link`/`unlink` manage manual
  cross-repo associations that live discovery cannot find (e.g. no App access).
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.{PullRequests, PullRequestUrl}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.Sync.{LocalStore, PullRequests, as: SyncPullRequests}
  alias SymphonyElixirWeb.TrackerErrors

  require Logger

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Context.get_project(project_slug) do
      {:ok, project} -> respond(conn, project, project_slug, identifier)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec link(Conn.t(), map()) :: Conn.t()
  def link(conn, %{"project_slug" => project_slug, "identifier" => identifier, "url" => url}) do
    with {:ok, parsed} <- PullRequestUrl.parse(url),
         {:ok, issue} <- Context.get_issue(project_slug, identifier),
         {:ok, pr} <- LocalStore.link_manual_pull_request(issue, %{url: url, repo: parsed.repo, number: parsed.number}) do
      json(conn, %{data: %{url: pr.url, number: pr.number, repo: pr.repo, state: pr.state, origin: pr.origin}})
    else
      {:error, :invalid_pr_url} -> error(conn, 422, "Invalid GitHub pull request URL.")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def link(conn, _params), do: error(conn, 422, "A pull request URL is required.")

  @spec unlink(Conn.t(), map()) :: Conn.t()
  def unlink(conn, %{"project_slug" => project_slug, "identifier" => identifier, "url" => url}) do
    with {:ok, issue} <- Context.get_issue(project_slug, identifier),
         :ok <- LocalStore.unlink_pull_request(issue, url) do
      json(conn, %{data: %{unlinked: true}})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def unlink(conn, _params), do: error(conn, 422, "A pull request URL is required.")

  defp respond(conn, project, project_slug, identifier) do
    case PullRequests.resolve_repo(project) do
      {:ok, repo} -> respond_github(conn, repo, project_slug, identifier)
      {:error, _reason} -> json(conn, %{data: persisted(project_slug, identifier), supported: true, available: true})
    end
  end

  defp respond_github(conn, repo, project_slug, identifier) do
    if PullRequests.available?() do
      live = discover_live(repo, project_slug, identifier)
      json(conn, %{data: merge(live, persisted(project_slug, identifier)), supported: true, available: true})
    else
      json(conn, %{data: persisted(project_slug, identifier), supported: true, available: false})
    end
  end

  defp discover_live(repo, project_slug, identifier) do
    case PullRequests.for_issue(repo, identifier) do
      {:ok, prs} ->
        persist_discovered(project_slug, identifier, prs)
        Enum.map(prs, fn pr -> pr |> Map.put_new(:origin, "auto") end)

      {:error, reason} ->
        Logger.warning("PR lookup failed for #{identifier}: #{inspect(reason)}")
        []
    end
  end

  defp persist_discovered(project_slug, identifier, prs) do
    with {:ok, issue} <- Context.get_issue(project_slug, identifier) do
      records =
        prs
        |> Enum.filter(&is_binary(&1[:url]))
        |> Enum.map(fn pr ->
          %{
            remote_id: pr.url,
            number: pr[:number],
            url: pr.url,
            title: pr[:title],
            state: pr[:state] || "unknown",
            repo: pr[:repo],
            origin: "auto"
          }
        end)

      LocalStore.upsert_pull_requests(issue, records)
    end

    :ok
  end

  defp persisted(project_slug, identifier) do
    case SyncPullRequests.for_issue(project_slug, identifier) do
      {:ok, prs} -> Enum.map(prs, &persisted_to_pr_map/1)
    end
  end

  defp persisted_to_pr_map(pr) do
    %{
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      repo: pr.repo,
      origin: pr.origin,
      pipelines: [],
      statuses: [],
      conversation: [],
      base_behind_by: nil
    }
  end

  defp merge(live, persisted) do
    live_urls = live |> Enum.map(& &1[:url]) |> Enum.reject(&is_nil/1) |> MapSet.new()
    extras = Enum.reject(persisted, fn pr -> pr.url && MapSet.member?(live_urls, pr.url) end)
    live ++ extras
  end

  defp error(conn, status, message) do
    conn
    |> put_status(status)
    |> json(%{error: %{message: message}})
  end
end
```

> The `alias ... PullRequests` clashes: `GitHub.PullRequests` and `Tracker.Sync.PullRequests`. Use `alias SymphonyElixir.Tracker.Sync.PullRequests, as: SyncPullRequests` on its own line (not inside the brace group). Fix the alias block to:
> ```elixir
> alias SymphonyElixir.GitHub.{PullRequests, PullRequestUrl}
> alias SymphonyElixir.LocalTracker.Context
> alias SymphonyElixir.Tracker.Sync.LocalStore
> alias SymphonyElixir.Tracker.Sync.PullRequests, as: SyncPullRequests
> ```

- [ ] **Step 5: Run controller tests**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/pull_request_controller_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/test/symphony_elixir_web/controllers/tracker/pull_request_controller_test.exs
git commit -m "feat(tracker): merge live + persisted PRs and add manual link/unlink"
```

---

## Task 6: Frontend — repo badge, link form, remove control

**Files:**
- Modify: `tracker/src/types/pull-request.ts:51-76`
- Modify: `tracker/src/services/pullRequests.ts:54-178`
- Modify: `tracker/src/components/issues/issue-detail/PullRequestTab.tsx`
- Modify: `tracker/src/components/issues/pull-request/PullRequestPanel.tsx` (key/badge)

- [ ] **Step 1: Extend the types**

In `pull-request.ts`, add to `BackendPullRequestDto`? (no — that's in service). In `PullRequest` interface add:

```typescript
  repo: string | null;
  origin: "auto" | "manual";
```

- [ ] **Step 2: Extend the service DTO + normalizer + add link/unlink**

In `pullRequests.ts` `BackendPullRequestDto` add:

```typescript
  repo?: string | null;
  origin?: string | null;
```

In `normalizePullRequest` add:

```typescript
    repo: dto.repo ?? null,
    origin: dto.origin === "manual" ? "manual" : "auto",
```

Append link/unlink functions:

```typescript
export async function linkPullRequest(
  projectSlug: string,
  identifier: string,
  url: string,
): Promise<void> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const issueIdentifier = normalizeIssueIdentifier(identifier);
  if (!issueIdentifier) throw new Error("identifier is required");
  if (!url.trim()) throw new Error("url is required");

  await http.post(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(issueIdentifier)}/pull_requests/link`,
    ),
    { url: url.trim() },
  );
}

export async function unlinkPullRequest(
  projectSlug: string,
  identifier: string,
  url: string,
): Promise<void> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const issueIdentifier = normalizeIssueIdentifier(identifier);
  if (!issueIdentifier) throw new Error("identifier is required");

  await http.delete(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(issueIdentifier)}/pull_requests/link`,
    ),
    { data: { url } },
  );
}
```

> Confirm `http` (axios-like) supports `delete(url, { data })`. If `http` is a thin wrapper without a body on delete, change the route to accept the url as a query param and send `http.delete(path + "?url=" + encodeURIComponent(url))`; update the controller `unlink` to read `conn.query_params["url"]` accordingly.

- [ ] **Step 3: Add link form + repo badge + remove in `PullRequestTab.tsx`**

Import the new service fns and `useState`. Add a controlled input + "Link PR" button above the list, calling `linkPullRequest` then `onRefresh`. Pass `onRemove` to each panel for `origin === "manual"`:

```tsx
import { linkPullRequest, requestPullRequestFix, unlinkPullRequest } from "@/services/pullRequests";
```

Add inside the component before `return`:

```tsx
  const [linkUrl, setLinkUrl] = useState("");
  const [linking, setLinking] = useState(false);

  async function handleLink() {
    if (linking || !linkUrl.trim()) return;
    setLinking(true);
    try {
      await linkPullRequest(projectSlug, issue.identifier, linkUrl);
      setLinkUrl("");
      toast.success("Pull request linked.");
      onRefresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not link the pull request.");
    } finally {
      setLinking(false);
    }
  }

  async function handleRemove(url: string | null) {
    if (!url) return;
    try {
      await unlinkPullRequest(projectSlug, issue.identifier, url);
      toast.success("Pull request unlinked.");
      onRefresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not unlink the pull request.");
    }
  }
```

Render a link row (place it above the list, and also render it inside the empty-state branch so users can link when nothing is shown):

```tsx
  const linkRow = (
    <div className="flex items-center gap-2">
      <input
        type="url"
        value={linkUrl}
        onChange={(e) => setLinkUrl(e.target.value)}
        placeholder="https://github.com/owner/repo/pull/123"
        className="flex-1 rounded-md border px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={() => void handleLink()}
        disabled={linking || !linkUrl.trim()}
        className="rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60"
      >
        {linking ? "Linking…" : "Link PR"}
      </button>
    </div>
  );
```

Replace the `pullRequests.length === 0` empty-state body to include `{linkRow}` and replace the final list render to include `{linkRow}` and pass repo + remove to the panel:

```tsx
      {pullRequests.map((pr) => (
        <PullRequestPanel
          key={pr.url ?? `${pr.repo}#${pr.number}`}
          pullRequest={pr}
          projectSlug={projectSlug}
          issueIdentifier={issue.identifier}
          onRefresh={onRefresh}
          onRemove={pr.origin === "manual" ? () => void handleRemove(pr.url) : undefined}
        />
      ))}
```

- [ ] **Step 4: Show repo badge + optional remove in `PullRequestPanel.tsx`**

Read the file first, then: accept an optional `onRemove?: () => void` prop; render `pullRequest.repo` as a small badge near the PR title (e.g. `<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{pullRequest.repo}</span>`), and when `onRemove` is set render an "x" button that calls it. Keep styling consistent with existing badges in that file.

- [ ] **Step 5: Run frontend checks**

Run: `cd tracker && npm run lint && npm run typecheck && npm test -- pullRequests`
Expected: PASS (fix any type gaps — e.g. add `repo`/`origin` to any PR test fixtures that build a full `PullRequest`).

- [ ] **Step 6: Commit**

```bash
git add tracker/src/types/pull-request.ts tracker/src/services/pullRequests.ts tracker/src/components/issues/issue-detail/PullRequestTab.tsx tracker/src/components/issues/pull-request/PullRequestPanel.tsx
git commit -m "feat(tracker-ui): repo badge, manual PR link/unlink"
```

---

## Task 7: CLI task to link issue #510 ↔ clouapp/back#277

**Files:**
- Create: `elixir/lib/mix/tasks/symphony.link_pr.ex`

- [ ] **Step 1: Implement the mix task**

```elixir
defmodule Mix.Tasks.Symphony.LinkPr do
  @shortdoc "Manually links a GitHub PR url to a tracker issue"
  @moduledoc """
  Usage:

      mix symphony.link_pr <project_slug> <issue_identifier> <pr_url>

  Example:

      mix symphony.link_pr clouapp-front "#510" https://github.com/clouapp/back/pull/277
  """
  use Mix.Task

  alias SymphonyElixir.GitHub.PullRequestUrl
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.Sync.LocalStore

  @impl Mix.Task
  def run([project_slug, identifier, url]) do
    Mix.Task.run("app.start")

    with {:ok, parsed} <- PullRequestUrl.parse(url),
         {:ok, issue} <- Context.get_issue(project_slug, identifier),
         {:ok, pr} <- LocalStore.link_manual_pull_request(issue, %{url: url, repo: parsed.repo, number: parsed.number}) do
      Mix.shell().info("Linked #{pr.repo}##{pr.number} to #{project_slug}/#{identifier}")
    else
      {:error, reason} -> Mix.raise("Could not link PR: #{inspect(reason)}")
    end
  end

  def run(_args), do: Mix.raise("Usage: mix symphony.link_pr <project_slug> <issue_identifier> <pr_url>")
end
```

- [ ] **Step 2: Verify it compiles**

Run: `cd elixir && mix compile`
Expected: no warnings/errors for the new task.

- [ ] **Step 3: Link #510 (run against the real DB)**

First confirm the front project slug:

Run: `cd elixir && mix run -e 'SymphonyElixir.LocalTracker.Context.list_projects() |> Enum.each(fn p -> IO.puts("#{p.slug} -> #{inspect(p.tracker_config)}") end)'`
(Adjust if `list_projects/0` differs — read `local_tracker/context.ex` for the exact listing function.)

Then:

Run: `cd elixir && mix symphony.link_pr <front_slug> "#510" https://github.com/clouapp/back/pull/277`
Expected: `Linked clouapp/back#277 to <front_slug>/#510`

- [ ] **Step 4: Verify in the API**

Run: `cd elixir && mix run -e 'IO.inspect(SymphonyElixir.Tracker.Sync.PullRequests.for_issue("<front_slug>", "#510"))'`
Expected: a list containing the `clouapp/back/pull/277` entry with `origin: "manual"`.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/mix/tasks/symphony.link_pr.ex
git commit -m "feat(tracker): add mix task to manually link a PR to an issue"
```

---

## Final Validation

- [ ] Run full Elixir gate: `cd elixir && make all` (format, lint, coverage, dialyzer) and `mix specs.check`. Add `@spec` to every new public `def`. Fix any dialyzer findings.
- [ ] Run frontend gate: `cd tracker && npm run lint && npm run typecheck && npm test`.
- [ ] Manually open issue #510 in the tracker UI → the "Pull Requests" tab shows `clouapp/back#277` with a `clouapp/back` badge and a remove control; the link form accepts a new PR URL.

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), cross-repo union (Task 3), persisted store + link/unlink (Task 4), merge endpoint + manual endpoints (Task 5), frontend badge/link/remove (Task 6), #510 fix (Task 7). URL parser (Task 2) supports Tasks 5 & 7.
- **Decision vs spec:** manual link stores `state: "unknown"` without an extra GitHub enrichment call (the spec's "best-effort enrich" is satisfied by the merge step enriching from live discovery when the App can see the PR; for #510/`back` it stays `unknown` due to the 404 — the accepted outcome). No new single-PR GitHub API is introduced.
- **Dedupe consistency:** discovery dedupes by `url || {repo, number}`; merge dedupes by `url`; manual `remote_id == url`; auto persisted `remote_id == url`. All consistent.
- **Type consistency:** `link_manual_pull_request/2`, `unlink_pull_request/2`, `upsert_pull_requests/2`, `PullRequestUrl.parse/1`, reader `to_map/1` keys (`repo`, `origin`) match across Elixir tasks; `repo`/`origin` added to TS `PullRequest`, DTO, and normalizer.
