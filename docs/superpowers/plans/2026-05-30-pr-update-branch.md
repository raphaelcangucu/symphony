# "Update branch" (behind-base detection + merge) Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps.
> One plan task per fresh session (user preference). Review between tasks. This
> repo uses **mise** for Elixir — prefix every backend command with
> `mise exec -- ` (e.g. `mise exec -- mix test ...`). Frontend lives in
> `tracker/` and uses npm + vitest. Run backend commands from `elixir/`.

**Goal:** Detect when a linked PR's branch is behind its base branch and add an
"Update branch" button on that PR that merges the base in (via GitHub's
update-branch REST endpoint), then refreshes so CI status can be followed.

**Architecture:** Backend computes `base_behind_by` per open PR using REST
`compare/{base}...{head}` and exposes it in the PR JSON. A new POST endpoint calls
`PUT /repos/{owner}/{repo}/pulls/{number}/update-branch` (merge only). Frontend
shows the button when `baseBehindBy > 0`, posts to the endpoint, toasts, and calls
the existing `onRefresh` so the 20s poll tracks the re-run.

**Tech Stack:** Elixir/Phoenix (Req HTTP, ExUnit), React/TypeScript (axios, vitest).

**Spec:** `docs/superpowers/specs/2026-05-30-pr-update-branch-design.md`

---

## File Structure

**Backend — create**
- `elixir/lib/symphony_elixir/github/branch_status.ex` — `behind_by/4`.
- `elixir/lib/symphony_elixir/pull_request_branch_update.ex` — `update/3`.
- `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_branch_controller.ex`.
- `elixir/test/symphony_elixir/github/branch_status_test.exs`
- `elixir/test/symphony_elixir/pull_request_branch_update_test.exs`
- `elixir/test/symphony_elixir_web/controllers/tracker/pull_request_branch_controller_test.exs`

**Backend — modify**
- `elixir/lib/symphony_elixir/github/client.ex` — add `rest_put/3`.
- `elixir/lib/symphony_elixir/github/pull_requests.ex` — `base_behind_by` default +
  `annotate_branch_status/3` + wire into `for_issue/3`.
- `elixir/lib/symphony_elixir_web/tracker_errors.ex` — `:update_branch_conflict`,
  `:invalid_pr_number`.
- `elixir/lib/symphony_elixir_web/router.ex` — new route.
- `elixir/test/symphony_elixir/github/client_test.exs` — `rest_put/3` tests.
- `elixir/test/symphony_elixir/github/pull_requests_test.exs` — annotate test.

**Frontend — modify**
- `tracker/src/types/pull-request.ts` — `baseBehindBy` + `UpdateBranchResult`.
- `tracker/src/services/pullRequests.ts` — normalize field + `updatePullRequestBranch`.
- `tracker/src/components/issues/pull-request/PullRequestPanel.tsx` — button.
- `tracker/src/components/issues/issue-detail/PullRequestTab.tsx` — pass props.
- `tracker/src/services/__tests__/pullRequests.updateBranch.test.ts` — service test.

---

## Task 1: `GitHub.BranchStatus.behind_by/4`

