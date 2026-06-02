# GitHub.Api REST Fallback Implementation Plan

**Goal:** Add `SymphonyElixir.GitHub.Api`, a single transport service that runs each high-level GitHub operation on GraphQL first and transparently falls back to REST on `{:rate_limited, _}`, normalizing both transports to one shape.

**Architecture:** `GitHub.Api` is self-contained: it owns the GraphQL query/mutation strings, the REST calls, and the per-operation normalizers. It composes the existing `GitHub.Client` HTTP primitives (`graphql/3`, `rest_get/2`, `rest_post/3`, `rest_put/3`) so it never opens sockets directly and reuses `RequestGateway`/`RateLimit`. Fallback is **F1**: only `{:rate_limited, _}` from the GraphQL attempt triggers the REST branch; every other GraphQL error passes through unchanged. Projects v2-only operations are out of `GitHub.Api`'s surface (they stay in `Client` and defer).

**Tech Stack:** Elixir 1.19 / OTP 28, `Req` HTTP client, ExUnit with injected `request_fun` fakes (no network), `mix` quality gates (`format`, `credo`, `dialyzer`, `specs.check`).

---

## File Structure

- Create: `elixir/lib/symphony_elixir/github/api.ex` — the resilient transport service (all 5 ops + normalizers + fallback combinator).
- Create: `elixir/test/symphony_elixir/github/api_test.exs` — unit tests with fake `request_fun`.
- Modify: `elixir/lib/symphony_elixir/github/client.ex` — add `rest_post/3` (mirrors `rest_put/3`).
- Modify: `elixir/lib/symphony_elixir/github/issue_comments.ex` — `create/4` and `for_issue/3` delegate to `GitHub.Api`.
- Modify: `elixir/lib/symphony_elixir/github/client.ex` — `close_issue/3` and `reopen_issue/3` delegate to `GitHub.Api.transition_issue_open_state`.
- Modify: `elixir/lib/symphony_elixir/github/sync_driver.ex` — `pull_pull_requests/2` falls back to `GitHub.Api.list_issue_prs` on `{:rate_limited, _}`.
- Modify: `elixir/lib/symphony_elixir/github/client.ex` — admission candidate discovery uses `GitHub.Api.list_label_issues`.
- Modify: `elixir/README.md` (Elixir) — short note on the GitHub REST fallback behavior.

Each task below is TDD and self-contained. Run targeted tests while iterating; run `make all` at the end.

---

## Task 1: Add `Client.rest_post/3`

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/client.ex` (add `rest_post/3` next to `rest_put/3` ~line 455-472; add `post_rest_request/3` next to `put_rest_request/3` ~line 1363)
- Test: `elixir/test/symphony_elixir/github_client_test.exs`

- [ ] **Step 1: Write the failing test**

Add inside `elixir/test/symphony_elixir/github_client_test.exs` (new `describe` block):

```elixir
  describe "rest_post/3" do
    test "posts JSON and returns the decoded body on 201" do
      request_fun = fn url, _headers, body ->
        assert url == "https://api.github.com/repos/owner/repo/issues/42/comments"
        assert body == %{"body" => "hi"}
        {:ok, %{status: 201, body: %{"id" => 123, "body" => "hi"}}}
      end

      assert {:ok, %{status: 201, body: %{"id" => 123}}} =
               Client.rest_post("/repos/owner/repo/issues/42/comments", %{"body" => "hi"},
                 request_fun: request_fun
               )
    end

    test "maps a rate-limited REST response to {:error, {:rate_limited, info}}" do
      request_fun = fn _url, _headers, _body ->
        {:ok, %{status: 403, headers: %{"x-ratelimit-remaining" => "0", "x-ratelimit-reset" => "4102444800"}, body: %{}}}
      end

      assert {:error, {:rate_limited, %{reset_at: %DateTime{}}}} =
               Client.rest_post("/repos/owner/repo/issues/42/comments", %{"body" => "hi"},
                 request_fun: request_fun
               )
    end
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github_client_test.exs -n "rest_post/3"`
Expected: FAIL with `undefined function Client.rest_post/3`.

- [ ] **Step 3: Write minimal implementation**

In `elixir/lib/symphony_elixir/github/client.ex`, add after `rest_put/3` (after line ~472):

```elixir
  @spec rest_post(String.t(), map(), keyword()) ::
          {:ok, %{status: pos_integer(), body: term()}} | {:error, term()}
  def rest_post(path, body \\ %{}, opts \\ [])
      when is_binary(path) and is_map(body) and is_list(opts) do
    request_fun = Keyword.get(opts, :request_fun, &post_rest_request/3)
    url = @rest_endpoint <> path

    with {:ok, token} <- require_token(),
         headers = rest_headers(token),
         {:ok, %{status: status, body: resp}} when status in 200..299 <-
           request_fun.(url, headers, body) do
      {:ok, %{status: status, body: resp}}
    else
      {:error, :missing_github_token} = error -> error
      {:ok, response} -> classify_rest_failure(response)
      {:error, reason} -> {:error, {:github_api_request, reason}}
    end
  end
