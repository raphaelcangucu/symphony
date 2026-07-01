# "Fix with agent" — PR failure re-dispatch via Rework — Implementation Plan

 

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo's real tools.

**Goal:** Add a "Fix with agent" action on the issue PR tab that, when a linked PR has failing CI checks, posts an issue comment containing the failing-job log tails and moves the issue to `Rework` so the orchestrator re-dispatches the agent with that failure context.

**Architecture:** Reuse the existing polling-based dispatch — the new backend action posts a structured comment (the GitHub prompt template already renders `issue.comments`) and transitions the issue to `Rework` (an `active_state`). Log excerpts come from a new REST helper on `GitHub.Client`. No changes to the orchestrator or `PromptBuilder`.

**Tech Stack:** Elixir/Phoenix (backend, ExUnit, `Req`), React/TypeScript (tracker frontend, Vitest, axios, sonner).

**Spec:** `docs/superpowers/specs/2026-05-30-pr-fix-with-agent-design.md`

---

## Conventions for this plan

- Elixir tests: `cd elixir && eval "$(mise activate bash)" && mise exec -- mix test <path>`
  - (Run `mise install` once if Elixir/OTP aren't installed yet.)
- Frontend tests: `cd tracker && npx vitest run <path>`
- Public `def` in `lib/` need an adjacent `@spec` (`mix specs.check`).
- Commit after each task. Only commit the files listed in that task.

## File map

**Backend — create**

- `elixir/lib/symphony_elixir/github/check_logs.ex`
- `elixir/lib/symphony_elixir/pull_request_fix.ex`
- `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_fix_controller.ex`
- `elixir/test/symphony_elixir/github/check_logs_test.exs`
- `elixir/test/symphony_elixir/pull_request_fix_test.exs`
- `elixir/test/symphony_elixir_web/controllers/tracker/pull_request_fix_controller_test.exs`

**Backend — modify**

- `elixir/lib/symphony_elixir/github/pull_requests.ex` (add `databaseId` → `job_id`)
- `elixir/lib/symphony_elixir/github/client.ex` (add `rest_get/2`)
- `elixir/lib/symphony_elixir_web/tracker_errors.ex` (add `:no_failing_checks`)
- `elixir/lib/symphony_elixir_web/router.ex` (add route)
- `elixir/test/symphony_elixir/github/pull_requests_test.exs` (assert `job_id`)
- `elixir/test/symphony_elixir/github/client_test.exs` (assert `rest_get/2`) — create if absent

**Frontend — modify**

- `tracker/src/types/pull-request.ts` (add `PullRequestFixResult`)
- `tracker/src/services/pullRequests.ts` (add `requestPullRequestFix`)
- `tracker/src/components/issues/pull-request/pr-meta.ts` (add `hasFailingChecks`)
- `tracker/src/components/issues/issue-detail/PullRequestTab.tsx` (button + handler)
- `tracker/src/components/issues/IssueDrawer.tsx` (pass `projectSlug`)

**Frontend — create**

- `tracker/src/components/issues/pull-request/__tests__/pr-meta.test.ts`
- `tracker/src/services/__tests__/pullRequests.fix.test.ts`

---

## Task 1: Expose `job_id` on PR jobs

**Files:**

- Modify: `elixir/lib/symphony_elixir/github/pull_requests.ex`

- Test: `elixir/test/symphony_elixir/github/pull_requests_test.exs`

- \[ \] **Step 1: Write the failing test**

Add inside `describe "parse_pr_node/1"` in `pull_requests_test.exs`:

```elixir
test "exposes job_id from CheckRun databaseId" do
  node =
    pr_node(%{
      "commits" => %{
        "nodes" => [
          %{
            "commit" => %{
              "statusCheckRollup" => %{
                "state" => "FAILURE",
                "contexts" => %{
                  "nodes" => [
                    %{
                      "__typename" => "CheckRun",
                      "name" => "vitest / test",
                      "status" => "COMPLETED",
                      "conclusion" => "FAILURE",
                      "databaseId" => 78_427_907_850,
                      "detailsUrl" => "https://github.com/acme/app/actions/runs/1/job/78427907850",
                      "checkSuite" => %{"workflowRun" => %{"url" => "u", "workflow" => %{"name" => "CI"}}}
                    }
                  ]
                }
              }
            }
          }
        ]
      }
    })

  [%{jobs: [job]}] = PullRequests.parse_pr_node(node).pipelines
  assert job.job_id == 78_427_907_850
end
```

- \[ \] **Step 2: Run test to verify it fails**

Run: `cd elixir && eval "$(mise activate bash)" && mise exec -- mix test test/symphony_elixir/github/pull_requests_test.exs`Expected: FAIL — `key :job_id not found` (job map has no `job_id`).

- \[ \] **Step 3: Write minimal implementation**

In `pull_requests.ex`, add `databaseId` to the `CheckRun` selection inside `@pr_fields` (after `name`):

```
      ... on CheckRun {
        name
        databaseId
        status
        conclusion
        detailsUrl
```

Then in `check_run_to_job/1` add the `job_id` key:

```elixir
  defp check_run_to_job(check_run) do
    %{
      name: string_or_nil(Map.get(check_run, "name")),
      job_id: positive_integer_or_nil(Map.get(check_run, "databaseId")) || job_id_from_url(check_run),
      status: string_or_nil(Map.get(check_run, "status")),
      conclusion: string_or_nil(Map.get(check_run, "conclusion")),
      url: string_or_nil(Map.get(check_run, "detailsUrl")),
      started_at: string_or_nil(Map.get(check_run, "startedAt")),
      completed_at: string_or_nil(Map.get(check_run, "completedAt"))
    }
  end

  defp positive_integer_or_nil(value) when is_integer(value) and value > 0, do: value
  defp positive_integer_or_nil(_value), do: nil

  defp job_id_from_url(check_run) do
    case string_or_nil(Map.get(check_run, "detailsUrl")) do
      url when is_binary(url) ->
        case Regex.run(~r{/job/(\d+)}, url) do
          [_, captured] -> String.to_integer(captured)
          _ -> nil
        end

      _ ->
        nil
    end
  end
```

- \[ \] **Step 4: Run test to verify it passes**

Run: `cd elixir && eval "$(mise activate bash)" && mise exec -- mix test test/symphony_elixir/github/pull_requests_test.exs`Expected: PASS (all tests, including the existing ones).

- \[ \] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/pull_requests.ex elixir/test/symphony_elixir/github/pull_requests_test.exs
git commit -m "feat(pr): expose CheckRun job_id for log lookups"
```

---

## Task 2: `GitHub.Client.rest_get/2` REST helper

**Files:**

- Modify: `elixir/lib/symphony_elixir/github/client.ex`

- Test: `elixir/test/symphony_elixir/github/client_test.exs` (create if missing)

- \[ \] **Step 1: Write the failing test**

Create or append to `elixir/test/symphony_elixir/github/client_test.exs`:

```elixir
defmodule SymphonyElixir.GitHub.ClientRestTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.Client

  setup do
    System.put_env("GITHUB_TOKEN", "test-token")
    on_exit(fn -> System.delete_env("GITHUB_TOKEN") end)
    :ok
  end

  test "rest_get builds url + headers and returns body" do
    request_fun = fn url, headers ->
      assert url == "https://api.github.com/repos/acme/app/actions/jobs/9/logs"
      assert {"Authorization", "Bearer test-token"} in headers
      assert {"X-GitHub-Api-Version", "2022-11-28"} in headers
      {:ok, %{status: 200, body: "line1\nline2"}}
    end

    assert {:ok, %{status: 200, body: "line1\nline2"}} =
             Client.rest_get("/repos/acme/app/actions/jobs/9/logs", request_fun: request_fun)
  end

  test "rest_get maps non-2xx status to error" do
    request_fun = fn _url, _headers -> {:ok, %{status: 404, body: ""}} end

    assert {:error, {:github_api_status, 404}} =
             Client.rest_get("/repos/acme/app/actions/jobs/9/logs", request_fun: request_fun)
  end

  test "rest_get returns missing token error when unset" do
    System.delete_env("GITHUB_TOKEN")

    assert {:error, :missing_github_token} =
             Client.rest_get("/repos/acme/app/actions/jobs/9/logs", request_fun: fn _u, _h -> {:ok, %{status: 200, body: ""}} end)
  end
end
```

- \[ \] **Step 2: Run test to verify it fails**

Run: `cd elixir && eval "$(mise activate bash)" && mise exec -- mix test test/symphony_elixir/github/client_test.exs`Expected: FAIL — `function Client.rest_get/2 is undefined`.

- \[ \] **Step 3: Write minimal implementation**

In `client.ex`, add a base-url constant near `@graphql_endpoint`:

```elixir
  @rest_endpoint "https://api.github.com"
```

Add the public function (place it just after `graphql/3`):

```elixir
  @spec rest_get(String.t(), keyword()) ::
          {:ok, %{status: pos_integer(), body: term()}} | {:error, term()}
  def rest_get(path, opts \\ []) when is_binary(path) and is_list(opts) do
    request_fun = Keyword.get(opts, :request_fun, &get_rest_request/2)
    url = @rest_endpoint <> path

    with {:ok, token} <- require_token(),
         headers = rest_headers(token),
         {:ok, %{status: status, body: body}} when status in 200..299 <- request_fun.(url, headers) do
      {:ok, %{status: status, body: body}}
    else
      {:error, :missing_github_token} = error -> error
      {:ok, %{status: status}} -> {:error, {:github_api_status, status}}
      {:error, reason} -> {:error, {:github_api_request, reason}}
    end
  end
```

Add the private helpers near `graphql_headers/1` / `post_graphql_request/2`:

```elixir
  defp rest_headers(token) do
    [
      {"Authorization", "Bearer #{token}"},
      {"Accept", "application/vnd.github+json"},
      {"X-GitHub-Api-Version", "2022-11-28"}
    ]
  end

  defp get_rest_request(url, headers) do
    Req.get(url, headers: headers, connect_options: [timeout: 30_000])
  end
```

(`Req` follows redirects by default and strips `Authorization` on cross-host redirects, so the Actions logs blob fetch works.)

- \[ \] **Step 4: Run test to verify it passes**

Run: `cd elixir && eval "$(mise activate bash)" && mise exec -- mix test test/symphony_elixir/github/client_test.exs`Expected: PASS.

- \[ \] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/client.ex elixir/test/symphony_elixir/github/client_test.exs
git commit -m "feat(github): add authenticated REST GET helper"
```

---

## Task 3: `GitHub.CheckLogs` — fetch + tail failing job logs

**Files:**

- Create: `elixir/lib/symphony_elixir/github/check_logs.ex`

- Test: `elixir/test/symphony_elixir/github/check_logs_test.exs`

- \[ \] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/github/check_logs_test.exs`:

```elixir
defmodule SymphonyElixir.GitHub.CheckLogsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.CheckLogs

  defmodule StubClient do
    def rest_get(_path, opts) do
      Keyword.fetch!(opts, :request_fun).(nil, nil)
    end
  end

  describe "clean_and_tail/1" do
    test "strips timestamps and ANSI, keeps the tail" do
      raw =
        Enum.map_join(1..300, "\n", fn i ->
          "2026-05-29T02:43:46.2845216Z \e[31mline #{i}\e[39m"
        end)

      result = CheckLogs.clean_and_tail(raw)

      refute result =~ "2026-05-29T02:43:46"
      refute result =~ "\e["
      refute result =~ "line 1\n"
      assert result =~ "line 300"
    end

    test "caps very large single-line output by characters" do
      raw = "2026-05-29T00:00:00Z " <> String.duplicate("x", 50_000)
      assert String.length(CheckLogs.clean_and_tail(raw)) <= 8_000
    end
  end

  describe "failing_job_excerpt/3" do
    test "returns cleaned excerpt for a job id" do
      request_fun = fn _url, _headers ->
        {:ok, %{status: 200, body: "2026-05-29T02:43:46Z ##[error]Process completed with exit code 1."}}
      end

      assert {:ok, excerpt} =
               CheckLogs.failing_job_excerpt("acme/app", 9, client_module: StubClient, request_fun: request_fun)

      assert excerpt =~ "##[error]Process completed with exit code 1."
      refute excerpt =~ "2026-05-29T02:43:46Z"
    end

    test "propagates client errors" do
      request_fun = fn _url, _headers -> {:error, {:github_api_status, 404}} end

      assert {:error, {:github_api_status, 404}} =
               CheckLogs.failing_job_excerpt("acme/app", 9, client_module: StubClient, request_fun: request_fun)
    end
  end
end
```

- \[ \] **Step 2: Run test to verify it fails**

Run: `cd elixir && eval "$(mise activate bash)" && mise exec -- mix test test/symphony_elixir/github/check_logs_test.exs`Expected: FAIL — `module SymphonyElixir.GitHub.CheckLogs is not available`.

- \[ \] **Step 3: Write minimal implementation**

Create `elixir/lib/symphony_elixir/github/check_logs.ex`:

```elixir
defmodule SymphonyElixir.GitHub.CheckLogs do
  @moduledoc """
  Fetches a GitHub Actions job log and extracts a cleaned tail excerpt suitable
  for embedding in an issue comment. Failure summaries reliably sit at the end of
  Actions logs, so a tail (timestamp/ANSI stripped, line + char capped) captures
  the relevant error region.
  """

  alias SymphonyElixir.GitHub.{Client, RepoSpec}

  @max_lines 200
  @max_chars 8_000

  @spec failing_job_excerpt(String.t(), pos_integer(), keyword()) ::
          {:ok, String.t()} | {:error, term()}
  def failing_job_excerpt(repo, job_id, opts \\ [])
      when is_binary(repo) and is_integer(job_id) and job_id > 0 do
    with {:ok, {owner, name}} <- RepoSpec.split(repo) do
      client = Keyword.get(opts, :client_module, default_client())
      rest_opts = Keyword.take(opts, [:request_fun])
      path = "/repos/#{owner}/#{name}/actions/jobs/#{job_id}/logs"

      case client.rest_get(path, rest_opts) do
        {:ok, %{body: body}} when is_binary(body) -> {:ok, clean_and_tail(body)}
        {:ok, %{body: _other}} -> {:error, :unexpected_log_body}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  @spec clean_and_tail(String.t()) :: String.t()
  def clean_and_tail(raw) when is_binary(raw) do
    raw
    |> String.split(["\r\n", "\n"])
    |> Enum.map(&strip_timestamp/1)
    |> Enum.map(&strip_ansi/1)
    |> Enum.take(-@max_lines)
    |> Enum.join("\n")
    |> cap_chars()
    |> String.trim()
  end

  defp strip_timestamp(line), do: Regex.replace(~r/^\S+T\S+Z\s/, line, "")
  defp strip_ansi(line), do: Regex.replace(~r/\e\[[0-9;]*m/, line, "")

  defp cap_chars(text) do
    if String.length(text) <= @max_chars do
      text
    else
      String.slice(text, -@max_chars, @max_chars)
    end
  end

  defp default_client, do: Application.get_env(:symphony_elixir, :github_client_module, Client)
end
```

- \[ \] **Step 4: Run test to verify it passes**

Run: `cd elixir && eval "$(mise activate bash)" && mise exec -- mix test test/symphony_elixir/github/check_logs_test.exs`Expected: PASS.

- \[ \] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/check_logs.ex elixir/test/symphony_elixir/github/check_logs_test.exs
git commit -m "feat(github): fetch and tail failing job logs"
```

---

## Task 4: `PullRequestFix` — comment + move to Rework

**Files:**

- Create: `elixir/lib/symphony_elixir/pull_request_fix.ex`

- Test: `elixir/test/symphony_elixir/pull_request_fix_test.exs`

- \[ \] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/pull_request_fix_test.exs`:

```elixir
defmodule SymphonyElixir.PullRequestFixTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.PullRequestFix

  describe "build_comment/1" do
    test "renders PR section, failing job and excerpt" do
      entries = [
        %{
          pr: %{number: 509, title: "docs: add llms.txt", url: "https://github.com/acme/app/pull/509"},
          pipeline: %{name: "CI/CD Pipeline"},
          job: %{name: "vitest / test", conclusion: "FAILURE", url: "https://github.com/acme/app/runs/9", job_id: 9},
          excerpt: "ReferenceError: window is not defined"
        }
      ]

      body = PullRequestFix.build_comment(entries)

      assert body =~ "## CI failure"
      assert body =~ "PR #509"
      assert body =~ "docs: add llms.txt"
      assert body =~ "vitest / test"
      assert body =~ "FAILURE"
      assert body =~ "```log"
      assert body =~ "ReferenceError: window is not defined"
    end

    test "notes when a log excerpt is unavailable" do
      entries = [
        %{
          pr: %{number: 1, title: "t", url: "u"},
          pipeline: %{name: "CI"},
          job: %{name: "build", conclusion: "FAILURE", url: "j", job_id: nil},
          excerpt: nil
        }
      ]

      assert PullRequestFix.build_comment(entries) =~ "log unavailable"
    end
  end
end
```

- \[ \] **Step 2: Run test to verify it fails**

Run: `cd elixir && eval "$(mise activate bash)" && mise exec -- mix test test/symphony_elixir/pull_request_fix_test.exs`Expected: FAIL — `module SymphonyElixir.PullRequestFix is not available`.

- \[ \] **Step 3: Write minimal implementation**

Create `elixir/lib/symphony_elixir/pull_request_fix.ex`:

```elixir
defmodule SymphonyElixir.PullRequestFix do
  @moduledoc """
  Requests an agent fix for a PR with failing checks: posts an issue comment with
  the failing-job log tails and moves the issue to `Rework` so the orchestrator
  re-dispatches the agent with that failure context.

  GitHub-backed projects only (PR linkage is GitHub-only).
  """

  alias SymphonyElixir.GitHub.{CheckLogs, PullRequests}
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueAdapter

  @rework_state "Rework"
  @max_jobs 3
  @failure_conclusions ~w(FAILURE TIMED_OUT CANCELLED STARTUP_FAILURE ACTION_REQUIRED)

  @spec request_fix(Project.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def request_fix(%Project{} = project, identifier) when is_binary(identifier) do
    with {:ok, repo} <- PullRequests.resolve_repo(project),
         {:ok, prs} <- PullRequests.for_issue(repo, identifier),
         failing = collect_failing(prs),
         :ok <- ensure_present(failing),
         enriched = enrich_with_logs(repo, failing),
         body = build_comment(enriched),
         {:ok, comment} <- IssueAdapter.dispatch(project, :add_comment, [identifier, body, %{}]),
         {:ok, _issue} <-
           IssueAdapter.dispatch(project, :move_issue, [identifier, %{"status" => @rework_state}]) do
      {:ok, %{comment: comment, status: @rework_state, jobs: Enum.map(enriched, & &1.job)}}
    end
  end

  @spec build_comment([map()]) :: String.t()
  def build_comment(entries) when is_list(entries) do
    prs = entries |> Enum.map(& &1.pr) |> Enum.uniq_by(& &1.number)

    sections =
      Enum.map(prs, fn pr ->
        pr_entries = Enum.filter(entries, &(&1.pr.number == pr.number))
        pr_section(pr, pr_entries)
      end)

    header() <> Enum.join(sections, "\n")
  end

  defp ensure_present([]), do: {:error, :no_failing_checks}
  defp ensure_present([_ | _]), do: :ok

  defp collect_failing(prs) do
    prs
    |> Enum.flat_map(fn pr ->
      pr
      |> Map.get(:pipelines, [])
      |> Enum.flat_map(fn pipeline ->
        pipeline
        |> Map.get(:jobs, [])
        |> Enum.filter(&failing_job?/1)
        |> Enum.map(fn job -> %{pr: pr, pipeline: pipeline, job: job} end)
      end)
    end)
    |> Enum.take(@max_jobs)
  end

  defp failing_job?(%{conclusion: conclusion}) when is_binary(conclusion),
    do: String.upcase(conclusion) in @failure_conclusions

  defp failing_job?(_job), do: false

  defp enrich_with_logs(repo, failing) do
    Enum.map(failing, fn entry ->
      Map.put(entry, :excerpt, fetch_excerpt(repo, entry.job))
    end)
  end

  defp fetch_excerpt(repo, %{job_id: id}) when is_integer(id) and id > 0 do
    case CheckLogs.failing_job_excerpt(repo, id) do
      {:ok, text} -> text
      {:error, _reason} -> nil
    end
  end

  defp fetch_excerpt(_repo, _job), do: nil

  defp header do
    "## CI failure — automated fix requested\n\n" <>
      "Symphony detected failing checks on the linked pull request(s). " <>
      "Please reproduce, fix the failing tests, and revalidate.\n\n"
  end

  defp pr_section(pr, entries) do
    title = pr.title || "(untitled)"

    head =
      "### PR ##{pr.number} — #{title}\n#{pr.url}\n\n**Failing checks:**\n"

    head <> Enum.map_join(entries, "\n", &job_block/1)
  end

  defp job_block(%{job: job, excerpt: excerpt}) do
    name = job[:name] || "check"
    conclusion = job[:conclusion] || "FAILURE"
    url = job[:url]

    heading = "\n#### #{name} — #{conclusion}\n"
    heading = if url, do: heading <> "#{url}\n", else: heading

    case excerpt do
      text when is_binary(text) and text != "" -> heading <> "\n```log\n" <> text <> "\n```\n"
      _ -> heading <> "\n_(log unavailable)_\n"
    end
  end
end
```

- \[ \] **Step 4: Run test to verify it passes**

Run: `cd elixir && eval "$(mise activate bash)" && mise exec -- mix test test/symphony_elixir/pull_request_fix_test.exs`Expected: PASS.

- \[ \] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/pull_request_fix.ex elixir/test/symphony_elixir/pull_request_fix_test.exs
git commit -m "feat(pr): build CI-failure comment and move issue to Rework"
```

---

## Task 5: `request_fix/2` orchestration test (stub adapter)

**Files:**

- Modify: `elixir/test/symphony_elixir/pull_request_fix_test.exs`

This task verifies the full `request_fix/2` flow (adapter dispatch order + guard) using an injected adapter, without hitting GitHub.

- \[ \] **Step 1: Write the failing test**

Append to `pull_request_fix_test.exs`. The adapter is selected by `IssueAdapter.for/1`from `Application.get_env(:symphony_elixir, :issue_adapters, %{})` keyed by `tracker_kind`, and `PullRequests.for_issue/3` uses `Application.get_env(:symphony_elixir, :github_client_module, ...)`.

```elixir
  defmodule StubAdapter do
    @behaviour SymphonyElixir.Tracker.IssueAdapter

    def kind, do: :github
    def list_issues(_p, _f), do: {:ok, []}
    def get_issue(_p, _i), do: {:error, :issue_not_found}
    def create_issue(_p, _a), do: {:error, :not_supported_on_remote}
    def update_issue(_p, _i, _a), do: {:error, :not_supported_on_remote}
    def list_statuses(_p), do: {:ok, []}
    def list_comments(_p, _i), do: {:ok, []}

    def add_comment(_p, _i, body, _a) do
      send(self(), {:added_comment, body})
      {:ok, %{id: "c1", body: body}}
    end

    def move_issue(_p, _i, attrs) do
      send(self(), {:moved, attrs})
      {:ok, %{id: "i1"}}
    end
  end

  defmodule StubGitHubClient do
    # closedByPullRequestsReferences with one failing CheckRun
    def graphql(query, _vars, _opts) do
      cond do
        query =~ "SymphonyTrackerIssuePullRequests" ->
          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "issue" => %{
                   "linkedBranches" => %{"nodes" => []},
                   "timelineItems" => %{"nodes" => []},
                   "closedByPullRequestsReferences" => %{
                     "nodes" => [
                       %{
                         "number" => 509,
                         "title" => "docs: add llms.txt",
                         "url" => "https://github.com/acme/app/pull/509",
                         "state" => "OPEN",
                         "updatedAt" => "2026-05-29T00:00:00Z",
                         "commits" => %{
                           "nodes" => [
                             %{
                               "commit" => %{
                                 "statusCheckRollup" => %{
                                   "state" => "FAILURE",
                                   "contexts" => %{
                                     "nodes" => [
                                       %{
                                         "__typename" => "CheckRun",
                                         "name" => "vitest / test",
                                         "conclusion" => "FAILURE",
                                         "databaseId" => 9,
                                         "detailsUrl" => "https://github.com/acme/app/actions/runs/1/job/9"
                                       }
                                     ]
                                   }
                                 }
                               }
                             }
                           ]
                         }
                       }
                     ]
                   }
                 }
               }
             }
           }}
      end
    end

    def rest_get(_path, _opts), do: {:ok, %{status: 200, body: "2026-05-29T00:00:00Z ##[error]boom"}}
  end

  describe "request_fix/2" do
    setup do
      Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => StubAdapter})
      Application.put_env(:symphony_elixir, :github_client_module, StubGitHubClient)

      on_exit(fn ->
        Application.delete_env(:symphony_elixir, :issue_adapters)
        Application.delete_env(:symphony_elixir, :github_client_module)
      end)

      project = %SymphonyElixir.LocalTracker.Project{
        tracker_kind: "github",
        tracker_config: %{"repo" => "acme/app"}
      }

      {:ok, project: project}
    end

    test "posts a comment then moves the issue to Rework", %{project: project} do
      assert {:ok, %{status: "Rework", jobs: [%{name: "vitest / test"}]}} =
               PullRequestFix.request_fix(project, "509")

      assert_received {:added_comment, body}
      assert body =~ "vitest / test"
      assert body =~ "boom"
      assert_received {:moved, %{"status" => "Rework"}}
    end

    test "returns :no_failing_checks when nothing failed", %{project: project} do
      Application.put_env(:symphony_elixir, :github_client_module, EmptyChecksClient)
      assert {:error, :no_failing_checks} = PullRequestFix.request_fix(project, "509")
    end
  end

  defmodule EmptyChecksClient do
    def graphql(_q, _v, _o) do
      {:ok,
       %{
         "data" => %{
           "repository" => %{
             "issue" => %{
               "linkedBranches" => %{"nodes" => []},
               "timelineItems" => %{"nodes" => []},
               "closedByPullRequestsReferences" => %{"nodes" => []}
             }
           }
         }
       }}
    end

    def rest_get(_p, _o), do: {:ok, %{status: 200, body: ""}}
  end
```

- \[ \] **Step 2: Run test to verify it fails (then passes)**

Run: `cd elixir && eval "$(mise activate bash)" && mise exec -- mix test test/symphony_elixir/pull_request_fix_test.exs`Expected: With Task 4's implementation already in place, these should PASS. If a real `GITHUB_TOKEN` is set in the env, `for_issue/3` still uses the injected client, so no network call occurs. If `RepoSpec.split/1` or atom-key assumptions differ, fix the implementation (not the test) until PASS.

- \[ \] **Step 3: Commit**

```bash
git add elixir/test/symphony_elixir/pull_request_fix_test.exs
git commit -m "test(pr): cover request_fix dispatch order and guard"
```

---

## Task 6: Error mapping + controller + route

**Files:**

- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex`

- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_fix_controller.ex`

- Modify: `elixir/lib/symphony_elixir_web/router.ex`

- Test: `elixir/test/symphony_elixir_web/controllers/tracker/pull_request_fix_controller_test.exs`

- \[ \] **Step 1: Add the** `:no_failing_checks` **error clause**

In `tracker_errors.ex`, add before the binary/catch-all clauses (after the `{:remote_validation, ...}` clause):

```elixir
  def render(conn, :no_failing_checks),
    do: error(conn, 422, "no_failing_checks", "No failing checks found on the linked pull request(s).")
```

- \[ \] **Step 2: Write the controller test (failing)**

Look at an existing tracker controller test (e.g. `test/symphony_elixir_web/controllers/tracker/comment_controller_test.exs`) for the `ConnCase`/setup pattern and the `:issue_adapters` / project-fixture helpers; mirror it.

Create `elixir/test/symphony_elixir_web/controllers/tracker/pull_request_fix_controller_test.exs`:

```elixir
defmodule SymphonyElixirWeb.Tracker.PullRequestFixControllerTest do
  use SymphonyElixirWeb.ConnCase, async: false

  # Reuse the project-creation + auth-header helpers used by the other tracker
  # controller tests in this directory. Replace `create_github_project/0` and
  # `auth_headers/0` with the actual helpers from comment_controller_test.exs.

  defmodule StubAdapter do
    @behaviour SymphonyElixir.Tracker.IssueAdapter
    def kind, do: :github
    def list_issues(_p, _f), do: {:ok, []}
    def get_issue(_p, _i), do: {:error, :issue_not_found}
    def create_issue(_p, _a), do: {:error, :not_supported_on_remote}
    def update_issue(_p, _i, _a), do: {:error, :not_supported_on_remote}
    def list_statuses(_p), do: {:ok, []}
    def list_comments(_p, _i), do: {:ok, []}
    def add_comment(_p, _i, body, _a), do: {:ok, %{id: "c1", body: body}}
    def move_issue(_p, _i, _a), do: {:ok, %{id: "i1"}}
  end

  defmodule FailingChecksClient do
    def graphql(q, _v, _o) when is_binary(q) do
      {:ok,
       %{
         "data" => %{
           "repository" => %{
             "issue" => %{
               "linkedBranches" => %{"nodes" => []},
               "timelineItems" => %{"nodes" => []},
               "closedByPullRequestsReferences" => %{
                 "nodes" => [
                   %{
                     "number" => 509,
                     "title" => "t",
                     "url" => "u",
                     "state" => "OPEN",
                     "updatedAt" => "2026-05-29T00:00:00Z",
                     "commits" => %{
                       "nodes" => [
                         %{
                           "commit" => %{
                             "statusCheckRollup" => %{
                               "state" => "FAILURE",
                               "contexts" => %{
                                 "nodes" => [
                                   %{"__typename" => "CheckRun", "name" => "vitest", "conclusion" => "FAILURE", "databaseId" => 9, "detailsUrl" => "https://x/job/9"}
                                 ]
                               }
                             }
                           }
                         }
                       ]
                     }
                   }
                 ]
               }
             }
           }
         }}
    end

    def rest_get(_p, _o), do: {:ok, %{status: 200, body: "##[error]boom"}}
  end

  setup do
    Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => StubAdapter})
    Application.put_env(:symphony_elixir, :github_client_module, FailingChecksClient)
    System.put_env("GITHUB_TOKEN", "test-token")

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :issue_adapters)
      Application.delete_env(:symphony_elixir, :github_client_module)
      System.delete_env("GITHUB_TOKEN")
    end)

    :ok
  end

  test "POST .../pull_requests/fix posts comment and moves to Rework", %{conn: conn} do
    project = create_github_project()

    conn =
      conn
      |> put_tracker_auth()
      |> post("/api/tracker/v1/projects/#{project.slug}/issues/509/pull_requests/fix")

    assert %{"data" => %{"moved_to" => "Rework", "comment_posted" => true}} = json_response(conn, 201)
  end
end
```

(Use the real auth/project helpers from the sibling test file; `create_github_project/0`, `put_tracker_auth/1` are placeholders for those helpers.)

- \[ \] **Step 3: Run test to verify it fails**

Run: `cd elixir && eval "$(mise activate bash)" && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/pull_request_fix_controller_test.exs`Expected: FAIL — no matching route / controller undefined.

- \[ \] **Step 4: Write the controller**

Create `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_fix_controller.ex`:

```elixir
defmodule SymphonyElixirWeb.Tracker.PullRequestFixController do
  @moduledoc """
  Posts a CI-failure comment and moves the issue to `Rework` so the orchestrator
  re-dispatches the agent with the failure context. GitHub-backed projects only.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.PullRequestFix
  alias SymphonyElixirWeb.TrackerErrors

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, result} <- PullRequestFix.request_fix(project, identifier) do
      conn
      |> put_status(:created)
      |> json(%{data: %{moved_to: result.status, comment_posted: true, jobs: result.jobs}})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
end
```

- \[ \] **Step 5: Add the route**

In `router.ex`, inside `scope "/api/tracker/v1"`, add immediately after the existing `get(".../pull_requests", PullRequestController, :index)` line:

```elixir
    post("/projects/:project_slug/issues/:identifier/pull_requests/fix", PullRequestFixController, :create)
```

- \[ \] **Step 6: Run test to verify it passes**

Run: `cd elixir && eval "$(mise activate bash)" && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/pull_request_fix_controller_test.exs`Expected: PASS.

- \[ \] **Step 7: Commit**

```bash
git add elixir/lib/symphony_elixir_web/tracker_errors.ex \
        elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_fix_controller.ex \
        elixir/lib/symphony_elixir_web/router.ex \
        elixir/test/symphony_elixir_web/controllers/tracker/pull_request_fix_controller_test.exs
git commit -m "feat(web): add POST pull_requests/fix endpoint"
```

---

## Task 7: Frontend — `hasFailingChecks` helper

**Files:**

- Modify: `tracker/src/components/issues/pull-request/pr-meta.ts`

- Create: `tracker/src/components/issues/pull-request/__tests__/pr-meta.test.ts`

- \[ \] **Step 1: Write the failing test**

Create `tracker/src/components/issues/pull-request/__tests__/pr-meta.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { PullRequest } from "@/types/pull-request";

import { hasFailingChecks } from "../pr-meta";

function pr(overrides: Partial<PullRequest>): PullRequest {
  return {
    number: 1, title: null, url: null, state: "open", rawState: null, isDraft: false,
    merged: false, headRef: null, baseRef: null, author: null, createdAt: null,
    updatedAt: null, mergedAt: null, checksState: null, pipelines: [], statuses: [],
    conversation: [], ...overrides,
  };
}

describe("hasFailingChecks", () => {
  it("is true when any job conclusion is a failure", () => {
    const value = pr({
      pipelines: [{ name: "CI", url: null, jobs: [{ name: "t", status: "COMPLETED", conclusion: "FAILURE", url: null, startedAt: null, completedAt: null }] }],
    });
    expect(hasFailingChecks(value)).toBe(true);
  });

  it("is false when all jobs succeeded or were skipped", () => {
    const value = pr({
      pipelines: [{ name: "CI", url: null, jobs: [{ name: "t", status: "COMPLETED", conclusion: "SUCCESS", url: null, startedAt: null, completedAt: null }] }],
    });
    expect(hasFailingChecks(value)).toBe(false);
  });
});
```

- \[ \] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/issues/pull-request/__tests__/pr-meta.test.ts`Expected: FAIL — `hasFailingChecks` is not exported.

- \[ \] **Step 3: Write minimal implementation**

Append to `tracker/src/components/issues/pull-request/pr-meta.ts`:

```ts
import type { PullRequest } from "@/types/pull-request";

const FAILING_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"]);

export function hasFailingChecks(pr: PullRequest): boolean {
  return pr.pipelines.some((pipeline) =>
    pipeline.jobs.some((job) => job.conclusion != null && FAILING_CONCLUSIONS.has(job.conclusion.toUpperCase())),
  );
}
```

(If `pr-meta.ts` already imports `PullRequest`, reuse the existing import rather than adding a duplicate.)

- \[ \] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/issues/pull-request/__tests__/pr-meta.test.ts`Expected: PASS.

- \[ \] **Step 5: Commit**

```bash
git add tracker/src/components/issues/pull-request/pr-meta.ts \
        tracker/src/components/issues/pull-request/__tests__/pr-meta.test.ts
git commit -m "feat(tracker): add hasFailingChecks helper"
```

---

## Task 8: Frontend — `requestPullRequestFix` service

**Files:**

- Modify: `tracker/src/types/pull-request.ts`

- Modify: `tracker/src/services/pullRequests.ts`

- Create: `tracker/src/services/__tests__/pullRequests.fix.test.ts`

- \[ \] **Step 1: Add the result type**

Append to `tracker/src/types/pull-request.ts`:

```ts
export interface PullRequestFixJob {
  name: string | null;
  conclusion: string | null;
  url: string | null;
}

export interface PullRequestFixResult {
  movedTo: string;
  commentPosted: boolean;
  jobs: PullRequestFixJob[];
}
```

- \[ \] **Step 2: Write the failing test**

Create `tracker/src/services/__tests__/pullRequests.fix.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../http", () => ({
  http: { post: vi.fn() },
  trackerPath: (p: string) => `/api/tracker/v1${p}`,
}));

import { http } from "../http";
import { requestPullRequestFix } from "../pullRequests";

describe("requestPullRequestFix", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POSTs to the fix endpoint and normalizes the result", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: { moved_to: "Rework", comment_posted: true, jobs: [{ name: "vitest", conclusion: "FAILURE", url: "u" }] } },
    });

    const result = await requestPullRequestFix("proj", "509");

    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/projects/proj/issues/509/pull_requests/fix");
    expect(result).toEqual({
      movedTo: "Rework",
      commentPosted: true,
      jobs: [{ name: "vitest", conclusion: "FAILURE", url: "u" }],
    });
  });
});
```

- \[ \] **Step 3: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/services/__tests__/pullRequests.fix.test.ts`Expected: FAIL — `requestPullRequestFix` is not exported.

- \[ \] **Step 4: Write minimal implementation**

In `tracker/src/services/pullRequests.ts`, extend the type import and add the function at the end:

```ts
// add to the existing type import from "@/types/pull-request":
//   PullRequestFixResult,

interface BackendFixEnvelope {
  data?: {
    moved_to?: string | null;
    comment_posted?: boolean | null;
    jobs?: { name?: string | null; conclusion?: string | null; url?: string | null }[] | null;
  } | null;
}

export async function requestPullRequestFix(
  projectSlug: string,
  identifier: string,
): Promise<PullRequestFixResult> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");

  const response = await http.post<BackendFixEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/pull_requests/fix`,
    ),
  );

  const data = response.data?.data ?? {};
  return {
    movedTo: data.moved_to ?? "Rework",
    commentPosted: data.comment_posted ?? false,
    jobs: (data.jobs ?? []).map((job) => ({
      name: job.name ?? null,
      conclusion: job.conclusion ?? null,
      url: job.url ?? null,
    })),
  };
}
```

- \[ \] **Step 5: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/services/__tests__/pullRequests.fix.test.ts`Expected: PASS.

- \[ \] **Step 6: Commit**

```bash
git add tracker/src/types/pull-request.ts \
        tracker/src/services/pullRequests.ts \
        tracker/src/services/__tests__/pullRequests.fix.test.ts
git commit -m "feat(tracker): add requestPullRequestFix service"
```

---

## Task 9: Frontend — "Fix with agent" button

**Files:**

- Modify: `tracker/src/components/issues/issue-detail/PullRequestTab.tsx`

- Modify: `tracker/src/components/issues/IssueDrawer.tsx`

- \[ \] **Step 1: Add** `projectSlug` **prop + button + handler**

In `PullRequestTab.tsx`:

1. Extend imports:

```tsx
import { useState } from "react";
import { GitPullRequest, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";

import { hasFailingChecks } from "@/components/issues/pull-request/pr-meta";
import { requestPullRequestFix } from "@/services/pullRequests";
```

2. Add `projectSlug: string;` to `PullRequestTabProps` and destructure it.

3. Inside the component, before `return`, add:

```tsx
  const [fixing, setFixing] = useState(false);
  const canFix = pullRequests.some(hasFailingChecks);

  async function handleFix() {
    if (fixing) return;
    setFixing(true);
    try {
      const result = await requestPullRequestFix(projectSlug, issue.identifier);
      toast.success(`Sent to ${result.movedTo} — the agent will pick it up on the next poll.`);
      onRefresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not request a fix.");
    } finally {
      setFixing(false);
    }
  }
```

4. In the header `div` (the one with the Refresh button), add the Fix button before Refresh, shown only when `canFix`:

```tsx
        <div className="flex items-center gap-2">
          {canFix ? (
            <button
              type="button"
              onClick={() => void handleFix()}
              disabled={fixing}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/20 disabled:opacity-60 dark:text-amber-300"
            >
              <Wrench className={cn("h-3.5 w-3.5", fixing && "animate-pulse")} />
              {fixing ? "Sending…" : "Fix with agent"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
```

(Replace the previous standalone Refresh `<button>` with this wrapped pair.)

- \[ \] **Step 2: Pass** `projectSlug` **from IssueDrawer**

In `IssueDrawer.tsx`, update the `<PullRequestTab ... />` usage to add:

```tsx
                    projectSlug={projectSlug}
```

- \[ \] **Step 3: Type-check + lint + build**

Run: `cd tracker && npx tsc -b && npm run lint`Expected: no type errors, no lint errors.

- \[ \] **Step 4: Verify full frontend test suite passes**

Run: `cd tracker && npm run test`Expected: PASS (no regressions).

- \[ \] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/PullRequestTab.tsx \
        tracker/src/components/issues/IssueDrawer.tsx
git commit -m "feat(tracker): add Fix with agent button to PR tab"
```

---

## Task 10: Full gates

**Files:** none (validation only)

- \[ \] **Step 1: Backend gate**

Run: `cd elixir && eval "$(mise activate bash)" && mise exec -- mix format && mise exec -- mix specs.check && mise exec -- mix test`Expected:

- `mix format` rewrites/leaves files clean.

- `mix specs.check` reports only the 3 pre-existing failures documented earlier (`issue_comments.ex` x2 and the `for_issue/3` multi-clause quirk) — **no new** missing specs from the files added here. Add `@spec` to any new public `def` that the tool flags from new modules.

- `mix test` green.

- \[ \] **Step 2: Frontend gate**

Run: `cd tracker && npm run lint && npx tsc -b && npm run test`Expected: all green.

- \[ \] **Step 3: Commit any formatting fixups**

```bash
git add -A
git commit -m "chore: formatting and spec fixups for PR fix feature"
```

(Skip if nothing changed.)

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
| --- | --- |
| Button visible only on failing checks + GitHub project | Task 7 (`hasFailingChecks`), Task 9 (gating; `supported/available` already gate the tab) |
| `POST .../pull_requests/fix` endpoint | Task 6 |
| Resolve failing jobs via `PullRequests.for_issue` | Task 4 (`collect_failing`) |
| `databaseId` → `job_id` + URL fallback | Task 1 |
| REST GET helper following redirect | Task 2 |
| Download + tail-clean log (strip timestamp/ANSI, line+char cap, max jobs) | Task 3, Task 4 (`@max_jobs`) |
| Structured comment (PR #, URL, job, excerpt, "log unavailable") | Task 4 |
| Post comment then move to `Rework` | Task 4 (`request_fix`), Task 5 (order asserted) |
| `:no_failing_checks` guard → 422 | Task 4 (`ensure_present`), Task 6 (`TrackerErrors`) |
| Per-job log failure → keep job w/ note, don't fail action | Task 4 (`fetch_excerpt` returns nil) |
| Frontend service + normalization | Task 8 |
| Loading/disabled + toast + refetch | Task 9 |
| Non-GitHub / no-token degrade | Existing tab gates (`supported`/`available`) + endpoint errors (Task 6) |

**Placeholder scan:** Controller test references sibling-test helpers (`create_github_project/0`, `put_tracker_auth/1`) — explicitly flagged to copy from `comment_controller_test.exs`; not an unresolved TBD. No other placeholders.

**Type consistency:** `job_id` (Elixir `:job_id`, integer|nil) introduced in Task 1 and consumed in Task 4. `PullRequestFixResult` introduced in Task 8 and consumed in Task 9. `hasFailingChecks` introduced in Task 7 and consumed in Task 9. Backend `result.status`/`result.jobs` (Task 4) map to controller JSON `moved_to`/`jobs` (Task 6) → frontend `movedTo`/`jobs` (Task 8).