**Files:**
- Create: `elixir/lib/symphony_elixir/github/branch_status.ex`
- Test: `elixir/test/symphony_elixir/github/branch_status_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.GitHub.BranchStatusTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.BranchStatus

  defmodule StubClient do
    def rest_get(path, opts) do
      send(self(), {:rest_get, path})
      Keyword.fetch!(opts, :request_fun).(nil, nil)
    end
  end

  describe "behind_by/4" do
    test "returns behind_by from the compare payload and hits the compare path" do
      request_fun = fn _url, _headers ->
        {:ok, %{status: 200, body: %{"status" => "diverged", "ahead_by" => 2, "behind_by" => 1}}}
      end

      assert {:ok, 1} =
               BranchStatus.behind_by("acme/app", "homolog", "feat/508",
                 client_module: StubClient,
                 request_fun: request_fun
               )

      assert_received {:rest_get, "/repos/acme/app/compare/homolog...feat/508"}
    end

    test "treats an unexpected body as an error" do
      request_fun = fn _url, _headers -> {:ok, %{status: 200, body: "not-json"}} end

      assert {:error, :unexpected_compare_body} =
               BranchStatus.behind_by("acme/app", "main", "feat/x",
                 client_module: StubClient,
                 request_fun: request_fun
               )
    end

    test "propagates client errors" do
      request_fun = fn _url, _headers -> {:error, {:github_api_status, 404}} end

      assert {:error, {:github_api_status, 404}} =
               BranchStatus.behind_by("acme/app", "main", "fork:feat",
                 client_module: StubClient,
                 request_fun: request_fun
               )
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- mix test test/symphony_elixir/github/branch_status_test.exs`
Expected: FAIL — module `SymphonyElixir.GitHub.BranchStatus` is not available.

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.GitHub.BranchStatus do
  @moduledoc """
  Computes how many commits a pull request's head branch is behind its base
  branch using GitHub's REST compare endpoint
  (`GET /repos/{owner}/{repo}/compare/{base}...{head}`). `behind_by > 0` means the
  branch can be updated with the base. GitHub-backed projects only.
  """

  alias SymphonyElixir.GitHub.{Client, RepoSpec}

  @spec behind_by(String.t(), String.t(), String.t(), keyword()) ::
          {:ok, non_neg_integer()} | {:error, term()}
  def behind_by(repo, base, head, opts \\ [])
      when is_binary(repo) and is_binary(base) and is_binary(head) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo) do
      client = Keyword.get(opts, :client_module, default_client())
      rest_opts = Keyword.take(opts, [:request_fun])
      path = "/repos/#{owner}/#{name}/compare/#{base}...#{head}"

      case client.rest_get(path, rest_opts) do
        {:ok, %{body: %{"behind_by" => behind}}} when is_integer(behind) and behind >= 0 ->
          {:ok, behind}

        {:ok, %{body: _other}} ->
          {:error, :unexpected_compare_body}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp default_client, do: Application.get_env(:symphony_elixir, :github_client_module, Client)
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec -- mix test test/symphony_elixir/github/branch_status_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Format + commit**

```bash
mise exec -- mix format lib/symphony_elixir/github/branch_status.ex test/symphony_elixir/github/branch_status_test.exs
git add elixir/lib/symphony_elixir/github/branch_status.ex elixir/test/symphony_elixir/github/branch_status_test.exs
git commit -m "feat(github): add BranchStatus.behind_by/4 for compare-based behind detection"
```

---

## Task 2: `GitHub.Client.rest_put/3`

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/client.ex` (add after `rest_get/2`, ~line 446; add `put_rest_request/3` near `get_rest_request/2`, ~line 1300)
- Test: `elixir/test/symphony_elixir/github/client_test.exs` (add a `describe "rest_put/3"` block)

- [ ] **Step 1: Write the failing test**

The module is `SymphonyElixir.GitHub.ClientRestTest` and already has a top-level
`setup` that sets `GITHUB_TOKEN` to `"test-token"` and deletes it on exit. Append
these three tests just before the module's final `end` (no extra setup needed):

```elixir
  test "rest_put sends a PUT with auth headers + JSON body, returns 202 ok" do
    request_fun = fn url, headers, body ->
      send(self(), {:put, url, headers, body})
      {:ok, %{status: 202, body: %{}}}
    end

    assert {:ok, %{status: 202}} =
             Client.rest_put("/repos/acme/app/pulls/9/update-branch", %{}, request_fun: request_fun)

    assert_received {:put, "https://api.github.com/repos/acme/app/pulls/9/update-branch", headers, %{}}
    assert {"Authorization", "Bearer test-token"} in headers
    assert {"X-GitHub-Api-Version", "2022-11-28"} in headers
  end

  test "rest_put maps a 422 to a github_api_status error" do
    request_fun = fn _url, _headers, _body -> {:ok, %{status: 422, body: %{}}} end

    assert {:error, {:github_api_status, 422}} =
             Client.rest_put("/repos/acme/app/pulls/9/update-branch", %{}, request_fun: request_fun)
  end

  test "rest_put returns missing token error when unset" do
    System.delete_env("GITHUB_TOKEN")

    assert {:error, :missing_github_token} =
             Client.rest_put("/repos/acme/app/pulls/9/update-branch", %{},
               request_fun: fn _u, _h, _b -> {:ok, %{status: 202, body: %{}}} end
             )
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- mix test test/symphony_elixir/github/client_test.exs`
Expected: FAIL — `Client.rest_put/3` is undefined.

- [ ] **Step 3: Write minimal implementation**

Add this function in `client.ex` immediately after `rest_get/2` (after the `end` on ~line 446):

```elixir
  @spec rest_put(String.t(), map(), keyword()) ::
          {:ok, %{status: pos_integer(), body: term()}} | {:error, term()}
  def rest_put(path, body \\ %{}, opts \\ [])
      when is_binary(path) and is_map(body) and is_list(opts) do
    request_fun = Keyword.get(opts, :request_fun, &put_rest_request/3)
    url = @rest_endpoint <> path

    with {:ok, token} <- require_token(),
         headers = rest_headers(token),
         {:ok, %{status: status, body: resp}} when status in 200..299 <-
           request_fun.(url, headers, body) do
      {:ok, %{status: status, body: resp}}
    else
      {:error, :missing_github_token} = error -> error
      {:ok, %{status: status}} -> {:error, {:github_api_status, status}}
      {:error, reason} -> {:error, {:github_api_request, reason}}
    end
  end