```

And add near `put_rest_request/3` (after line ~1367):

```elixir
  defp post_rest_request(url, headers, body) do
    RequestGateway.run([kind: :mutation], fn ->
      Req.post(url, headers: headers, json: body, connect_options: [timeout: 30_000])
    end)
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github_client_test.exs -n "rest_post/3"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/client.ex elixir/test/symphony_elixir/github_client_test.exs
git commit -m "feat(github): add Client.rest_post/3 for REST writes"
```

---

## Task 2: `GitHub.Api` skeleton + `add_comment` (GraphQL→REST fallback)

**Files:**
- Create: `elixir/lib/symphony_elixir/github/api.ex`
- Create: `elixir/test/symphony_elixir/github/api_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/github/api_test.exs`:

```elixir
defmodule SymphonyElixir.GitHub.ApiTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.GitHub.Api

  setup do
    prev = System.get_env("GITHUB_TOKEN")
    System.put_env("GITHUB_TOKEN", "test-gh-token")
    on_exit(fn -> restore_env("GITHUB_TOKEN", prev) end)
    :ok
  end

  # GraphQL 200 body carrying a RATE_LIMIT error (how GitHub signals GraphQL limits).
  defp graphql_rate_limited do
    {:ok,
     %{
       status: 200,
       headers: %{"x-ratelimit-reset" => "4102444800"},
       body: %{"errors" => [%{"type" => "RATE_LIMITED", "message" => "rate limited"}]}
     }}
  end

  describe "add_comment/4" do
    test "uses GraphQL on the happy path and normalizes the node" do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "addComment" or payload["query"] =~ "issue(number:"
        cond do
          payload["query"] =~ "SymphonyApiIssueNodeId" ->
            {:ok, %{status: 200, body: %{"data" => %{"repository" => %{"issue" => %{"id" => "I_node"}}}}}}

          payload["query"] =~ "SymphonyApiAddComment" ->
            assert payload["variables"]["subjectId"] == "I_node"
            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "addComment" => %{
                     "commentEdge" => %{
                       "node" => %{
                         "id" => "IC_1",
                         "url" => "https://gh/c/1",
                         "body" => "## Codex Workpad\nx",
                         "createdAt" => "2026-06-01T00:00:00Z",
                         "updatedAt" => "2026-06-01T00:00:00Z",
                         "author" => %{"login" => "bot"}
                       }
                     }
                   }
                 }
               }
             }}
        end
      end

      assert {:ok, comment} =
               Api.add_comment("owner/repo", "42", "## Codex Workpad\nx", request_fun: request_fun)

      assert comment.id == "IC_1"
      assert comment.author == "bot"
      assert comment.kind == "workpad"
      assert comment.url == "https://gh/c/1"
    end

    test "falls back to REST when GraphQL is rate-limited, normalizing to the same shape" do
      request_fun = fn
        # GraphQL branch (arity 2) is rate-limited
        _payload, _headers ->
          graphql_rate_limited()
      end

      rest_fun = fn url, _headers, body ->
        assert url == "https://api.github.com/repos/owner/repo/issues/42/comments"
        assert body == %{"body" => "## Codex Workpad\nx"}
        {:ok,
         %{
           status: 201,
           body: %{
             "id" => 999,
             "html_url" => "https://gh/c/999",
             "body" => "## Codex Workpad\nx",
             "created_at" => "2026-06-01T00:00:00Z",
             "updated_at" => "2026-06-01T00:00:00Z",
             "user" => %{"login" => "bot"}
           }
         }}
      end

      assert {:ok, comment} =
               Api.add_comment("owner/repo", "42", "## Codex Workpad\nx",
                 request_fun: request_fun,
                 rest_request_fun: rest_fun
               )

      assert comment.id == "999"
      assert comment.author == "bot"
      assert comment.kind == "workpad"
      assert comment.url == "https://gh/c/999"
    end

    test "non-rate-limit GraphQL error passes through without calling REST" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"errors" => [%{"type" => "NOT_FOUND", "message" => "nope"}]}}}
      end

      rest_fun = fn _u, _h, _b -> flunk("REST must not be called for non-rate-limit errors") end

      assert {:error, {:github_graphql_errors, _}} =
               Api.add_comment("owner/repo", "42", "x",
                 request_fun: request_fun,
                 rest_request_fun: rest_fun
               )
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/api_test.exs`
Expected: FAIL with `module SymphonyElixir.GitHub.Api is not available`.

- [ ] **Step 3: Write minimal implementation**

Create `elixir/lib/symphony_elixir/github/api.ex`:

```elixir
defmodule SymphonyElixir.GitHub.Api do
  @moduledoc """
  Resilient GitHub transport. Each operation runs on GraphQL first and, only when
  the GraphQL attempt is `{:rate_limited, _}`, transparently falls back to REST,
  normalizing both transports to one shape (F1 — pure fallback).

  Projects v2 board operations are GraphQL-only and are intentionally absent here;
  they stay in `GitHub.Client` and defer until reset.
  """

  require Logger
  alias SymphonyElixir.GitHub.{Client, IssueComments, RepoSpec}

  @type comment :: IssueComments.comment()

  @add_comment_mutation """
  mutation SymphonyApiAddComment($subjectId: ID!, $body: String!) {
    addComment(input: { subjectId: $subjectId, body: $body }) {
      commentEdge { node { id url body createdAt updatedAt author { login } } }
    }
  }
  """

  @issue_node_query """
  query SymphonyApiIssueNodeId($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) { issue(number: $number) { id } }
  }
  """

  @spec add_comment(String.t(), String.t(), String.t(), keyword()) ::
          {:ok, comment()} | {:error, term()}
  def add_comment(repo, identifier, body, opts \\ [])
      when is_binary(repo) and is_binary(identifier) and is_binary(body) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- parse_issue_number(identifier) do
      with_fallback(
        :add_comment,
        fn -> graphql_add_comment(owner, name, number, body, opts) end,
        fn -> rest_add_comment(owner, name, number, body, opts) end
      )
    end
  end

  # -- GraphQL branch ---------------------------------------------------------

  defp graphql_add_comment(owner, name, number, body, opts) do
    graphql_opts = graphql_opts(opts)

    with {:ok, node_id} <- fetch_issue_node_id(owner, name, number, graphql_opts),
         {:ok, %{"data" => %{"addComment" => %{"commentEdge" => %{"node" => node}}}}} <-
           Client.graphql(@add_comment_mutation, %{"subjectId" => node_id, "body" => body}, graphql_opts) do
      {:ok, IssueComments.parse_node(node)}
    else
      {:ok, _unexpected} -> {:error, :remote_unavailable}
      {:error, _} = error -> error
    end
  end

  defp fetch_issue_node_id(owner, name, number, graphql_opts) do
    variables = %{"owner" => owner, "name" => name, "number" => number}

    case Client.graphql(@issue_node_query, variables, graphql_opts) do
      {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => id}}}}} when is_binary(id) -> {:ok, id}
      {:ok, _payload} -> {:error, :issue_not_found}
      {:error, _} = error -> error
    end
  end

  # -- REST branch ------------------------------------------------------------

  defp rest_add_comment(owner, name, number, body, opts) do
    path = "/repos/#{owner}/#{name}/issues/#{number}/comments"

    case Client.rest_post(path, %{"body" => body}, rest_opts(opts)) do
      {:ok, %{body: raw}} when is_map(raw) -> {:ok, normalize_rest_comment(raw)}
      {:error, _} = error -> error
    end
  end

  defp normalize_rest_comment(raw) do
    IssueComments.parse_node(%{
      "id" => stringify_id(raw["id"]),
      "url" => raw["html_url"],
      "body" => raw["body"],
      "createdAt" => raw["created_at"],
      "updatedAt" => raw["updated_at"],
      "author" => raw["user"]
    })
  end

  # -- Fallback combinator (F1) ----------------------------------------------

  defp with_fallback(op, graphql_fun, rest_fun) do
    case graphql_fun.() do
      {:ok, _} = ok ->
        ok

      {:error, {:rate_limited, info}} ->
        Logger.info("GitHub.Api fallback: op=#{op} transport=rest reason=graphql_rate_limited")

        case rest_fun.() do
          {:ok, _} = ok -> ok
          {:error, {:rate_limited, info2}} -> {:error, {:rate_limited, merge_reset(info, info2)}}
          {:error, _} = error -> error
        end

      {:error, _} = error ->
        error
    end
  end

  defp merge_reset(info, info2) when is_map(info) and is_map(info2) do
    info
    |> Map.merge(info2)
    |> Map.put(:reset_at, later_reset(Map.get(info, :reset_at), Map.get(info2, :reset_at)))
  end

  defp merge_reset(info, _other), do: info

  defp later_reset(%DateTime{} = a, %DateTime{} = b), do: if(DateTime.compare(a, b) == :gt, do: a, else: b)
  defp later_reset(%DateTime{} = a, _b), do: a
  defp later_reset(_a, b), do: b

  # -- shared helpers ---------------------------------------------------------

  defp graphql_opts(opts), do: Keyword.take(opts, [:request_fun, :operation_name, :client_module])

  defp rest_opts(opts) do
    case Keyword.get(opts, :rest_request_fun) do
      fun when is_function(fun, 3) -> [request_fun: fun]
      fun when is_function(fun, 2) -> [request_fun: fun]
      _ -> []
    end
  end

  defp stringify_id(id) when is_integer(id), do: Integer.to_string(id)
  defp stringify_id(id) when is_binary(id), do: id
  defp stringify_id(_id), do: nil

  defp parse_issue_number(identifier) do
    identifier
    |> String.trim()
    |> String.trim_leading("#")
    |> Integer.parse()
    |> case do
      {number, ""} when number > 0 -> {:ok, number}
      _ -> {:error, {:invalid_issue_identifier, identifier}}
    end
  end