```

Add this private helper next to `get_rest_request/2` (~line 1300):

```elixir
  defp put_rest_request(url, headers, body) do
    Req.put(url, headers: headers, json: body, connect_options: [timeout: 30_000])
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec -- mix test test/symphony_elixir/github/client_test.exs`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
mise exec -- mix format lib/symphony_elixir/github/client.ex test/symphony_elixir/github/client_test.exs
git add elixir/lib/symphony_elixir/github/client.ex elixir/test/symphony_elixir/github/client_test.exs
git commit -m "feat(github): add Client.rest_put/3 for authenticated REST writes"
```

---

## Task 3: Expose `base_behind_by` on PRs (`PullRequests.annotate_branch_status/3`)

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/pull_requests.ex`
  - Add `base_behind_by: nil` to the map in `parse_pr_node/1` (~line 243).
  - Wire `annotate_branch_status/3` into `for_issue/3` (~line 133) and add the
    helpers.
  - Add `alias` for `BranchStatus`.
- Test: `elixir/test/symphony_elixir/github/pull_requests_test.exs` (add a new
  `describe "annotate_branch_status/3"` block; reuse `TestClient`/`pr_node`).

- [ ] **Step 1: Write the failing test**

Add a test client that implements BOTH `graphql/3` and `rest_get/2`, plus the
describe block. Place near the top of the module (after the existing `TestClient`)
and before the final `end`:

```elixir
  defmodule BranchTestClient do
    @moduledoc false

    def graphql(query, variables, opts) do
      request_fun = Keyword.fetch!(opts, :request_fun)

      case request_fun.(%{"query" => query, "variables" => variables}, []) do
        {:ok, %{status: 200, body: body}} -> {:ok, body}
        {:error, _reason} = error -> error
      end
    end

    def rest_get(path, opts) do
      Keyword.fetch!(opts, :request_fun).(path, nil)
    end
  end
```

```elixir
  describe "annotate_branch_status/3" do
    test "sets base_behind_by for an open PR and leaves merged PRs nil" do
      open_pr = %{number: 1, state: "open", base_ref: "homolog", head_ref: "feat/508", base_behind_by: nil}
      merged_pr = %{number: 2, state: "merged", base_ref: "homolog", head_ref: "old", base_behind_by: nil}

      rest_fun = fn "/repos/acme/app/compare/homolog...feat/508", _h ->
        {:ok, %{status: 200, body: %{"behind_by" => 3}}}
      end

      assert [%{number: 1, base_behind_by: 3}, %{number: 2, base_behind_by: nil}] =
               PullRequests.annotate_branch_status([open_pr, merged_pr], "acme/app",
                 client_module: BranchTestClient,
                 branch_status_request_fun: rest_fun
               )
    end

    test "swallows compare errors as nil" do
      open_pr = %{number: 1, state: "open", base_ref: "main", head_ref: "feat/x", base_behind_by: nil}
      rest_fun = fn _path, _h -> {:error, {:github_api_status, 404}} end

      assert [%{number: 1, base_behind_by: nil}] =
               PullRequests.annotate_branch_status([open_pr], "acme/app",
                 client_module: BranchTestClient,
                 branch_status_request_fun: rest_fun
               )
    end

    test "skips annotation when the client has no rest_get/2" do
      open_pr = %{number: 1, state: "open", base_ref: "main", head_ref: "feat/x", base_behind_by: nil}

      assert [%{number: 1, base_behind_by: nil}] =
               PullRequests.annotate_branch_status([open_pr], "acme/app", client_module: TestClient)
    end
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- mix test test/symphony_elixir/github/pull_requests_test.exs`
Expected: FAIL — `PullRequests.annotate_branch_status/3` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `pull_requests.ex`:

3a. Add the alias (line 19 area):

```elixir
  alias SymphonyElixir.GitHub.{BranchStatus, Client, Config, RepoSpec}
```

3b. Add `base_behind_by: nil` to the map literal in `parse_pr_node/1` (add the
line right after `conversation: build_conversation(node)`):

```elixir
      conversation: build_conversation(node),
      base_behind_by: nil
    }
  end
```

3c. Replace the binary clause of `for_issue/3` (~lines 133-138) so it annotates:

```elixir
  def for_issue(repo, identifier, opts) when is_binary(repo) and is_binary(identifier) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- parse_issue_number(identifier),
         {:ok, prs} <- fetch_for_issue(owner, name, number, opts) do
      {:ok, annotate_branch_status(prs, repo, opts)}
    end
  end
```

3d. Add the public function + private helpers (place after `parse_pr_node/1`,
before `extract_rollup/1`):

```elixir
  @doc """
  Fills `:base_behind_by` for open/draft PRs by comparing each PR's head branch
  against its base via `BranchStatus`. Closed/merged PRs and compare failures are
  left as `nil`. Skipped entirely when the resolved client cannot perform REST
  reads (graphql-only test stubs).
  """
  @spec annotate_branch_status([pull_request()], String.t(), keyword()) :: [pull_request()]
  def annotate_branch_status(prs, repo, opts \\ []) when is_list(prs) and is_binary(repo) do
    client = client_module(opts)

    if function_exported?(client, :rest_get, 2) do
      branch_opts = build_branch_opts(client, opts)
      Enum.map(prs, fn pr -> Map.put(pr, :base_behind_by, behind_for(pr, repo, branch_opts)) end)
    else
      prs
    end
  end

  defp build_branch_opts(client, opts) do
    base = [client_module: client]

    case Keyword.get(opts, :branch_status_request_fun) do
      fun when is_function(fun, 2) -> Keyword.put(base, :request_fun, fun)
      _ -> base
    end
  end

  defp behind_for(%{state: state, base_ref: base, head_ref: head}, repo, branch_opts)
       when state in ["open", "draft"] and is_binary(base) and is_binary(head) do
    case BranchStatus.behind_by(repo, base, head, branch_opts) do
      {:ok, behind} -> behind
      {:error, _reason} -> nil
    end
  end

  defp behind_for(_pr, _repo, _branch_opts), do: nil
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec -- mix test test/symphony_elixir/github/pull_requests_test.exs`
Expected: PASS (existing tests + 3 new). The existing tests use `TestClient`
(no `rest_get/2`), so annotation is skipped and `base_behind_by` stays `nil`.

- [ ] **Step 5: Format + commit**

```bash
mise exec -- mix format lib/symphony_elixir/github/pull_requests.ex test/symphony_elixir/github/pull_requests_test.exs
git add elixir/lib/symphony_elixir/github/pull_requests.ex elixir/test/symphony_elixir/github/pull_requests_test.exs
git commit -m "feat(github): annotate PRs with base_behind_by via compare endpoint"
```

---

## Task 4: `PullRequestBranchUpdate.update/3`

**Files:**
- Create: `elixir/lib/symphony_elixir/pull_request_branch_update.ex`
- Test: `elixir/test/symphony_elixir/pull_request_branch_update_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.PullRequestBranchUpdateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.PullRequestBranchUpdate

  defmodule AcceptedClient do
    def rest_put(path, _body, _opts) do
      send(self(), {:put, path})
      {:ok, %{status: 202, body: %{}}}
    end
  end

  defmodule ConflictClient do
    def rest_put(_path, _body, _opts), do: {:error, {:github_api_status, 422}}
  end

  defp github_project do
    %Project{tracker_kind: "github", tracker_config: %{"repo" => "acme/app"}}
  end

  describe "update/3" do
    test "returns {:ok, :accepted} on 202 and calls the update-branch path" do
      assert {:ok, :accepted} =
               PullRequestBranchUpdate.update(github_project(), 509, client_module: AcceptedClient)

      assert_received {:put, "/repos/acme/app/pulls/509/update-branch"}
    end

    test "maps a 422 to :update_branch_conflict" do
      assert {:error, :update_branch_conflict} =
               PullRequestBranchUpdate.update(github_project(), 509, client_module: ConflictClient)
    end

    test "rejects non-github projects" do
      project = %Project{tracker_kind: "local", tracker_config: %{}}

      assert {:error, {:unsupported_tracker_kind, "local"}} =
               PullRequestBranchUpdate.update(project, 509, client_module: AcceptedClient)
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- mix test test/symphony_elixir/pull_request_branch_update_test.exs`
Expected: FAIL — module not available.

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.PullRequestBranchUpdate do
  @moduledoc """
  Updates a pull request's head branch with its base branch via GitHub's
  update-branch REST endpoint (merge commit). GitHub does not expose a rebase
  option on this endpoint, so this is merge-only. GitHub-backed projects only.
  """

  alias SymphonyElixir.GitHub.{Client, PullRequests, RepoSpec}
  alias SymphonyElixir.LocalTracker.Project

  @spec update(Project.t(), pos_integer(), keyword()) :: {:ok, :accepted} | {:error, term()}
  def update(%Project{} = project, number, opts \\ [])
      when is_integer(number) and number > 0 and is_list(opts) do
    with {:ok, repo} <- PullRequests.resolve_repo(project),
         {:ok, {owner, name}} <- RepoSpec.split(repo) do
      client = Keyword.get(opts, :client_module, default_client())
      rest_opts = Keyword.take(opts, [:request_fun])
      path = "/repos/#{owner}/#{name}/pulls/#{number}/update-branch"

      case client.rest_put(path, %{}, rest_opts) do
        {:ok, %{status: status}} when status in 200..299 -> {:ok, :accepted}
        {:error, {:github_api_status, 422}} -> {:error, :update_branch_conflict}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp default_client, do: Application.get_env(:symphony_elixir, :github_client_module, Client)
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec -- mix test test/symphony_elixir/pull_request_branch_update_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Format + commit**

```bash
mise exec -- mix format lib/symphony_elixir/pull_request_branch_update.ex test/symphony_elixir/pull_request_branch_update_test.exs
git add elixir/lib/symphony_elixir/pull_request_branch_update.ex elixir/test/symphony_elixir/pull_request_branch_update_test.exs
git commit -m "feat: add PullRequestBranchUpdate.update/3 (merge base via update-branch)"
```

---

## Task 5: Error mapping + controller + route

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex` (add two clauses near
  the existing `:no_failing_checks` clause, ~line 65).
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_branch_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex` (after line 57).
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/pull_request_branch_controller_test.exs`