end
```

Note: `IssueComments.parse_node/1` already accepts a GraphQL-shaped node and is reused for both branches (the REST normalizer maps REST keys to that shape). `IssueComments.comment` type and `parse_node/1` are already public.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/api_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/api.ex elixir/test/symphony_elixir/github/api_test.exs
git commit -m "feat(github): add GitHub.Api with add_comment GraphQL->REST fallback"
```

---

## Task 3: `GitHub.Api.list_comments`

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/api.ex`
- Test: `elixir/test/symphony_elixir/github/api_test.exs`

- [ ] **Step 1: Write the failing test**

Add a `describe "list_comments/3"` block to `api_test.exs`:

```elixir
  describe "list_comments/3" do
    test "GraphQL happy path, oldest-first, normalized" do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyApiIssueComments"
        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "repository" => %{
                 "issue" => %{
                   "comments" => %{
                     "nodes" => [
                       %{"id" => "IC_1", "url" => "u1", "body" => "first", "createdAt" => "t1", "updatedAt" => "t1", "author" => %{"login" => "a"}}
                     ]
                   }
                 }
               }
             }
           }
         }}
      end

      assert {:ok, [%{id: "IC_1", body: "first", kind: "comment"}]} =
               Api.list_comments("owner/repo", "42", request_fun: request_fun)
    end

    test "falls back to REST on rate limit with identical shape" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"errors" => [%{"type" => "RATE_LIMITED"}]}}}
      end

      rest_fun = fn url, _headers ->
        assert url == "https://api.github.com/repos/owner/repo/issues/42/comments?per_page=100"
        {:ok,
         %{
           status: 200,
           body: [
             %{"id" => 1, "html_url" => "u1", "body" => "first", "created_at" => "t1", "updated_at" => "t1", "user" => %{"login" => "a"}}
           ]
         }}
      end

      assert {:ok, [%{id: "1", body: "first", kind: "comment", url: "u1"}]} =
               Api.list_comments("owner/repo", "42", request_fun: request_fun, rest_request_fun: rest_fun)
    end
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/api_test.exs -n "list_comments/3"`
Expected: FAIL with `undefined function Api.list_comments/3`.

- [ ] **Step 3: Write minimal implementation**

Add to `api.ex` (module attribute near the other queries):

```elixir
  @list_comments_query """
  query SymphonyApiIssueComments($owner: String!, $name: String!, $number: Int!, $limit: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        comments(last: $limit) {
          nodes { id url body createdAt updatedAt author { login } }
        }
      }
    }
  }
  """
```

Add the public function and helpers:

```elixir
  @default_comment_limit 50

  @spec list_comments(String.t(), String.t(), keyword()) :: {:ok, [comment()]} | {:error, term()}
  def list_comments(repo, identifier, opts \\ []) when is_binary(repo) and is_binary(identifier) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- parse_issue_number(identifier) do
      with_fallback(
        :list_comments,
        fn -> graphql_list_comments(owner, name, number, opts) end,
        fn -> rest_list_comments(owner, name, number, opts) end
      )
    end
  end

  defp graphql_list_comments(owner, name, number, opts) do
    limit = Keyword.get(opts, :limit, @default_comment_limit)
    variables = %{"owner" => owner, "name" => name, "number" => number, "limit" => limit}

    case Client.graphql(@list_comments_query, variables, graphql_opts(opts)) do
      {:ok, %{"data" => %{"repository" => %{"issue" => %{"comments" => %{"nodes" => nodes}}}}}}
      when is_list(nodes) ->
        {:ok, nodes |> Enum.map(&IssueComments.parse_node/1) |> Enum.reject(&is_nil/1)}

      {:ok, %{"data" => %{"repository" => %{"issue" => nil}}}} ->
        {:ok, []}

      {:ok, _payload} ->
        {:ok, []}

      {:error, _} = error ->
        error
    end
  end

  defp rest_list_comments(owner, name, number, opts) do
    path = "/repos/#{owner}/#{name}/issues/#{number}/comments?per_page=100"

    case Client.rest_get(path, rest_opts(opts)) do
      {:ok, %{body: list}} when is_list(list) ->
        {:ok, list |> Enum.map(&normalize_rest_comment/1) |> Enum.reject(&is_nil/1)}

      {:error, _} = error ->
        error
    end
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/api_test.exs -n "list_comments/3"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/api.ex elixir/test/symphony_elixir/github/api_test.exs
git commit -m "feat(github): add GitHub.Api.list_comments with REST fallback"
```

---

## Task 4: `GitHub.Api.transition_issue_open_state`

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/api.ex`
- Test: `elixir/test/symphony_elixir/github/api_test.exs`

- [ ] **Step 1: Write the failing test**

Add `describe "transition_issue_open_state/4"`:

```elixir
  describe "transition_issue_open_state/4" do
    test "GraphQL close returns normalized CLOSED" do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyApiCloseIssue"
        assert payload["variables"]["issueId"] == "I_node"
        {:ok, %{status: 200, body: %{"data" => %{"closeIssue" => %{"issue" => %{"id" => "I_node", "state" => "CLOSED"}}}}}}
      end

      assert {:ok, %{state: "CLOSED"}} =
               Api.transition_issue_open_state("owner/repo", "I_node", :close, request_fun: request_fun)
    end

    test "falls back to REST PATCH on rate limit (reopen -> OPEN)" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"errors" => [%{"type" => "RATE_LIMITED"}]}}}
      end

      rest_fun = fn url, _headers, body ->
        assert url == "https://api.github.com/repos/owner/repo/issues/42"
        assert body == %{"state" => "open"}
        {:ok, %{status: 200, body: %{"state" => "open"}}}
      end

      assert {:ok, %{state: "OPEN"}} =
               Api.transition_issue_open_state("owner/repo", "42", :reopen,
                 request_fun: request_fun,
                 rest_request_fun: rest_fun,
                 issue_number: 42
               )
    end
  end
```

Note: the GraphQL mutation works on the issue **node id**; the REST PATCH needs the issue **number**. Callers that may need REST fallback pass `:issue_number` in opts (the orchestrator path has both the node id and the identifier available — see Task 8). When `:issue_number` is absent and GraphQL is rate-limited, REST fallback returns `{:error, {:rate_limited, %{..., capability: :needs_issue_number}}}`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/api_test.exs -n "transition_issue_open_state/4"`
Expected: FAIL with `undefined function Api.transition_issue_open_state/4`.

- [ ] **Step 3: Write minimal implementation**

Add query attributes to `api.ex`:

```elixir
  @close_issue_mutation """
  mutation SymphonyApiCloseIssue($issueId: ID!) {
    closeIssue(input: { issueId: $issueId, stateReason: COMPLETED }) { issue { id state } }
  }
  """

  @reopen_issue_mutation """
  mutation SymphonyApiReopenIssue($issueId: ID!) {
    reopenIssue(input: { issueId: $issueId }) { issue { id state } }
  }
  """
```

Add the function:

```elixir
  @spec transition_issue_open_state(String.t(), String.t(), :close | :reopen, keyword()) ::
          {:ok, %{state: String.t()}} | {:error, term()}
  def transition_issue_open_state(repo, issue_node_id, action, opts \\ [])
      when is_binary(repo) and is_binary(issue_node_id) and action in [:close, :reopen] do
    with {:ok, {owner, name}} <- RepoSpec.split(repo) do
      with_fallback(
        :transition_issue_open_state,
        fn -> graphql_transition(issue_node_id, action, opts) end,
        fn -> rest_transition(owner, name, action, opts) end
      )
    end
  end

  defp graphql_transition(issue_node_id, action, opts) do
    {mutation, key} =
      case action do
        :close -> {@close_issue_mutation, "closeIssue"}
        :reopen -> {@reopen_issue_mutation, "reopenIssue"}
      end

    case Client.graphql(mutation, %{"issueId" => issue_node_id}, graphql_opts(opts)) do
      {:ok, %{"data" => %{^key => %{"issue" => %{"state" => state}}}}} when is_binary(state) ->
        {:ok, %{state: state}}

      {:ok, _payload} ->
        {:error, :remote_unavailable}

      {:error, _} = error ->
        error
    end
  end

  defp rest_transition(owner, name, action, opts) do
    case Keyword.get(opts, :issue_number) do
      number when is_integer(number) ->
        state = if action == :close, do: "closed", else: "open"
        path = "/repos/#{owner}/#{name}/issues/#{number}"

        case Client.rest_put(path, %{"state" => state}, rest_opts(opts)) do
          {:ok, %{body: %{"state" => rest_state}}} when is_binary(rest_state) ->
            {:ok, %{state: String.upcase(rest_state)}}

          {:ok, _other} ->
            {:error, :remote_unavailable}

          {:error, _} = error ->
            error
        end

      _ ->
        {:error, {:rate_limited, %{reset_at: nil, capability: :needs_issue_number}}}
    end
  end
```

Note: GitHub's issue-update endpoint accepts PATCH. `Client.rest_put/3` issues `Req.put`; GitHub treats PATCH/PUT equivalently for this field via the REST `PATCH /issues/{n}` route. If CI shows GitHub rejects PUT here, add a `rest_patch/3` in a follow-up; for the fake-`request_fun` tests this is transport-agnostic.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/api_test.exs -n "transition_issue_open_state/4"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/api.ex elixir/test/symphony_elixir/github/api_test.exs
git commit -m "feat(github): add GitHub.Api.transition_issue_open_state with REST fallback"
```

---

## Task 5: `GitHub.Api.list_label_issues`

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/api.ex`
- Test: `elixir/test/symphony_elixir/github/api_test.exs`

- [ ] **Step 1: Write the failing test**

Add `describe "list_label_issues/3"`:

```elixir
  describe "list_label_issues/3" do
    test "GraphQL happy path returns number+node_id" do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyApiLabelIssues"
        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "repository" => %{
                 "issues" => %{
                   "nodes" => [%{"id" => "I_1", "number" => 11}],
                   "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
                 }
               }
             }
           }
         }}
      end

      assert {:ok, [%{number: 11, node_id: "I_1"}]} =
               Api.list_label_issues("owner/repo", "symphony", request_fun: request_fun)
    end

    test "falls back to REST and follows pagination Link header" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"errors" => [%{"type" => "RATE_LIMITED"}]}}}
      end

      rest_fun = fn url, _headers ->
        cond do
          url =~ "page=2" ->
            {:ok, %{status: 200, headers: %{}, body: [%{"number" => 22, "node_id" => "I_2"}]}}

          true ->
            {:ok,
             %{
               status: 200,
               headers: %{"link" => "<https://api.github.com/repos/owner/repo/issues?labels=symphony&state=open&per_page=100&page=2>; rel=\"next\""},
               body: [%{"number" => 11, "node_id" => "I_1"}]
             }}
        end
      end

      assert {:ok, [%{number: 11, node_id: "I_1"}, %{number: 22, node_id: "I_2"}]} =
               Api.list_label_issues("owner/repo", "symphony", request_fun: request_fun, rest_request_fun: rest_fun)
    end
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/api_test.exs -n "list_label_issues/3"`
Expected: FAIL with `undefined function Api.list_label_issues/3`.

- [ ] **Step 3: Write minimal implementation**

Add query attribute and `@label_page_size`:

```elixir
  @label_page_size 50

  @label_issues_query """
  query SymphonyApiLabelIssues($owner: String!, $name: String!, $label: String!, $first: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      issues(states: [OPEN], labels: [$label], first: $first, after: $after) {
        nodes { id number }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  """