- [ ] **Step 1: Write the failing test**

Model on `pull_request_fix_controller_test.exs`. Create:

```elixir
defmodule SymphonyElixirWeb.Tracker.PullRequestBranchControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @github_token_env "GITHUB_TOKEN"

  defmodule AcceptedClient do
    def rest_put(_path, _body, _opts), do: {:ok, %{status: 202, body: %{}}}
  end

  defmodule ConflictClient do
    def rest_put(_path, _body, _opts), do: {:error, {:github_api_status, 422}}
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    previous_github = System.get_env(@github_token_env)
    System.put_env(@github_token_env, "gh-token")

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :github_client_module)
      restore_env(@token_env, previous_token)
      restore_env(@github_token_env, previous_github)
    end)

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "Remote",
        "slug" => "remote",
        "tracker" => %{"kind" => "github", "config" => %{"repo" => "acme/app", "project_id" => "PVT_1"}},
        "repositories" => [],
        "setup" => %{}
      })

    %{project: project}
  end

  test "returns updated:true on success" do
    Application.put_env(:symphony_elixir, :github_client_module, AcceptedClient)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/509/update_branch")

    assert %{"data" => %{"updated" => true}} = json_response(conn, 200)
  end

  test "maps a conflict to 422" do
    Application.put_env(:symphony_elixir, :github_client_module, ConflictClient)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/509/update_branch")

    assert %{"error" => %{"code" => "update_branch_conflict"}} = json_response(conn, 422)
  end

  test "rejects a non-numeric pr number with 422" do
    Application.put_env(:symphony_elixir, :github_client_module, AcceptedClient)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/abc/update_branch")

    assert %{"error" => %{"code" => "invalid_pr_number"}} = json_response(conn, 422)
  end

  defp authorized_conn do
    build_conn() |> Plug.Conn.put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_comments",
          "local_tracker_issues",
          "local_tracker_workflow_statuses",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- mix test test/symphony_elixir_web/controllers/tracker/pull_request_branch_controller_test.exs`
Expected: FAIL — route/controller not defined (404 / no route).

- [ ] **Step 3: Write minimal implementation**

3a. `tracker_errors.ex` — add after the `:no_failing_checks` clause (~line 66):

```elixir
  def render(conn, :update_branch_conflict),
    do:
      error(
        conn,
        422,
        "update_branch_conflict",
        "Could not update the branch automatically — resolve conflicts on GitHub, then retry."
      )

  def render(conn, :invalid_pr_number),
    do: error(conn, 422, "invalid_pr_number", "Invalid pull request number.")
```

3b. Create the controller:

```elixir
defmodule SymphonyElixirWeb.Tracker.PullRequestBranchController do
  @moduledoc """
  Updates a pull request branch with its base branch (merge) via GitHub's
  update-branch endpoint. GitHub-backed projects only.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.PullRequestBranchUpdate
  alias SymphonyElixirWeb.TrackerErrors

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"project_slug" => project_slug, "number" => number}) do
    with {:ok, parsed} <- parse_number(number),
         {:ok, project} <- Context.get_project(project_slug),
         {:ok, :accepted} <- PullRequestBranchUpdate.update(project, parsed) do
      json(conn, %{data: %{updated: true}})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp parse_number(number) when is_binary(number) do
    case Integer.parse(number) do
      {parsed, ""} when parsed > 0 -> {:ok, parsed}
      _ -> {:error, :invalid_pr_number}
    end
  end
end
```

3c. `router.ex` — add after line 57 (the `/pull_requests/fix` route):

```elixir
    post(
      "/projects/:project_slug/issues/:identifier/pull_requests/:number/update_branch",
      PullRequestBranchController,
      :update
    )
```

> The router already aliases controllers as `SymphonyElixirWeb.Tracker` — verify
> the `:as`/scope matches `PullRequestFixController`'s usage and mirror it.

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec -- mix test test/symphony_elixir_web/controllers/tracker/pull_request_branch_controller_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Format + commit**

```bash
mise exec -- mix format lib/symphony_elixir_web/tracker_errors.ex lib/symphony_elixir_web/controllers/tracker/pull_request_branch_controller.ex lib/symphony_elixir_web/router.ex test/symphony_elixir_web/controllers/tracker/pull_request_branch_controller_test.exs
git add elixir/lib/symphony_elixir_web/tracker_errors.ex elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_branch_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/test/symphony_elixir_web/controllers/tracker/pull_request_branch_controller_test.exs
git commit -m "feat(web): add update_branch endpoint for PR branch updates"
```

---

## Task 6: Frontend types + service

**Files:**
- Modify: `tracker/src/types/pull-request.ts`
- Modify: `tracker/src/services/pullRequests.ts`
- Test: `tracker/src/services/__tests__/pullRequests.updateBranch.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

import { http } from "@/services/http";
import { normalizePullRequest, updatePullRequestBranch } from "@/services/pullRequests";

describe("updatePullRequestBranch", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("posts to the update_branch endpoint and returns updated flag", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValue({ data: { data: { updated: true } } } as never);

    const result = await updatePullRequestBranch("macro-markets", "#508", 509);

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining("/projects/macro-markets/issues/%23508/pull_requests/509/update_branch"),
    );
    expect(result).toEqual({ updated: true });
  });

  it("requires a positive number", async () => {
    await expect(updatePullRequestBranch("macro-markets", "#508", 0)).rejects.toThrow("number is required");
  });
});

describe("normalizePullRequest baseBehindBy", () => {
  it("maps base_behind_by and defaults to null", () => {
    expect(normalizePullRequest({ number: 1, base_behind_by: 2 }).baseBehindBy).toBe(2);
    expect(normalizePullRequest({ number: 2 }).baseBehindBy).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `tracker/`): `npm run test -- src/services/__tests__/pullRequests.updateBranch.test.ts`
Expected: FAIL — `updatePullRequestBranch` is not exported / `baseBehindBy` missing.

- [ ] **Step 3: Write minimal implementation**

3a. `types/pull-request.ts` — add to the `PullRequest` interface (after
`conversation`):

```ts
  baseBehindBy: number | null;
```

Add at the end of the file:

```ts
export interface UpdateBranchResult {
  updated: boolean;
}
```

3b. `services/pullRequests.ts`:

- Add `base_behind_by?: number | null;` and `baseBehindBy?: number | null;` to
  `BackendPullRequestDto`.
- In `normalizePullRequest`, add to the returned object:

```ts
    conversation: (dto.conversation ?? []).map(normalizeConversation),
    baseBehindBy: dto.base_behind_by ?? dto.baseBehindBy ?? null,
  };
```

- Import `UpdateBranchResult` in the type import block.
- Append the service function:

```ts
interface BackendUpdateBranchEnvelope {
  data?: { updated?: boolean | null } | null;
}

export async function updatePullRequestBranch(
  projectSlug: string,
  identifier: string,
  number: number,
): Promise<UpdateBranchResult> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");
  if (!Number.isInteger(number) || number <= 0) throw new Error("number is required");

  const response = await http.post<BackendUpdateBranchEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/pull_requests/${number}/update_branch`,
    ),
  );

  return { updated: response.data?.data?.updated ?? false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `tracker/`): `npm run test -- src/services/__tests__/pullRequests.updateBranch.test.ts`
Expected: PASS.

> If other tests construct `PullRequest` literals and now fail to type-check
> because `baseBehindBy` is required, add `baseBehindBy: null` to those fixtures.
> Find them with a search for `checksState:` in `tracker/src`.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/types/pull-request.ts tracker/src/services/pullRequests.ts tracker/src/services/__tests__/pullRequests.updateBranch.test.ts
git commit -m "feat(tracker): add baseBehindBy field + updatePullRequestBranch service"
```