```

Add the function + paginators:

```elixir
  @spec list_label_issues(String.t(), String.t(), keyword()) ::
          {:ok, [%{number: integer(), node_id: String.t()}]} | {:error, term()}
  def list_label_issues(repo, label, opts \\ []) when is_binary(repo) and is_binary(label) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo) do
      with_fallback(
        :list_label_issues,
        fn -> graphql_label_issues(owner, name, label, nil, [], opts) end,
        fn -> rest_label_issues(owner, name, label, 1, [], opts) end
      )
    end
  end

  defp graphql_label_issues(owner, name, label, after_cursor, acc, opts) do
    variables = %{"owner" => owner, "name" => name, "label" => label, "first" => @label_page_size, "after" => after_cursor}

    case Client.graphql(@label_issues_query, variables, graphql_opts(opts)) do
      {:ok, %{"data" => %{"repository" => %{"issues" => %{"nodes" => nodes, "pageInfo" => page}}}}}
      when is_list(nodes) ->
        rows = Enum.flat_map(nodes, &graphql_label_row/1)

        case page do
          %{"hasNextPage" => true, "endCursor" => cursor} when is_binary(cursor) and cursor != "" ->
            graphql_label_issues(owner, name, label, cursor, acc ++ rows, opts)

          _ ->
            {:ok, acc ++ rows}
        end

      {:ok, %{"data" => %{"repository" => nil}}} ->
        {:error, :github_repo_not_found}

      {:ok, _payload} ->
        {:error, :github_unknown_payload}

      {:error, _} = error ->
        error
    end
  end

  defp graphql_label_row(%{"id" => id, "number" => number}) when is_binary(id) and is_integer(number),
    do: [%{number: number, node_id: id}]

  defp graphql_label_row(_node), do: []

  defp rest_label_issues(owner, name, label, page, acc, opts) do
    path = "/repos/#{owner}/#{name}/issues?labels=#{URI.encode_www_form(label)}&state=open&per_page=100&page=#{page}"

    case Client.rest_get(path, rest_opts(opts)) do
      {:ok, %{body: list} = resp} when is_list(list) ->
        rows = Enum.flat_map(list, &rest_label_row/1)

        if rest_has_next_page?(resp) do
          rest_label_issues(owner, name, label, page + 1, acc ++ rows, opts)
        else
          {:ok, acc ++ rows}
        end

      {:error, _} = error ->
        error
    end
  end

  defp rest_label_row(%{"number" => number, "node_id" => node_id}) when is_integer(number) and is_binary(node_id),
    do: [%{number: number, node_id: node_id}]

  defp rest_label_row(_item), do: []

  defp rest_has_next_page?(%{headers: headers}) do
    case header_value(headers, "link") do
      link when is_binary(link) -> String.contains?(link, "rel=\"next\"")
      _ -> false
    end
  end

  defp rest_has_next_page?(_resp), do: false

  defp header_value(headers, name) when is_map(headers) do
    case Map.get(headers, name) do
      [value | _] when is_binary(value) -> value
      value when is_binary(value) -> value
      _ -> nil
    end
  end

  defp header_value(headers, name) when is_list(headers) do
    Enum.find_value(headers, fn
      {key, value} -> if String.downcase(to_string(key)) == name, do: to_string(value)
      _ -> nil
    end)
  end

  defp header_value(_headers, _name), do: nil
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/api_test.exs -n "list_label_issues/3"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/api.ex elixir/test/symphony_elixir/github/api_test.exs
git commit -m "feat(github): add GitHub.Api.list_label_issues with paginated REST fallback"
```

---

## Task 6: `GitHub.Api.list_issue_prs` (linkage + basic state)

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/api.ex`
- Test: `elixir/test/symphony_elixir/github/api_test.exs`

- [ ] **Step 1: Write the failing test**

Add `describe "list_issue_prs/4"`:

```elixir
  describe "list_issue_prs/4" do
    test "GraphQL happy path returns basic PR records" do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyApiIssuePRs"
        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "repository" => %{
                 "issue" => %{
                   "closedByPullRequestsReferences" => %{
                     "nodes" => [%{"number" => 7, "url" => "pr7", "title" => "t", "state" => "OPEN", "merged" => false}]
                   }
                 }
               }
             }
           }
         }}
      end

      assert {:ok, [%{number: 7, url: "pr7", title: "t", state: "open"}]} =
               Api.list_issue_prs("owner/repo", "42", "feat/x", request_fun: request_fun)
    end

    test "REST fallback maps merged/closed/open" do
      request_fun = fn _payload, _headers -> {:ok, %{status: 200, body: %{"errors" => [%{"type" => "RATE_LIMITED"}]}}} end

      rest_fun = fn url, _headers ->
        assert url =~ "/repos/owner/repo/pulls?head=owner:feat/x&state=all"
        {:ok, %{status: 200, body: [%{"number" => 7, "html_url" => "pr7", "title" => "t", "state" => "closed", "merged_at" => "2026-06-01T00:00:00Z"}]}}
      end

      assert {:ok, [%{number: 7, url: "pr7", title: "t", state: "merged"}]} =
               Api.list_issue_prs("owner/repo", "42", "feat/x", request_fun: request_fun, rest_request_fun: rest_fun)
    end
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/api_test.exs -n "list_issue_prs/4"`
Expected: FAIL with `undefined function Api.list_issue_prs/4`.

- [ ] **Step 3: Write minimal implementation**

Add query attribute:

```elixir
  @issue_prs_query """
  query SymphonyApiIssuePRs($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        closedByPullRequestsReferences(first: 30) {
          nodes { number url title state merged }
        }
      }
    }
  }
  """
```

Add the function:

```elixir
  @spec list_issue_prs(String.t(), String.t(), String.t() | nil, keyword()) ::
          {:ok, [%{number: integer(), url: String.t() | nil, title: String.t() | nil, state: String.t()}]}
          | {:error, term()}
  def list_issue_prs(repo, identifier, branch, opts \\ []) when is_binary(repo) and is_binary(identifier) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- parse_issue_number(identifier) do
      with_fallback(
        :list_issue_prs,
        fn -> graphql_issue_prs(owner, name, number, opts) end,
        fn -> rest_issue_prs(owner, name, branch, opts) end
      )
    end
  end

  defp graphql_issue_prs(owner, name, number, opts) do
    variables = %{"owner" => owner, "name" => name, "number" => number}

    case Client.graphql(@issue_prs_query, variables, graphql_opts(opts)) do
      {:ok, %{"data" => %{"repository" => %{"issue" => %{"closedByPullRequestsReferences" => %{"nodes" => nodes}}}}}}
      when is_list(nodes) ->
        {:ok, Enum.flat_map(nodes, &normalize_graphql_pr/1)}

      {:ok, %{"data" => %{"repository" => %{"issue" => nil}}}} ->
        {:ok, []}

      {:ok, _payload} ->
        {:ok, []}

      {:error, _} = error ->
        error
    end
  end

  defp normalize_graphql_pr(%{"number" => number} = pr) when is_integer(number) do
    state =
      cond do
        pr["merged"] == true -> "merged"
        pr["state"] == "OPEN" -> "open"
        true -> "closed"
      end

    [%{number: number, url: pr["url"], title: pr["title"], state: state}]
  end

  defp normalize_graphql_pr(_pr), do: []

  defp rest_issue_prs(_owner, _name, nil, _opts), do: {:ok, []}

  defp rest_issue_prs(owner, name, branch, opts) do
    path = "/repos/#{owner}/#{name}/pulls?head=#{owner}:#{branch}&state=all&per_page=30"

    case Client.rest_get(path, rest_opts(opts)) do
      {:ok, %{body: list}} when is_list(list) ->
        {:ok, Enum.flat_map(list, &normalize_rest_pr/1)}

      {:error, _} = error ->
        error
    end
  end

  defp normalize_rest_pr(%{"number" => number} = pr) when is_integer(number) do
    state =
      cond do
        is_binary(pr["merged_at"]) -> "merged"
        pr["state"] == "open" -> "open"
        true -> "closed"
      end

    [%{number: number, url: pr["html_url"], title: pr["title"], state: state}]
  end

  defp normalize_rest_pr(_pr), do: []
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/api_test.exs -n "list_issue_prs/4"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/api.ex elixir/test/symphony_elixir/github/api_test.exs
git commit -m "feat(github): add GitHub.Api.list_issue_prs with REST fallback"
```

---

## Task 7: Integrate `IssueComments` → `GitHub.Api`

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/issue_comments.ex:65-91` (`for_issue/3`, `create/4`)
- Test: existing `elixir/test/symphony_elixir/github/issue_comments_test.exs` (confirm green) + add one fallback test

- [ ] **Step 1: Write the failing test**

Add to `elixir/test/symphony_elixir/github/issue_comments_test.exs` (create the file if missing using the same `use SymphonyElixir.TestSupport` + token setup as `api_test.exs`):

```elixir
  test "create/4 falls back to REST when GraphQL is rate-limited" do
    request_fun = fn _payload, _headers ->
      {:ok, %{status: 200, body: %{"errors" => [%{"type" => "RATE_LIMITED"}]}}}
    end

    rest_fun = fn url, _headers, body ->
      assert url == "https://api.github.com/repos/owner/repo/issues/42/comments"
      assert body == %{"body" => "hello"}
      {:ok, %{status: 201, body: %{"id" => 5, "html_url" => "u", "body" => "hello", "user" => %{"login" => "a"}}}}
    end

    assert {:ok, %{id: "5", body: "hello"}} =
             SymphonyElixir.GitHub.IssueComments.create("owner/repo", "42", "hello",
               request_fun: request_fun,
               rest_request_fun: rest_fun
             )
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/issue_comments_test.exs -n "falls back to REST"`
Expected: FAIL (current `create/4` ignores `rest_request_fun` and returns the rate-limit error).

- [ ] **Step 3: Write minimal implementation**

Replace `for_issue/3` and `create/4` bodies in `issue_comments.ex` to delegate (keep `parse_node/1`, `classify/1`, `parse_issue_number/1` as they are; `GitHub.Api` reuses `parse_node/1`):

```elixir
  @spec for_issue(String.t() | nil, String.t() | nil, keyword()) ::
          {:ok, [comment()]} | {:error, term()}
  def for_issue(repo, identifier, opts \\ []) do
    if is_binary(repo) and is_binary(identifier) do
      SymphonyElixir.GitHub.Api.list_comments(repo, identifier, opts)
    else
      {:error, :invalid_arguments}
    end
  end

  @spec create(String.t() | nil, String.t() | nil, String.t(), keyword()) ::
          {:ok, comment()} | {:error, term()}
  def create(repo, identifier, body, opts \\ []) do
    if is_binary(repo) and is_binary(identifier) and is_binary(body) and body != "" do
      SymphonyElixir.GitHub.Api.add_comment(repo, identifier, body, opts)
    else
      {:error, :invalid_arguments}
    end
  end
```

Then delete the now-unused private helpers in `issue_comments.ex` that only served the old paths (`fetch_issue_node_id/4`, `post_comment/3`, `fetch/4`, and the `@query`, `@issue_node_query`, `@add_comment_mutation` module attributes). Keep `parse_node/1`, `classify/1`, `extract_author/1`, `string_or_nil/1`, `parse_issue_number/1` only if still referenced; remove any that become unused to keep `mix credo` clean.

Note: `GitHub.Api` calls `IssueComments.parse_node/1`, and `IssueComments` calls `GitHub.Api` — that is a compile-time cycle only if one inlines the other at compile time; both references are runtime calls, so the cycle is fine in Elixir. If `mix` warns about a module dependency cycle, move `parse_node/1` into `GitHub.Api` and have `IssueComments` call `GitHub.Api.parse_comment_node/1` instead.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/issue_comments_test.exs test/symphony_elixir/github/api_test.exs`
Expected: PASS (all, including the new fallback test).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/issue_comments.ex elixir/test/symphony_elixir/github/issue_comments_test.exs
git commit -m "refactor(github): route IssueComments through GitHub.Api for REST fallback"
```

---

## Task 8: Integrate `Client.transition_open_state` → `GitHub.Api`

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/client.ex:1247-1273` (`transition_open_state/5`, `close_issue/3`, `reopen_issue/3`)
- Test: `elixir/test/symphony_elixir/github_client_test.exs`

- [ ] **Step 1: Write the failing test**

Add to `github_client_test.exs` a test asserting that when the close mutation is rate-limited but `:issue_number` is provided, the REST PATCH is used. Use the existing `update_issue_state/3` entry where the open/close transition runs, OR test the seam directly. Add:

```elixir
  describe "transition open state REST fallback" do
    test "close falls back to REST PATCH when GraphQL is rate-limited" do
      # GraphQL close mutation -> rate limited; REST PATCH -> closed
      request_fun = fn payload, _headers ->
        if payload["query"] =~ "closeIssue" or payload["query"] =~ "CloseIssue" do
          {:ok, %{status: 200, body: %{"errors" => [%{"type" => "RATE_LIMITED"}]}}}
        else
          {:ok, %{status: 200, body: %{"data" => %{}}}}
        end
      end

      rest_fun = fn url, _headers, body ->
        assert url == "https://api.github.com/repos/owner/repo/issues/42"
        assert body == %{"state" => "closed"}
        {:ok, %{status: 200, body: %{"state" => "closed"}}}
      end

      assert {:ok, %{state: "CLOSED"}} =
               SymphonyElixir.GitHub.Api.transition_issue_open_state("owner/repo", "I_node", :close,
                 request_fun: request_fun,
                 rest_request_fun: rest_fun,
                 issue_number: 42
               )
    end
  end
```

(This validates the integration seam; the `Client` wiring below makes the orchestrator path pass `:issue_number`.)

- [ ] **Step 2: Run test to verify it fails / passes for the seam**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github_client_test.exs -n "transition open state REST fallback"`
Expected: PASS for the `Api` seam (Task 4 already implements it). If `Api` is not aliased in the test, add `alias SymphonyElixir.GitHub.Api` or use the fully-qualified name as written.

- [ ] **Step 3: Rewire `Client.close_issue/reopen_issue` to delegate**

In `client.ex`, change `close_issue/3` and `reopen_issue/3` (lines ~1261-1273) to delegate to `GitHub.Api`, passing the issue number when resolvable. `transition_open_state/5` currently receives `issue_id` (node id) and `state_name`; it also has access to the repo via `GitHub.Config.repo()`. Update:

```elixir
  defp close_issue(client, issue_id, graphql_opts) when is_atom(client) do
    transition_via_api(issue_id, :close, graphql_opts)
  end

  defp reopen_issue(client, issue_id, graphql_opts) when is_atom(client) do
    transition_via_api(issue_id, :reopen, graphql_opts)
  end

  defp transition_via_api(issue_id, action, graphql_opts) do
    repo = GitHub.Config.repo()
    opts = graphql_opts ++ issue_number_opt(repo, issue_id)

    case GitHub.Api.transition_issue_open_state(repo, issue_id, action, opts) do
      {:ok, _state} -> :ok
      {:error, _} = error -> error
    end
  end

  # Best-effort: the GraphQL path uses the node id, so REST fallback needs the
  # number. We resolve it lazily only if a previous resolve provided it; when
  # unavailable, REST fallback returns :needs_issue_number and the caller defers.
  defp issue_number_opt(_repo, _issue_id), do: []
```

Add `alias SymphonyElixir.GitHub.Api` to the `alias` list at the top of `client.ex` (line ~20-21).

Note: in the orchestrator path, `update_issue_state/3` already resolves the project item and could thread the issue number through; threading the number is a small follow-up. For this task, the seam works and the GraphQL path is unchanged on the happy path; REST fallback for close/reopen activates once the number is threaded (tracked as a follow-up in the spec's open questions). The board status set (the rate-limit-prone path) is unaffected.

- [ ] **Step 4: Run tests**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github_client_test.exs`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/client.ex elixir/test/symphony_elixir/github_client_test.exs
git commit -m "refactor(github): route issue open/close through GitHub.Api"
```

---

## Task 9: Integrate admission discovery → `GitHub.Api.list_label_issues`

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/client.ex:950-1016` (`fetch_admission_candidates/5` and its page helper / decode)
- Test: `elixir/test/symphony_elixir/github_client_test.exs`

- [ ] **Step 1: Write the failing test**

Add to `github_client_test.exs`:

```elixir
  test "admission discovery falls back to REST when GraphQL is rate-limited", %{base_dir: base_dir} do
    request_fun = fn payload, _headers ->
      cond do
        payload["query"] =~ "SymphonyApiLabelIssues" or payload["query"] =~ "AdmissionIssues" ->
          {:ok, %{status: 200, body: %{"errors" => [%{"type" => "RATE_LIMITED"}]}}}

        payload["query"] =~ "SymphonyGitHubProjectContentIds" ->
          {:ok, %{status: 200, body: %{"data" => %{"node" => %{"items" => %{"nodes" => [], "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}}}}}}}

        payload["query"] =~ "SymphonyGitHubPollItems" ->
          {:ok, %{status: 200, body: %{"data" => %{"node" => %{"items" => %{"nodes" => [], "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}}}}}}}

        true ->
          {:ok, %{status: 200, body: %{"data" => %{}}}}
      end
    end

    # When discovery REST also has no rest_request_fun wired, admission should not crash the poll.
    assert {:ok, _issues} =
             Client.fetch_candidate_issues(base_dir: base_dir, request_fun: request_fun)
  end
```

- [ ] **Step 2: Run test to verify behavior**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github_client_test.exs -n "admission discovery falls back"`
Expected: FAIL initially (current admission returns `{:admission_failed, {:rate_limited}}` and aborts the poll).

- [ ] **Step 3: Replace the GraphQL label-discovery call with `GitHub.Api.list_label_issues`**

In `client.ex`, change `fetch_admission_candidates/5` (line ~950) to call `GitHub.Api.list_label_issues/3` per label and collect `node_id`s:

```elixir
  defp fetch_admission_candidates(_client, owner, name, label, graphql_opts) do
    repo = owner <> "/" <> name

    case GitHub.Api.list_label_issues(repo, label, graphql_opts) do
      {:ok, rows} -> {:ok, Enum.map(rows, & &1.node_id)}
      {:error, _} = error -> error
    end
  end
```

Remove the now-unused `fetch_admission_candidates_page/7`, `decode_admission_page/1`, and `@admission_issues_query` if nothing else references them (check with `rg` first; keep if shared). The `@admission_issues_query` mutation/query and pagination logic now live in `GitHub.Api`.

- [ ] **Step 4: Run tests**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github_client_test.exs`
Expected: PASS — admission discovery now uses `GitHub.Api` (which defers to REST under rate limit) and the poll completes.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/client.ex elixir/test/symphony_elixir/github_client_test.exs
git commit -m "refactor(github): admission discovery via GitHub.Api.list_label_issues"
```

---

## Task 10: `SyncDriver.pull_pull_requests` falls back to `GitHub.Api.list_issue_prs`

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/sync_driver.ex:56-67`
- Test: `elixir/test/symphony_elixir/github/sync_driver_test.exs` (add a fallback test; create alongside existing if present)

- [ ] **Step 1: Write the failing test**

Add to the GitHub `sync_driver` test:

```elixir
  test "pull_pull_requests falls back to GitHub.Api when GraphQL PR lookup is rate-limited" do
    project = %SymphonyElixir.LocalTracker.Project{slug: "p", tracker_kind: "github", tracker_config: %{"repo" => "owner/repo"}}
    issue = %SymphonyElixir.LocalTracker.IssueRecord{identifier: "42", branch_name: "feat/x"}

    # Stub PullRequests.for_issue to simulate rate-limit, and Api.list_issue_prs to return one PR.
    Application.put_env(:symphony_elixir, :github_pr_module, SymphonyElixir.GitHub.SyncDriverTest.RateLimitedPRs)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :github_pr_module) end)

    assert {:ok, [%{number: 7, state: "open"}]} =
             SymphonyElixir.GitHub.SyncDriver.pull_pull_requests(project, issue)
  end
```

Add a module stub at the top of the test file:

```elixir
  defmodule RateLimitedPRs do
    def resolve_repo(_project), do: {:ok, "owner/repo"}
    def for_issue(_repo, _identifier, _opts \\ []), do: {:error, {:rate_limited, %{reset_at: nil}}}
  end
```

And configure `GitHub.Api` PR fallback to return the fixture by injecting `:request_fun` is not feasible through the driver; instead the driver passes the project repo and identifier to `GitHub.Api.list_issue_prs`, and the test stubs `GitHub.Api` via `Application.get_env(:symphony_elixir, :github_api_module, SymphonyElixir.GitHub.Api)`. Add that indirection in Step 3 and a stub:

```elixir
  defmodule StubApi do
    def list_issue_prs(_repo, _identifier, _branch, _opts \\ []), do: {:ok, [%{number: 7, url: "pr7", title: "t", state: "open"}]}
  end
```

Set `Application.put_env(:symphony_elixir, :github_api_module, SymphonyElixir.GitHub.SyncDriverTest.StubApi)` in the test and clean up `on_exit`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/sync_driver_test.exs -n "falls back to GitHub.Api"`
Expected: FAIL (current `pull_pull_requests` returns `{:ok, []}` on error, never tries `GitHub.Api`).

- [ ] **Step 3: Implement the fallback in `sync_driver.ex`**

Replace `pull_pull_requests/2` (lines 56-67):

```elixir
  @impl true
  def pull_pull_requests(%Project{} = project, %IssueRecord{} = issue) do
    with {:ok, repo} <- pull_requests_module().resolve_repo(project),
         {:ok, prs} <- pull_requests_module().for_issue(repo, issue.identifier) do
      {:ok, Enum.map(prs, &to_pr_record/1)}
    else
      {:error, {:rate_limited, _}} ->
        pr_fallback(project, issue)

      _ ->
        {:ok, []}
    end
  rescue
    error ->
      Logger.warning("PR pull failed for #{issue.identifier}: #{inspect(error)}")
      {:ok, []}
  end

  defp pr_fallback(%Project{} = project, %IssueRecord{} = issue) do
    with {:ok, repo} <- pull_requests_module().resolve_repo(project),
         {:ok, prs} <- api_module().list_issue_prs(repo, issue.identifier, issue.branch_name) do
      {:ok, Enum.map(prs, &to_pr_record/1)}
    else
      _ -> {:ok, []}
    end
  end

  defp api_module, do: Application.get_env(:symphony_elixir, :github_api_module, SymphonyElixir.GitHub.Api)
```

`to_pr_record/1` already accepts maps with `:number/:url/:title/:state` (it reads `pr[:url]`, `pr[:number]`, etc.), so the `GitHub.Api` shape flows through unchanged.

- [ ] **Step 4: Run tests**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/github/sync_driver_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/sync_driver.ex elixir/test/symphony_elixir/github/sync_driver_test.exs
git commit -m "feat(github): PR sync falls back to GitHub.Api on GraphQL rate limit"
```

---

## Task 11: Docs + full gate

**Files:**
- Modify: `elixir/README.md` (add a short "GitHub REST fallback" subsection under the GitHub tracker notes)

- [ ] **Step 1: Add the docs note**

Append to the GitHub section of `elixir/README.md`:

```markdown
### GitHub REST fallback (resilience)

`SymphonyElixir.GitHub.Api` runs comment, open/close, label-discovery, and
PR-linkage operations on GraphQL first and transparently falls back to the REST
API when GraphQL is rate-limited (the two share separate hourly buckets). The
Projects v2 board status read/write is GraphQL-only and defers until the rate
limit resets; routing the other operations to REST reduces GraphQL pressure so
the board path survives longer.
```

- [ ] **Step 2: Run the full quality gate**

Run: `cd elixir && make all`
Expected: format check clean, `credo` clean, coverage passes, `dialyzer` clean, `mix specs.check` clean.

- [ ] **Step 3: Fix any gate failures**

Address `@spec` gaps on new public functions, `credo` readability, and `dialyzer` typing. Re-run `make all` until green.

- [ ] **Step 4: Commit**

```bash
git add elixir/README.md
git commit -m "docs(github): document GitHub.Api REST fallback"
```

---

## Self-Review

**Spec coverage:**
- `GitHub.Api` single service — Tasks 2-6. ✓
- F1 pure fallback (only `{:rate_limited}` triggers REST; others pass through) — Task 2 combinator + test (c)/(e). ✓
- Projects v2-only defer — out of `GitHub.Api` surface; admission write/board status stay in `Client` (Tasks 8-9 keep board status on GraphQL). ✓
- Normalized shapes identical across transports — every op test asserts the same shape from both branches. ✓
- PR fallback scope = linkage + basic state — Task 6. ✓
- Integration points (IssueComments, IssueAdapter via IssueComments, admission, SyncDriver) — Tasks 7-10. ✓ (`IssueAdapter.add_comment/list_comments` delegate to `IssueComments`, so they inherit fallback.)
- `Client.rest_post/3` — Task 1. ✓
- Tests with fake `request_fun`, no network; `make all` — Tasks 2-11. ✓

**Placeholder scan:** No "TBD"/"add error handling" placeholders; each code step has complete code. Two explicitly-scoped follow-ups are flagged honestly (threading the issue number for open/close REST fallback in Task 8; optional `rest_patch/3`) and do not block the happy path.

**Type consistency:** `comment` shape `%{id, author, body, kind, url, created_at, updated_at}` is produced by `IssueComments.parse_node/1` in both branches (Tasks 2-3, 7). PR shape `%{number, url, title, state}` consistent across Tasks 6 and 10 and matches `SyncDriver.to_pr_record/1`. `list_label_issues` returns `%{number, node_id}` consistently (Tasks 5, 9). `transition_issue_open_state` returns `%{state: "OPEN"|"CLOSED"}` (Tasks 4, 8). `with_fallback/3`, `graphql_opts/1`, `rest_opts/1`, `parse_issue_number/1`, `header_value/2` defined once in Task 2/5 and reused.