---

## Task 7: "Update branch" button (panel + tab wiring)

**Files:**
- Modify: `tracker/src/components/issues/pull-request/PullRequestPanel.tsx`
- Modify: `tracker/src/components/issues/issue-detail/PullRequestTab.tsx`
- Test: `tracker/src/components/issues/pull-request/__tests__/PullRequestPanel.updateBranch.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PullRequestPanel } from "@/components/issues/pull-request/PullRequestPanel";
import * as service from "@/services/pullRequests";
import type { PullRequest } from "@/types/pull-request";

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 509,
    title: "x",
    url: "https://github.com/acme/app/pull/509",
    state: "open",
    rawState: "OPEN",
    isDraft: false,
    merged: false,
    headRef: "feat/508",
    baseRef: "homolog",
    author: "bot",
    createdAt: null,
    updatedAt: null,
    mergedAt: null,
    checksState: null,
    pipelines: [],
    statuses: [],
    conversation: [],
    baseBehindBy: null,
    ...overrides,
  };
}

describe("PullRequestPanel update branch", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hides the button when not behind", () => {
    render(
      <PullRequestPanel
        pullRequest={makePr({ baseBehindBy: 0 })}
        projectSlug="macro-markets"
        issueIdentifier="#508"
        onRefresh={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /update branch/i })).toBeNull();
  });

  it("updates and refreshes when behind", async () => {
    const spy = vi.spyOn(service, "updatePullRequestBranch").mockResolvedValue({ updated: true });
    const onRefresh = vi.fn();

    render(
      <PullRequestPanel
        pullRequest={makePr({ baseBehindBy: 1 })}
        projectSlug="macro-markets"
        issueIdentifier="#508"
        onRefresh={onRefresh}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /update branch/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("macro-markets", "#508", 509));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });
});
```

> Mock `sonner` if other panel tests do; otherwise add at top:
> `vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));`

- [ ] **Step 2: Run test to verify it fails**

Run (from `tracker/`): `npm run test -- src/components/issues/pull-request/__tests__/PullRequestPanel.updateBranch.test.tsx`
Expected: FAIL — panel does not accept the new props / no button.

- [ ] **Step 3: Write minimal implementation**

3a. `PullRequestPanel.tsx` — update imports + props + button.

Replace the imports at the top:

```tsx
import { useState } from "react";
import { ArrowDownToLine, ArrowRight, ExternalLink, GitBranch } from "lucide-react";
import { toast } from "sonner";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { CommentCard, ReviewBadge } from "@/components/issues/issue-detail/CommentCard";
import { Separator } from "@/components/ui/separator";
import { updatePullRequestBranch } from "@/services/pullRequests";
import { cn, formatDateTime } from "@/lib/utils";
import type { PullRequest, PullRequestPipeline } from "@/types/pull-request";

import { jobMeta, prStateMeta, rollupMeta, statusStateMeta } from "./pr-meta";
```

Replace the props interface + component signature:

```tsx
interface PullRequestPanelProps {
  pullRequest: PullRequest;
  projectSlug: string;
  issueIdentifier: string;
  onRefresh: () => void;
}

export function PullRequestPanel({
  pullRequest: pr,
  projectSlug,
  issueIdentifier,
  onRefresh,
}: PullRequestPanelProps) {
  const [updating, setUpdating] = useState(false);
  const behind = pr.baseBehindBy ?? 0;
  const canUpdate = behind > 0;
  const state = prStateMeta(pr.state);
  const StateIcon = state.Icon;
  const rollup = rollupMeta(pr.checksState);
  const RollupIcon = rollup.Icon;
  const hasChecks = pr.pipelines.length > 0 || pr.statuses.length > 0;

  async function handleUpdateBranch() {
    if (updating) return;
    setUpdating(true);
    try {
      await updatePullRequestBranch(projectSlug, issueIdentifier, pr.number);
      toast.success("Branch update started — following CI…");
      onRefresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not update the branch.");
    } finally {
      setUpdating(false);
    }
  }
```

In the header, replace the existing `{pr.url ? (...) : null}` "Open" block with a
wrapper that adds the button before it:

```tsx
        <div className="flex shrink-0 items-center gap-2">
          {canUpdate ? (
            <button
              type="button"
              onClick={() => void handleUpdateBranch()}
              disabled={updating}
              className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/40 bg-blue-500/10 px-2.5 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-500/20 disabled:opacity-60 dark:text-blue-300"
            >
              <ArrowDownToLine className={cn("h-3.5 w-3.5", updating && "animate-pulse")} />
              {updating ? "Updating…" : `Update branch (${behind} behind)`}
            </button>
          ) : null}
          {pr.url ? (
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </a>
          ) : null}
        </div>
```

3b. `PullRequestTab.tsx` — pass the new props when rendering the panel (replace
the `.map` at ~line 123):

```tsx
      {pullRequests.map((pr) => (
        <PullRequestPanel
          key={pr.number}
          pullRequest={pr}
          projectSlug={projectSlug}
          issueIdentifier={issue.identifier}
          onRefresh={onRefresh}
        />
      ))}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `tracker/`): `npm run test -- src/components/issues/pull-request/__tests__/PullRequestPanel.updateBranch.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/pull-request/PullRequestPanel.tsx tracker/src/components/issues/issue-detail/PullRequestTab.tsx tracker/src/components/issues/pull-request/__tests__/PullRequestPanel.updateBranch.test.tsx
git commit -m "feat(tracker): add Update branch button to PR panel"
```

---

## Task 8: Full gates (backend + frontend) + rebuild

**Files:** none (verification).

- [ ] **Step 1: Backend suite + quality gates**

Run (from `elixir/`):

```bash
mise exec -- mix test
mise exec -- mix format --check-formatted
mise exec -- mix credo --strict
mise exec -- mix specs.check
mise exec -- mix dialyzer
```

Expected: tests 0 failures; format clean; credo clean; `specs.check` shows only the
**3 pre-existing** failures noted in the prior PR-fix work (no new spec gaps from
files touched here — `BranchStatus`, `PullRequestBranchUpdate`, `rest_put/3`,
`annotate_branch_status/3`, and the controller all carry `@spec`); dialyzer 0 errors.

- [ ] **Step 2: Frontend lint + types + tests**

Run (from `tracker/`):

```bash
npm run lint
npx tsc -b
npm run test
```

Expected: all clean. (`tracker/package.json` has `lint` and `test` scripts; there is
no `typecheck` script — `npx tsc -b` is the type gate, matching the `build` script's
`tsc -b && vite build`.)

- [ ] **Step 3: Rebuild tracker assets + restart server**

The Phoenix server serves a pre-built bundle from `elixir/priv/static/tracker` and
does not hot-reload routes. Rebuild and restart so the button and endpoint are live:

```bash
make tracker-build
make stop
make serve
```

Verify: `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/api/tracker/v1/projects/macro-markets/issues/%23508/pull_requests/509/update_branch`
Expected: `401` (auth required) — confirms the route exists (not `404`).

- [ ] **Step 4: Commit any formatting fixups (if gates changed files)**

```bash
git add -A
git commit -m "chore: gate fixups for update-branch feature"
```

---

## Self-Review

**Spec coverage:**
- Detection via compare `behind_by` → Task 1 (`BranchStatus`) + Task 3 (annotate).
- `base_behind_by` in PR JSON → Task 3 (parse default + annotate; controller already
  serializes the PR map verbatim, so no controller change needed).
- Merge update via `update-branch` → Task 2 (`rest_put`) + Task 4 (`update/3`).
- Endpoint + error mapping → Task 5.
- Frontend field + service → Task 6.
- Button + refresh wiring → Task 7.
- Visibility only when `behind_by > 0` (behind + diverged) → Task 7 (`behind > 0`).
- Gates + rebuild/restart → Task 8.

**Placeholder scan:** none — every code step has complete code.

**Type consistency:**
- `BranchStatus.behind_by/4` → `{:ok, non_neg_integer()} | {:error, term()}` (Task 1)
  consumed by `behind_for/3` (Task 3) and tested with `client_module`/`request_fun`.
- `Client.rest_put/3` → `{:ok, %{status, body}} | {:error, term()}` (Task 2) consumed
  by `PullRequestBranchUpdate.update/3` (Task 4), which maps `{:github_api_status, 422}`
  → `:update_branch_conflict` (rendered in Task 5).
- `annotate_branch_status/3` opts use `:client_module` + `:branch_status_request_fun`
  (Task 3), distinct from the GraphQL `:request_fun`, so existing PR tests (graphql-only
  `TestClient`, no `rest_get/2`) are skipped via `function_exported?/3`.
- Frontend `baseBehindBy: number | null` (Task 6) read as `pr.baseBehindBy ?? 0` and
  `updatePullRequestBranch(projectSlug, identifier, number)` (Tasks 6–7) consistent.

**Notes / risks (from spec):** one compare REST call per open PR per 20s poll
(acceptable for 1–2 PRs); 202 is async so `base_behind_by` reconciles on the next
poll; cross-fork heads degrade to no button; `update-branch` 422 covers both conflict
and already-up-to-date, surfaced as a single conflict message.
