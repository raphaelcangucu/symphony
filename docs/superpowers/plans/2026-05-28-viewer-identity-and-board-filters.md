# Viewer Identity & Board Filters Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Tooling: Elixir backend uses `mix` (run via `mise exec --` if `mise` is configured). Frontend uses `npm` from `tracker/`. Quality gate for Elixir is `cd elixir && mise exec -- mix all` (alias defined in `Makefile`); when `mise` is unavailable, `cd elixir && mix all` works after `mix deps.get`.

**Goal:** Deliver Slice A of the MVP: resolve the operator's GitHub login from `GITHUB_TOKEN`, expose it through `/api/tracker/v1/viewer`, gate the React app on a valid viewer, persist a `creator` column on local tracker issues, support keyword/assignee/creator filters with `me` substitution on the issues endpoint, honour `local.assignee: me` in the local tracker orchestrator adapter, and add a Linear-style filter bar plus `Cmd+K` palette / `/` hotkey on the board.

**Architecture:** A new `LocalTracker.Viewer` GenServer owns an ETS cache (`:symphony_viewer_cache`) and resolves `viewer { login name avatarUrl }` through `GitHub.Client.graphql/3`. A new `Tracker.ViewerController` exposes that. The token gate (React) calls `/viewer` before saving the tracker token. The issues endpoint accepts `?q&assignee&creator`, resolving `"me"` server-side. A new `creator` column is added by migration; the issue controller fills it from `Viewer.current/0` at create time. The board reads filters from `URLSearchParams` and renders a new `BoardFilters` component plus a `cmdk` palette.

**Tech Stack:** Elixir 1.19 / OTP 28, Phoenix 1.7, Ecto + `ecto_sqlite3`, NimbleOptions, ExUnit. React 18 + TypeScript + Vite, react-router-dom v6, shadcn primitives, sonner toasts, Vitest + Testing Library, axios. Adds `cmdk` to `tracker`.

**Spec:** `docs/superpowers/specs/2026-05-28-viewer-identity-and-board-filters-design.md`

---

## Branch Setup

- [ ] **Step 0: Create a feature branch from main**

```bash
cd /home/raphaelcangucu/symphony
git status
git checkout -b feat/viewer-identity-and-board-filters
```

Expected: branch exists, working tree clean (existing pre-staged tracker changes can remain in place; tasks below do not depend on them).

---

## File Structure (Backend)

| Action | Path | Owns |
|---|---|---|
| Create | `elixir/lib/symphony_elixir/local_tracker/viewer.ex` | Module + ETS-backed `current/0` API |
| Create | `elixir/lib/symphony_elixir/local_tracker/viewer/server.ex` | GenServer that owns the ETS table |
| Modify | `elixir/lib/symphony_elixir.ex` | Add `Viewer.Server` to the supervision tree |
| Create | `elixir/lib/symphony_elixir_web/controllers/tracker/viewer_controller.ex` | `GET /viewer` |
| Modify | `elixir/lib/symphony_elixir_web/router.ex` | Mount the new route |
| Modify | `elixir/lib/symphony_elixir_web/tracker_errors.ex` | New mapping for viewer errors |
| Create | `elixir/priv/repo/migrations/20260528150000_add_creator_to_local_tracker_issues.exs` | Add `creator` column |
| Modify | `elixir/lib/symphony_elixir/local_tracker/issue_record.ex` | Schema + changeset for `creator` |
| Modify | `elixir/lib/symphony_elixir/local_tracker/context.ex` | `list_issues/2` filters + `create_issue/2` accepts `:creator` |
| Modify | `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex` | Emit `creator` in issue DTO |
| Modify | `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex` | Read params, inject viewer login |
| Modify | `elixir/lib/symphony_elixir/config.ex` | `local_assignee/0` |
| Modify | `elixir/lib/symphony_elixir/local_tracker/tracker.ex` | Honour `local.assignee` (incl. `me`) |
| Create | `elixir/test/symphony_elixir/local_tracker/viewer_test.exs` | Unit tests |
| Create | `elixir/test/symphony_elixir_web/controllers/tracker/viewer_controller_test.exs` | Controller tests |
| Modify | `elixir/test/symphony_elixir/local_tracker/context_test.exs` | `list_issues/2` filter tests, `create_issue/2` accepts `creator` |
| Modify | `elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs` | Index filter tests, create stores `creator` |
| Modify | `elixir/test/symphony_elixir/local_tracker/tracker_test.exs` | `fetch_candidate_issues/0` assignee filter |

## File Structure (Frontend)

| Action | Path | Owns |
|---|---|---|
| Create | `tracker/src/types/viewer.ts` | `Viewer` type |
| Create | `tracker/src/services/viewer.ts` | `fetchViewer`, `ViewerNotConfiguredError` |
| Modify | `tracker/src/services/mappers.ts` | `normalizeViewer` + `Issue.creator` |
| Modify | `tracker/src/types/issue.ts` | `creator` field |
| Create | `tracker/src/components/auth/ViewerProvider.tsx` | Context + `useViewer` hook |
| Modify | `tracker/src/App.tsx` | Wrap routes in `<ViewerProvider>` |
| Modify | `tracker/src/pages/TokenGatePage.tsx` | Block on viewer failure, surface retry |
| Modify | `tracker/src/services/issues.ts` | Filters param |
| Modify | `tracker/src/hooks/useIssueBoard.ts` | Accept filters, post-filter websocket events |
| Create | `tracker/src/lib/issueFilters.ts` | `filtersFromSearchParams`, `applyFilters` helper |
| Create | `tracker/src/components/board/BoardFiltersDrawer.tsx` | Right-side `Sheet` containing search + assignee + creator |
| Create | `tracker/src/components/board/BoardFiltersTrigger.tsx` | Header button "Filters · N" that toggles the drawer |
| Create | `tracker/src/components/board/useBoardFiltersDrawer.ts` | Tiny zustand-free hook (`useState` + ref) shared by trigger, drawer, palette |
| Create | `tracker/src/components/board/BoardPaletteShortcuts.tsx` | `/` and `Cmd+K` shortcuts + `cmdk` `CommandDialog`; talks to drawer hook |
| Modify | `tracker/src/components/layout/ProjectHeader.tsx` | Mount `<BoardFiltersTrigger />` in the existing header |
| Modify | `tracker/src/pages/ProjectBoardPage.tsx` | Mount `<BoardFiltersDrawer />` + shortcuts, pass filters to `useIssueBoard` |
| Modify | `tracker/src/pages/ProjectListPage.tsx` | Same wiring for the list view |
| Modify | `tracker/package.json` | Add `cmdk` |
| Create | `tracker/src/services/__tests__/viewer.test.ts` | |
| Create | `tracker/src/components/auth/__tests__/ViewerProvider.test.tsx` | |
| Modify | `tracker/src/pages/__tests__/TokenGatePage.test.tsx` (create if absent) | |
| Modify | `tracker/src/services/__tests__/issues.test.ts` (create if absent) | |
| Modify | `tracker/src/hooks/__tests__/useIssueBoard.test.tsx` (create if absent) | |
| Create | `tracker/src/components/board/__tests__/BoardFiltersDrawer.test.tsx` | |
| Create | `tracker/src/components/board/__tests__/BoardPaletteShortcuts.test.tsx` | |
| Create | `tracker/src/lib/__tests__/issueFilters.test.ts` | |

---

## Task 1 — Viewer module skeleton & GenServer

**Files:**
- Create: `elixir/lib/symphony_elixir/local_tracker/viewer.ex`
- Create: `elixir/lib/symphony_elixir/local_tracker/viewer/server.ex`
- Modify: `elixir/lib/symphony_elixir.ex` (supervision)
- Test: `elixir/test/symphony_elixir/local_tracker/viewer_test.exs`

- [ ] **Step 1.1: Write the failing test (Viewer.current/0 returns cached value when ETS has fresh data)**

Create `elixir/test/symphony_elixir/local_tracker/viewer_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.ViewerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Viewer

  setup do
    {:ok, _pid} = start_supervised(Viewer.Server)
    on_exit(fn -> Viewer.invalidate_cache() end)
    :ok
  end

  describe "current/0" do
    test "returns cached viewer when within TTL" do
      Viewer.put_cached(%{login: "octocat", name: "Octo Cat", avatar_url: "https://x"})

      assert {:ok, %{login: "octocat", name: "Octo Cat", avatar_url: "https://x"}} =
               Viewer.current(request_fun: fn _payload, _headers -> flunk("should not call GraphQL") end)
    end

    test "resolves via GraphQL on cache miss and writes back to cache" do
      System.put_env("GITHUB_TOKEN", "fake")
      on_exit(fn -> System.delete_env("GITHUB_TOKEN") end)

      request_fun = fn _payload, _headers ->
        {:ok,
         %{
           status: 200,
           body:
             ~s({"data":{"viewer":{"login":"octocat","name":"Octo Cat","avatarUrl":"https://avatar"}}})
         }}
      end

      assert {:ok, %{login: "octocat", name: "Octo Cat", avatar_url: "https://avatar"}} =
               Viewer.current(request_fun: request_fun)

      assert {:ok, %{login: "octocat"}} =
               Viewer.current(request_fun: fn _, _ -> flunk("should hit cache") end)
    end

    test "returns :missing_github_token error when token absent" do
      System.delete_env("GITHUB_TOKEN")

      assert {:error, :missing_github_token} = Viewer.current()
    end

    test "maps 401 GraphQL status to :unauthorized" do
      System.put_env("GITHUB_TOKEN", "fake")
      on_exit(fn -> System.delete_env("GITHUB_TOKEN") end)

      request_fun = fn _payload, _headers -> {:ok, %{status: 401, body: ~s({"message":"Bad credentials"})}} end

      assert {:error, :unauthorized} = Viewer.current(request_fun: request_fun)
    end
  end
end
```

- [ ] **Step 1.2: Run test, expect failure (module missing)**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/viewer_test.exs`
Expected: compilation failure or `(UndefinedFunctionError)` on `Viewer.Server.start_link/1`.

- [ ] **Step 1.3: Implement `Viewer.Server`**

Create `elixir/lib/symphony_elixir/local_tracker/viewer/server.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.Viewer.Server do
  @moduledoc "Owns the ETS table backing `SymphonyElixir.LocalTracker.Viewer`."

  use GenServer

  @table :symphony_viewer_cache

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec table_name() :: atom()
  def table_name, do: @table

  @impl true
  def init(_opts) do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    {:ok, %{}}
  end
end
```

- [ ] **Step 1.4: Implement `Viewer` module**

Create `elixir/lib/symphony_elixir/local_tracker/viewer.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.Viewer do
  @moduledoc """
  Resolves the GitHub login of the local Symphony operator and caches it in ETS.
  """

  alias SymphonyElixir.GitHub.Client
  alias SymphonyElixir.LocalTracker.Viewer.Server

  require Logger

  @type t :: %{login: String.t(), name: String.t() | nil, avatar_url: String.t() | nil}

  @type viewer_error ::
          :missing_github_token
          | :unauthorized
          | {:network_error, term()}
          | {:malformed_response, term()}

  @cache_key :current
  @default_ttl_ms 5 * 60 * 1_000

  @query """
  query SymphonyViewer {
    viewer {
      login
      name
      avatarUrl
    }
  }
  """

  @spec current(keyword()) :: {:ok, t()} | {:error, viewer_error()}
  def current(opts \\ []) when is_list(opts) do
    case lookup_cache() do
      {:ok, value} ->
        {:ok, value}

      :miss ->
        case resolve(opts) do
          {:ok, value} ->
            put_cached(value)
            {:ok, value}

          {:error, _reason} = error ->
            error
        end
    end
  end

  @spec current!(keyword()) :: t()
  def current!(opts \\ []) when is_list(opts) do
    case current(opts) do
      {:ok, value} -> value
      {:error, reason} -> raise "viewer unavailable: #{inspect(reason)}"
    end
  end

  @spec invalidate_cache() :: :ok
  def invalidate_cache do
    if :ets.whereis(Server.table_name()) != :undefined do
      :ets.delete(Server.table_name(), @cache_key)
    end

    :ok
  end

  @doc false
  @spec put_cached(t()) :: :ok
  def put_cached(value) when is_map(value) do
    expires_at = System.monotonic_time(:millisecond) + ttl_ms()
    :ets.insert(Server.table_name(), {@cache_key, value, expires_at})
    :ok
  end

  defp lookup_cache do
    case :ets.lookup(Server.table_name(), @cache_key) do
      [{@cache_key, value, expires_at}] ->
        if System.monotonic_time(:millisecond) < expires_at, do: {:ok, value}, else: :miss

      _ ->
        :miss
    end
  rescue
    ArgumentError -> :miss
  end

  defp resolve(opts) do
    client = Keyword.get(opts, :client_module, Client)
    request_fun = Keyword.get(opts, :request_fun)

    graphql_opts =
      if request_fun, do: [request_fun: request_fun], else: []

    case client.graphql(@query, %{}, graphql_opts) do
      {:ok, %{"data" => %{"viewer" => viewer}}} ->
        decode_viewer(viewer)

      {:ok, body} ->
        {:error, {:malformed_response, body}}

      {:error, :missing_github_token} ->
        {:error, :missing_github_token}

      {:error, {:github_api_status, 401}} ->
        {:error, :unauthorized}

      {:error, {:github_api_status, status}} ->
        {:error, {:network_error, {:http_status, status}}}

      {:error, {:github_api_request, reason}} ->
        {:error, {:network_error, reason}}

      {:error, reason} ->
        {:error, {:network_error, reason}}
    end
  end

  defp decode_viewer(%{"login" => login} = node) when is_binary(login) do
    case String.trim(login) do
      "" ->
        {:error, {:malformed_response, node}}

      trimmed ->
        {:ok,
         %{
           login: trimmed,
           name: trim_or_nil(Map.get(node, "name")),
           avatar_url: trim_or_nil(Map.get(node, "avatarUrl"))
         }}
    end
  end

  defp decode_viewer(node), do: {:error, {:malformed_response, node}}

  defp trim_or_nil(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp trim_or_nil(_), do: nil

  defp ttl_ms do
    Application.get_env(:symphony_elixir, :viewer_cache_ttl_ms, @default_ttl_ms)
  end
end
```

- [ ] **Step 1.5: Add `Viewer.Server` to the supervision tree**

Modify `elixir/lib/symphony_elixir.ex` — add `SymphonyElixir.LocalTracker.Viewer.Server` as a child after `SymphonyElixir.Repo` and before `SymphonyElixir.Orchestrator`:

```elixir
    children = [
      {Phoenix.PubSub, name: SymphonyElixir.PubSub},
      SymphonyElixir.Repo,
      SymphonyElixir.LocalTracker.Viewer.Server,
      {Task.Supervisor, name: SymphonyElixir.TaskSupervisor},
      SymphonyElixir.WorkflowStore,
      SymphonyElixir.Orchestrator,
      SymphonyElixir.HttpServer,
      SymphonyElixir.StatusDashboard
    ]
```

- [ ] **Step 1.6: Run viewer tests, expect PASS**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/viewer_test.exs`
Expected: 4 tests pass.

- [ ] **Step 1.7: Verify formatting and credo on touched files**

Run: `cd elixir && mise exec -- mix format lib/symphony_elixir/local_tracker/viewer.ex lib/symphony_elixir/local_tracker/viewer/server.ex lib/symphony_elixir.ex test/symphony_elixir/local_tracker/viewer_test.exs`
Then: `cd elixir && mise exec -- mix credo --strict lib/symphony_elixir/local_tracker/viewer.ex lib/symphony_elixir/local_tracker/viewer/server.ex`
Expected: no diagnostics.

- [ ] **Step 1.8: Commit**

```bash
cd /home/raphaelcangucu/symphony
git add elixir/lib/symphony_elixir.ex elixir/lib/symphony_elixir/local_tracker/viewer.ex elixir/lib/symphony_elixir/local_tracker/viewer/server.ex elixir/test/symphony_elixir/local_tracker/viewer_test.exs
git commit -m "feat(local-tracker): add Viewer module with ETS-backed GitHub login cache"
```

---

## Task 2 — `ViewerController` and `/api/tracker/v1/viewer` route

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/viewer_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/viewer_controller_test.exs`

- [ ] **Step 2.1: Inspect existing `TrackerErrors` mapping**

Run: `rg -n "def render" elixir/lib/symphony_elixir_web/tracker_errors.ex`
Skim the file to understand its existing `render(conn, reason)` clauses (the issue controller already routes errors through it).

- [ ] **Step 2.2: Write the failing controller test**

Create `elixir/test/symphony_elixir_web/controllers/tracker/viewer_controller_test.exs`:

```elixir
defmodule SymphonyElixirWeb.Tracker.ViewerControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Viewer

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    start_supervised!(SymphonyElixir.LocalTracker.Viewer.Server)
    Viewer.invalidate_cache()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      Viewer.invalidate_cache()
      if previous_token, do: System.put_env(@token_env, previous_token), else: System.delete_env(@token_env)
    end)

    :ok
  end

  test "returns 200 with cached viewer payload" do
    Viewer.put_cached(%{login: "octocat", name: "Octo", avatar_url: "https://x"})

    conn = get(authorized_conn(), "/api/tracker/v1/viewer")

    assert json_response(conn, 200) == %{
             "data" => %{
               "github_login" => "octocat",
               "name" => "Octo",
               "avatar_url" => "https://x"
             }
           }
  end

  test "returns 503 github_token_missing when token absent" do
    System.delete_env("GITHUB_TOKEN")

    conn = get(authorized_conn(), "/api/tracker/v1/viewer")

    assert %{"error" => %{"code" => "github_token_missing"}} = json_response(conn, 503)
  end

  test "rejects requests without tracker bearer token" do
    conn = get(build_conn(), "/api/tracker/v1/viewer")

    assert json_response(conn, 401) == %{
             "error" => %{"code" => "unauthorized", "message" => "invalid tracker token"}
           }
  end

  defp authorized_conn do
    build_conn() |> put_req_header("authorization", "Bearer secret")
  end
end
```

- [ ] **Step 2.3: Run, expect failure (controller / route missing)**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/viewer_controller_test.exs`
Expected: 404 or undefined controller error.

- [ ] **Step 2.4: Add viewer error clauses to `TrackerErrors`**

Modify `elixir/lib/symphony_elixir_web/tracker_errors.ex` — add the following clauses **before** the catch-all clause (preserve existing ones):

```elixir
  def render(conn, :missing_github_token) do
    error(conn, 503, "github_token_missing", "GITHUB_TOKEN is not configured on the Symphony server.")
  end

  def render(conn, :unauthorized) do
    error(conn, 401, "github_unauthorized", "GitHub rejected the configured GITHUB_TOKEN.")
  end

  def render(conn, {:network_error, _reason}) do
    error(conn, 503, "github_network_error", "Failed to reach GitHub. Try again in a moment.")
  end

  def render(conn, {:malformed_response, _body}) do
    error(conn, 502, "github_malformed_response", "GitHub returned an unexpected response.")
  end
```

If the existing module does not expose an `error/4` helper of that exact shape, mirror whatever shape its other clauses use; the requirement is producing the JSON envelope `%{error: %{code: code, message: message}}` with the right status code. Read the file first (Step 2.1) and adapt.

- [ ] **Step 2.5: Create the controller**

Create `elixir/lib/symphony_elixir_web/controllers/tracker/viewer_controller.ex`:

```elixir
defmodule SymphonyElixirWeb.Tracker.ViewerController do
  @moduledoc "Exposes the resolved Symphony operator identity."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Viewer
  alias SymphonyElixirWeb.TrackerErrors

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, _params) do
    case Viewer.current() do
      {:ok, viewer} ->
        json(conn, %{
          data: %{
            github_login: viewer.login,
            name: viewer.name,
            avatar_url: viewer.avatar_url
          }
        })

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end
end
```

- [ ] **Step 2.6: Register the route**

Modify `elixir/lib/symphony_elixir_web/router.ex` — inside the `scope "/api/tracker/v1", SymphonyElixirWeb.Tracker do ... end` block, add the new line immediately after the `pipe_through(:tracker_api)` line:

```elixir
    get("/viewer", ViewerController, :show)
```

- [ ] **Step 2.7: Run the controller test, expect PASS**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/viewer_controller_test.exs`
Expected: 3 tests pass.

- [ ] **Step 2.8: Format and commit**

```bash
cd /home/raphaelcangucu/symphony
cd elixir && mise exec -- mix format lib/symphony_elixir_web/controllers/tracker/viewer_controller.ex lib/symphony_elixir_web/router.ex lib/symphony_elixir_web/tracker_errors.ex test/symphony_elixir_web/controllers/tracker/viewer_controller_test.exs && cd -
git add elixir/lib/symphony_elixir_web/controllers/tracker/viewer_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/lib/symphony_elixir_web/tracker_errors.ex elixir/test/symphony_elixir_web/controllers/tracker/viewer_controller_test.exs
git commit -m "feat(tracker-api): expose GET /viewer with GitHub login envelope"
```

---

## Task 3 — Migration & schema update for `creator`

**Files:**
- Create: `elixir/priv/repo/migrations/20260528150000_add_creator_to_local_tracker_issues.exs`
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_record.ex`
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
- Modify: `elixir/test/symphony_elixir/local_tracker/context_test.exs` (extend; do not rewrite)

- [ ] **Step 3.1: Write the failing context test for `create_issue` persisting `:creator`**

Append to `elixir/test/symphony_elixir/local_tracker/context_test.exs`:

```elixir
  describe "create_issue/2 with creator" do
    setup do
      {:ok, project} = Context.ensure_project(%{name: "T", slug: "creator-project"})
      {:ok, project: project}
    end

    test "persists the creator field when provided", %{project: _project} do
      assert {:ok, issue} =
               Context.create_issue("creator-project", %{
                 title: "An issue",
                 description: "with creator",
                 status: "Todo",
                 creator: "octocat"
               })

      assert issue.creator == "octocat"
    end

    test "leaves creator nil when omitted" do
      assert {:ok, issue} =
               Context.create_issue("creator-project", %{
                 title: "Issue without creator",
                 status: "Todo"
               })

      assert issue.creator == nil
    end
  end
```

- [ ] **Step 3.2: Run, expect failure**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/context_test.exs`
Expected: `(KeyError) key :creator not found` or schema cast error.

- [ ] **Step 3.3: Create the migration**

Create `elixir/priv/repo/migrations/20260528150000_add_creator_to_local_tracker_issues.exs`:

```elixir
defmodule SymphonyElixir.Repo.Migrations.AddCreatorToLocalTrackerIssues do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_issues) do
      add(:creator, :string)
    end
  end
end
```

- [ ] **Step 3.4: Update `IssueRecord` schema and changeset**

Modify `elixir/lib/symphony_elixir/local_tracker/issue_record.ex`:

- Inside the `schema "local_tracker_issues" do ... end` block, add `field(:creator, :string)` right after the existing `field(:assignee_id, :string)`.
- Inside `changeset/2`, add `:creator` to the list passed to `cast/2`.

Resulting `cast` list:

```elixir
    |> cast(attrs, [
      :project_id,
      :status_id,
      :identifier,
      :title,
      :description,
      :priority,
      :position,
      :assignee_id,
      :creator,
      :worker_id,
      :branch_name,
      :url,
      :started_at,
      :completed_at
    ])
```

- [ ] **Step 3.5: Update `Context.create_issue/2` to accept and forward `:creator`**

In `elixir/lib/symphony_elixir/local_tracker/context.ex`, locate the `defp issue_create_attrs/1` helper (search with `rg -n "defp issue_create_attrs"`). Add `:creator` to whichever allowlist that helper builds (the same way it currently passes `:title`, `:description`, etc.). If the helper currently uses `Map.take/2`, append `:creator` to the keys list:

```elixir
  defp issue_create_attrs(attrs) do
    attrs
    |> attr_take([:title, :description, :priority, :assignee_id, :creator, :worker_id, :branch_name, :url])
    # ... keep existing post-processing
  end
```

Read the function first; preserve whatever the existing helper does for the other fields.

- [ ] **Step 3.6: Update presenter to emit `creator`**

Modify `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex` — inside `def issue(%IssueRecord{} = issue)`, add `creator: issue.creator,` after the `assignee_id:` line.

- [ ] **Step 3.7: Run migration in test DB and re-run context tests**

Run: `cd elixir && MIX_ENV=test mise exec -- mix ecto.migrate && mise exec -- mix test test/symphony_elixir/local_tracker/context_test.exs`
Expected: both new tests pass, existing tests still pass.

- [ ] **Step 3.8: Run dialyzer on touched files to catch typespec drift**

Run: `cd elixir && mise exec -- mix dialyzer`
Expected: no new warnings (existing warnings are tolerated; the diff should be clean).

- [ ] **Step 3.9: Commit**

```bash
cd /home/raphaelcangucu/symphony
cd elixir && mise exec -- mix format lib/symphony_elixir/local_tracker/issue_record.ex lib/symphony_elixir/local_tracker/context.ex lib/symphony_elixir_web/presenters/tracker_presenter.ex priv/repo/migrations/20260528150000_add_creator_to_local_tracker_issues.exs test/symphony_elixir/local_tracker/context_test.exs && cd -
git add elixir/priv/repo/migrations/20260528150000_add_creator_to_local_tracker_issues.exs elixir/lib/symphony_elixir/local_tracker/issue_record.ex elixir/lib/symphony_elixir/local_tracker/context.ex elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex elixir/test/symphony_elixir/local_tracker/context_test.exs
git commit -m "feat(local-tracker): persist issue creator and expose it in DTO"
```

---

## Task 4 — Filters in `Context.list_issues/2`

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex` (signature, query composition)
- Modify: `elixir/test/symphony_elixir/local_tracker/context_test.exs`

- [ ] **Step 4.1: Write failing tests for filters**

Append to `elixir/test/symphony_elixir/local_tracker/context_test.exs`:

```elixir
  describe "list_issues/2 filters" do
    setup do
      {:ok, project} = Context.ensure_project(%{name: "F", slug: "filter-project"})

      {:ok, _i1} =
        Context.create_issue("filter-project", %{
          title: "Add dark mode",
          description: "ui",
          status: "Todo",
          assignee_id: "alice",
          creator: "alice"
        })

      {:ok, _i2} =
        Context.create_issue("filter-project", %{
          title: "Backend fix",
          description: "API",
          status: "Todo",
          assignee_id: "bob",
          creator: "alice"
        })

      {:ok, _i3} =
        Context.create_issue("filter-project", %{
          title: "Investigate Dark patterns",
          description: nil,
          status: "Todo",
          assignee_id: nil,
          creator: "carol"
        })

      {:ok, project: project}
    end

    test "search filter matches title, description, identifier (case-insensitive)" do
      titles =
        "filter-project"
        |> Context.list_issues(search: "dark")
        |> Enum.map(& &1.title)
        |> Enum.sort()

      assert titles == ["Add dark mode", "Investigate Dark patterns"]
    end

    test "assignee filter matches the assignee_id column exactly" do
      assert ["Add dark mode"] =
               "filter-project"
               |> Context.list_issues(assignee: "alice")
               |> Enum.map(& &1.title)
    end

    test "creator filter matches the creator column exactly" do
      titles =
        "filter-project"
        |> Context.list_issues(creator: "alice")
        |> Enum.map(& &1.title)
        |> Enum.sort()

      assert titles == ["Add dark mode", "Backend fix"]
    end

    test "filters AND together" do
      assert [%{title: "Add dark mode"}] =
               Context.list_issues("filter-project", search: "dark", assignee: "alice")
    end

    test "escapes SQL wildcards in search term" do
      {:ok, _} =
        Context.create_issue("filter-project", %{
          title: "100% complete",
          status: "Todo"
        })

      assert [%{title: "100% complete"}] =
               Context.list_issues("filter-project", search: "100%")
    end
  end
```

- [ ] **Step 4.2: Run, expect failure (`list_issues/2` signature mismatch)**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/context_test.exs`
Expected: `(UndefinedFunctionError)` or `(FunctionClauseError)` on `list_issues/2`.

- [ ] **Step 4.3: Replace `list_issues/1` with a filter-aware `list_issues/2`**

Modify `elixir/lib/symphony_elixir/local_tracker/context.ex`. Replace the existing `list_issues/1` clause with:

```elixir
  @spec list_issues(String.t(), keyword()) :: [IssueRecord.t()]
  def list_issues(project_slug, opts \\ []) when is_binary(project_slug) and is_list(opts) do
    case fetch_project(project_slug) do
      {:ok, project} ->
        IssueRecord
        |> where([issue], issue.project_id == ^project.id)
        |> apply_issue_filters(opts)
        |> order_by([issue], asc: issue.position, asc: issue.id)
        |> preload(^@issue_preloads)
        |> Repo.all()

      {:error, :project_not_found} ->
        []
    end
  end

  defp apply_issue_filters(query, opts) do
    query
    |> maybe_filter_search(Keyword.get(opts, :search))
    |> maybe_filter_assignee(Keyword.get(opts, :assignee))
    |> maybe_filter_creator(Keyword.get(opts, :creator))
  end

  defp maybe_filter_search(query, nil), do: query
  defp maybe_filter_search(query, ""), do: query

  defp maybe_filter_search(query, term) when is_binary(term) do
    escaped = escape_like_term(term)
    pattern = "%" <> escaped <> "%"

    where(
      query,
      [issue],
      fragment("? LIKE ? ESCAPE ?", issue.title, ^pattern, "\\") or
        fragment("? LIKE ? ESCAPE ?", issue.description, ^pattern, "\\") or
        fragment("? LIKE ? ESCAPE ?", issue.identifier, ^pattern, "\\")
    )
  end

  defp maybe_filter_search(query, _other), do: query

  defp maybe_filter_assignee(query, nil), do: query
  defp maybe_filter_assignee(query, ""), do: query

  defp maybe_filter_assignee(query, value) when is_binary(value) do
    where(query, [issue], issue.assignee_id == ^value)
  end

  defp maybe_filter_assignee(query, _other), do: query

  defp maybe_filter_creator(query, nil), do: query
  defp maybe_filter_creator(query, ""), do: query

  defp maybe_filter_creator(query, value) when is_binary(value) do
    where(query, [issue], issue.creator == ^value)
  end

  defp maybe_filter_creator(query, _other), do: query

  defp escape_like_term(term) do
    term
    |> String.trim()
    |> String.replace("\\", "\\\\")
    |> String.replace("%", "\\%")
    |> String.replace("_", "\\_")
  end
```

Notes:
- `fragment("? LIKE ? ESCAPE ?", ...)` works on SQLite via `ecto_sqlite3`. SQLite's `LIKE` is case-insensitive for ASCII out of the box.
- The escape order matters: replace `\\` before `%` and `_` so we do not double-escape inserted backslashes.

- [ ] **Step 4.4: Run filter tests, expect PASS**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/context_test.exs`
Expected: all filter tests pass, existing context tests still pass.

- [ ] **Step 4.5: Commit**

```bash
cd /home/raphaelcangucu/symphony
cd elixir && mise exec -- mix format lib/symphony_elixir/local_tracker/context.ex test/symphony_elixir/local_tracker/context_test.exs && cd -
git add elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/local_tracker/context_test.exs
git commit -m "feat(local-tracker): support keyword/assignee/creator filters in list_issues/2"
```

---

## Task 5 — `IssueController` filter params + viewer-aware creator

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex`
- Modify: `elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`

- [ ] **Step 5.1: Write failing tests**

Append to `elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`:

```elixir
  describe "index filters" do
    setup do
      start_supervised!(SymphonyElixir.LocalTracker.Viewer.Server)
      SymphonyElixir.LocalTracker.Viewer.invalidate_cache()

      {:ok, _project} = Context.ensure_project(%{name: "F", slug: "filtered"})

      {:ok, _} =
        Context.create_issue("filtered", %{
          title: "ABC",
          status: "Todo",
          assignee_id: "alice",
          creator: "alice"
        })

      {:ok, _} =
        Context.create_issue("filtered", %{
          title: "XYZ",
          status: "Todo",
          assignee_id: "bob",
          creator: "bob"
        })

      :ok
    end

    test "filters by assignee query param" do
      conn = get(authorized_conn(), "/api/tracker/v1/projects/filtered/issues?assignee=alice")

      assert %{"data" => [%{"title" => "ABC"}]} = json_response(conn, 200)
    end

    test "filters by creator query param" do
      conn = get(authorized_conn(), "/api/tracker/v1/projects/filtered/issues?creator=bob")

      assert %{"data" => [%{"title" => "XYZ"}]} = json_response(conn, 200)
    end

    test "filters by q (keyword)" do
      conn = get(authorized_conn(), "/api/tracker/v1/projects/filtered/issues?q=ABC")

      assert %{"data" => [%{"title" => "ABC"}]} = json_response(conn, 200)
    end

    test "resolves assignee=me to the viewer login" do
      SymphonyElixir.LocalTracker.Viewer.put_cached(%{login: "alice", name: "Alice", avatar_url: nil})

      conn = get(authorized_conn(), "/api/tracker/v1/projects/filtered/issues?assignee=me")

      assert %{"data" => [%{"title" => "ABC"}]} = json_response(conn, 200)
    end

    test "returns 503 when assignee=me but viewer unavailable" do
      System.delete_env("GITHUB_TOKEN")
      SymphonyElixir.LocalTracker.Viewer.invalidate_cache()

      conn = get(authorized_conn(), "/api/tracker/v1/projects/filtered/issues?assignee=me")

      assert %{"error" => %{"code" => "github_token_missing"}} = json_response(conn, 503)
    end
  end

  describe "create issue with viewer creator" do
    setup do
      start_supervised!(SymphonyElixir.LocalTracker.Viewer.Server)
      SymphonyElixir.LocalTracker.Viewer.invalidate_cache()
      {:ok, _project} = Context.ensure_project(%{name: "C", slug: "creator-route"})
      :ok
    end

    test "fills creator from cached viewer login" do
      SymphonyElixir.LocalTracker.Viewer.put_cached(%{login: "octocat", name: nil, avatar_url: nil})

      conn =
        authorized_conn()
        |> post("/api/tracker/v1/projects/creator-route/issues", %{
          "title" => "From API",
          "status" => "Todo"
        })

      assert %{"data" => %{"creator" => "octocat"}} = json_response(conn, 201)
    end

    test "still creates issue (creator nil) when viewer unavailable" do
      System.delete_env("GITHUB_TOKEN")
      SymphonyElixir.LocalTracker.Viewer.invalidate_cache()

      conn =
        authorized_conn()
        |> post("/api/tracker/v1/projects/creator-route/issues", %{
          "title" => "From API no viewer",
          "status" => "Todo"
        })

      assert %{"data" => %{"creator" => nil}} = json_response(conn, 201)
    end
  end
```

- [ ] **Step 5.2: Run, expect failure**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`
Expected: filter assertions fail (params currently ignored); creator returns `nil`.

- [ ] **Step 5.3: Update `IssueController` to read params, resolve `me`, inject creator**

Replace `index/2` and `create/2` in `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex`:

```elixir
  alias SymphonyElixir.LocalTracker.Viewer

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug} = params) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, filters} <- build_filters(params) do
      issues = Context.list_issues(project_slug, filters)
      json(conn, %{data: Enum.map(issues, &TrackerPresenter.issue/1)})
    else
      {:error, :project_not_found} ->
        TrackerErrors.render(conn, :project_not_found)

      {:error, viewer_error} ->
        TrackerErrors.render(conn, viewer_error)
    end
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug} = params) do
    attrs =
      params
      |> Map.delete("project_slug")
      |> maybe_inject_creator()

    case Context.create_issue(project_slug, attrs) do
      {:ok, issue} ->
        conn
        |> put_status(:created)
        |> json(%{data: TrackerPresenter.issue(issue)})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp build_filters(params) do
    with {:ok, assignee} <- resolve_me(Map.get(params, "assignee")),
         {:ok, creator} <- resolve_me(Map.get(params, "creator")) do
      filters =
        []
        |> put_filter(:search, trim_or_nil(Map.get(params, "q")))
        |> put_filter(:assignee, assignee)
        |> put_filter(:creator, creator)

      {:ok, filters}
    end
  end

  defp put_filter(opts, _key, nil), do: opts
  defp put_filter(opts, _key, ""), do: opts
  defp put_filter(opts, key, value), do: Keyword.put(opts, key, value)

  defp resolve_me(nil), do: {:ok, nil}
  defp resolve_me(""), do: {:ok, nil}

  defp resolve_me("me") do
    case Viewer.current() do
      {:ok, %{login: login}} -> {:ok, login}
      {:error, _reason} = error -> error
    end
  end

  defp resolve_me(value) when is_binary(value), do: {:ok, value}

  defp maybe_inject_creator(attrs) do
    case Viewer.current() do
      {:ok, %{login: login}} -> Map.put_new(attrs, "creator", login)
      {:error, _reason} -> attrs
    end
  end

  defp trim_or_nil(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp trim_or_nil(_), do: nil
```

- [ ] **Step 5.4: Run controller tests, expect PASS**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`
Expected: all new + existing issue controller tests pass.

- [ ] **Step 5.5: Commit**

```bash
cd /home/raphaelcangucu/symphony
cd elixir && mise exec -- mix format lib/symphony_elixir_web/controllers/tracker/issue_controller.ex test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs && cd -
git add elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs
git commit -m "feat(tracker-api): accept filter params and inject viewer as issue creator"
```

---

## Task 6 — `Config.local_assignee/0` and `LocalTracker.Tracker` `me` filter

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/tracker.ex`
- Modify: `elixir/test/symphony_elixir/local_tracker/tracker_test.exs`

- [ ] **Step 6.1: Write failing tests**

Append to `elixir/test/symphony_elixir/local_tracker/tracker_test.exs`:

```elixir
  describe "fetch_candidate_issues/0 with local.assignee" do
    alias SymphonyElixir.LocalTracker.{Context, Tracker, Viewer}

    setup do
      start_supervised!(Viewer.Server)
      Viewer.invalidate_cache()

      :ok = SymphonyElixir.Workflow.load_from_string!(~s"""
      ---
      local:
        project_slug: assignee-filter
        assignee: me
      tracker:
        active_states: ["Todo"]
      ---
      """)

      {:ok, _project} = Context.ensure_project(%{name: "AF", slug: "assignee-filter"})

      {:ok, _} =
        Context.create_issue("assignee-filter", %{
          title: "Mine",
          status: "Todo",
          assignee_id: "octocat"
        })

      {:ok, _} =
        Context.create_issue("assignee-filter", %{
          title: "Theirs",
          status: "Todo",
          assignee_id: "another"
        })

      :ok
    end

    test "returns only the viewer's issues when assignee=me" do
      Viewer.put_cached(%{login: "octocat", name: nil, avatar_url: nil})

      assert {:ok, issues} = Tracker.fetch_candidate_issues()
      assert Enum.map(issues, & &1.title) == ["Mine"]
    end

    test "returns empty list and logs warning when viewer unavailable" do
      System.delete_env("GITHUB_TOKEN")
      Viewer.invalidate_cache()

      log =
        ExUnit.CaptureLog.capture_log(fn ->
          assert {:ok, []} = Tracker.fetch_candidate_issues()
        end)

      assert log =~ "viewer_unavailable_for_local_assignee_filter"
    end
  end
```

Notes:
- The above assumes a `SymphonyElixir.Workflow.load_from_string!/1` helper exists or that tests set the workflow via the same mechanism existing tests use. Read `elixir/test/test_helper.exs` and `elixir/test/symphony_elixir/local_tracker/tracker_test.exs` first to confirm the correct API; replace this call with the equivalent helper used in the existing tracker tests. If no such helper exists, fall back to `Application.put_env(:symphony_elixir, :workflow_override, ...)` matching the pattern other tests use.

- [ ] **Step 6.2: Run, expect failure**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/tracker_test.exs`
Expected: failures because `assignee` filter is not yet applied.

- [ ] **Step 6.3: Add `Config.local_assignee/0`**

In `elixir/lib/symphony_elixir/config.ex`, immediately after `local_api_token_env/0`, add:

```elixir
  @spec local_assignee() :: String.t() | nil
  def local_assignee do
    section("local")
    |> Map.get("assignee")
    |> trim_string()
  end
```

The existing private `trim_string/1` handles `nil` and empty strings.

- [ ] **Step 6.4: Apply the filter in `LocalTracker.Tracker.fetch_issues_by_states/1`**

Modify `elixir/lib/symphony_elixir/local_tracker/tracker.ex`:

1. Add `require Logger` near the top (after `import Ecto.Query`).
2. Replace `fetch_issues_by_states/1` (the binary-list clause) with:

```elixir
  def fetch_issues_by_states(states) when is_list(states) do
    case resolve_assignee_filter() do
      {:ok, assignee_filter} ->
        with {:ok, project} <- fetch_active_project() do
          issues =
            IssueRecord
            |> where([issue], issue.project_id == ^project.id)
            |> join(:inner, [issue], status in assoc(issue, :status))
            |> where([_issue, status], status.name in ^states)
            |> maybe_filter_assignee(assignee_filter)
            |> order_by([issue], asc: issue.inserted_at, asc: issue.id)
            |> preload(^issue_preloads())
            |> Repo.all()
            |> IssueMapper.to_issues()

          {:ok, issues}
        end

      :empty ->
        {:ok, []}
    end
  end

  defp resolve_assignee_filter do
    case Config.local_assignee() do
      nil ->
        {:ok, :any}

      "me" ->
        case SymphonyElixir.LocalTracker.Viewer.current() do
          {:ok, %{login: login}} ->
            {:ok, {:login, login}}

          {:error, reason} ->
            Logger.warning(
              "viewer_unavailable_for_local_assignee_filter reason=#{inspect(reason)}"
            )

            :empty
        end

      login when is_binary(login) ->
        {:ok, {:login, login}}
    end
  end

  defp maybe_filter_assignee(query, :any), do: query

  defp maybe_filter_assignee(query, {:login, login}) when is_binary(login) do
    where(query, [issue, _status], issue.assignee_id == ^login)
  end
```

- [ ] **Step 6.5: Run, expect PASS**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/local_tracker/tracker_test.exs`
Expected: 2 new tests pass; existing tracker tests pass.

- [ ] **Step 6.6: Format, run full quality gate, commit**

```bash
cd /home/raphaelcangucu/symphony
cd elixir && mise exec -- mix format lib/symphony_elixir/config.ex lib/symphony_elixir/local_tracker/tracker.ex test/symphony_elixir/local_tracker/tracker_test.exs && mise exec -- mix all && cd -
git add elixir/lib/symphony_elixir/config.ex elixir/lib/symphony_elixir/local_tracker/tracker.ex elixir/test/symphony_elixir/local_tracker/tracker_test.exs
git commit -m "feat(local-tracker): honour local.assignee in orchestrator dispatch"
```

`mise exec -- mix all` is the alias defined in `elixir/Makefile`; if `mise` is unavailable, run each step (`mix format --check-formatted && mix credo --strict && mix test && mix dialyzer`).

---

## Task 7 — Frontend types and viewer service

**Files:**
- Create: `tracker/src/types/viewer.ts`
- Create: `tracker/src/services/viewer.ts`
- Create: `tracker/src/services/__tests__/viewer.test.ts`
- Modify: `tracker/src/types/issue.ts` (add `creator`)
- Modify: `tracker/src/services/mappers.ts` (add `normalizeViewer`, normalize `creator`)

- [ ] **Step 7.1: Write failing test**

Create `tracker/src/services/__tests__/viewer.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { ViewerNotConfiguredError, fetchViewer } from "@/services/viewer";

describe("viewer service", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the normalized viewer payload", async () => {
    vi.spyOn(http, "get").mockResolvedValueOnce({
      data: { data: { github_login: "octocat", name: "Octo", avatar_url: "https://x" } },
    });

    await expect(fetchViewer()).resolves.toEqual({
      githubLogin: "octocat",
      name: "Octo",
      avatarUrl: "https://x",
    });
  });

  it("throws ViewerNotConfiguredError on 503 github_token_missing", async () => {
    vi.spyOn(http, "get").mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 503,
        data: { error: { code: "github_token_missing", message: "missing" } },
      },
    });

    await expect(fetchViewer()).rejects.toMatchObject({
      name: "ViewerNotConfiguredError",
      code: "github_token_missing",
    });
  });

  it("throws ViewerNotConfiguredError on 401 github_unauthorized", async () => {
    vi.spyOn(http, "get").mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 401,
        data: { error: { code: "github_unauthorized", message: "bad token" } },
      },
    });

    await expect(fetchViewer()).rejects.toMatchObject({
      name: "ViewerNotConfiguredError",
      code: "github_unauthorized",
    });
  });
});
```

- [ ] **Step 7.2: Run, expect failure**

Run: `cd tracker && npm run test -- viewer.test.ts`
Expected: `Cannot find module '@/services/viewer'`.

- [ ] **Step 7.3: Create the type**

Create `tracker/src/types/viewer.ts`:

```ts
export interface Viewer {
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
}
```

- [ ] **Step 7.4: Create the service**

Create `tracker/src/services/viewer.ts`:

```ts
import axios from "axios";

import { http, trackerPath, unwrapData } from "./http";
import type { Viewer } from "@/types/viewer";

interface BackendViewerDto {
  github_login?: string | null;
  githubLogin?: string | null;
  name?: string | null;
  avatar_url?: string | null;
  avatarUrl?: string | null;
}

export class ViewerNotConfiguredError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "ViewerNotConfiguredError";
  }
}

export function normalizeViewer(dto: BackendViewerDto): Viewer {
  const login = dto.githubLogin ?? dto.github_login ?? "";
  if (!login.trim()) {
    throw new Error("viewer payload missing github_login");
  }

  return {
    githubLogin: login,
    name: dto.name ?? null,
    avatarUrl: dto.avatarUrl ?? dto.avatar_url ?? null,
  };
}

const VIEWER_ERROR_CODES = new Set(["github_token_missing", "github_unauthorized", "github_network_error", "github_malformed_response"]);

export async function fetchViewer(): Promise<Viewer> {
  try {
    const response = await http.get(trackerPath("/viewer"));
    return normalizeViewer(unwrapData<BackendViewerDto>(response));
  } catch (cause) {
    if (axios.isAxiosError(cause) && cause.response) {
      const code = (cause.response.data as { error?: { code?: string } } | undefined)?.error?.code;
      if (code && VIEWER_ERROR_CODES.has(code)) {
        throw new ViewerNotConfiguredError(code);
      }
    }

    throw cause;
  }
}
```

- [ ] **Step 7.5: Run, expect PASS**

Run: `cd tracker && npm run test -- viewer.test.ts`
Expected: 3 tests pass.

- [ ] **Step 7.6: Add `creator` to `Issue` and `normalizeIssue`**

Modify `tracker/src/types/issue.ts`: add `creator: string | null;` after `assignee: string | null;`.

Modify `tracker/src/services/mappers.ts`:

- In `BackendIssueDto` add `creator?: string | null;` after `assignee_id`.
- In `normalizeIssue` return value add `creator: dto.creator ?? null,` next to `assignee:`.

- [ ] **Step 7.7: Run typecheck + tests**

Run: `cd tracker && npm run lint && npm run test -- mappers viewer.test.ts`
Expected: existing mapper tests still pass; new viewer tests pass.

- [ ] **Step 7.8: Commit**

```bash
cd /home/raphaelcangucu/symphony
git add tracker/src/types/viewer.ts tracker/src/types/issue.ts tracker/src/services/viewer.ts tracker/src/services/mappers.ts tracker/src/services/__tests__/viewer.test.ts
git commit -m "feat(tracker): add viewer service and creator field on Issue type"
```

---

## Task 8 — `ViewerProvider` context + token gate

**Files:**
- Create: `tracker/src/components/auth/ViewerProvider.tsx`
- Create: `tracker/src/components/auth/__tests__/ViewerProvider.test.tsx`
- Modify: `tracker/src/App.tsx` (wrap `<RequireToken>` with `<ViewerProvider>`)
- Modify: `tracker/src/pages/TokenGatePage.tsx` (call `fetchViewer` after token validation)
- Create or modify: `tracker/src/pages/__tests__/TokenGatePage.test.tsx`

- [ ] **Step 8.1: Write failing provider test**

Create `tracker/src/components/auth/__tests__/ViewerProvider.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ViewerProvider, useViewer } from "@/components/auth/ViewerProvider";
import * as viewerService from "@/services/viewer";

function Probe() {
  const { status, viewer, error } = useViewer();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="login">{viewer?.githubLogin ?? ""}</span>
      <span data-testid="error">{error?.code ?? ""}</span>
    </div>
  );
}

describe("ViewerProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads the viewer and exposes status ready", async () => {
    vi.spyOn(viewerService, "fetchViewer").mockResolvedValueOnce({
      githubLogin: "octocat",
      name: null,
      avatarUrl: null,
    });

    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("login")).toHaveTextContent("octocat");
  });

  it("surfaces ViewerNotConfiguredError as status error", async () => {
    const error = new viewerService.ViewerNotConfiguredError("github_token_missing");
    vi.spyOn(viewerService, "fetchViewer").mockRejectedValueOnce(error);

    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
    expect(screen.getByTestId("error")).toHaveTextContent("github_token_missing");
  });
});
```

- [ ] **Step 8.2: Run, expect failure**

Run: `cd tracker && npm run test -- ViewerProvider`
Expected: module not found.

- [ ] **Step 8.3: Implement the provider**

Create `tracker/src/components/auth/ViewerProvider.tsx`:

```tsx
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";

import { ViewerNotConfiguredError, fetchViewer } from "@/services/viewer";
import type { Viewer } from "@/types/viewer";

export type ViewerStatus = "loading" | "ready" | "error";

interface ViewerContextValue {
  viewer: Viewer | null;
  status: ViewerStatus;
  error: ViewerNotConfiguredError | null;
  reload: () => Promise<void>;
}

const ViewerContext = createContext<ViewerContextValue | null>(null);

interface ViewerProviderProps {
  children: ReactNode;
}

export function ViewerProvider({ children }: ViewerProviderProps) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [error, setError] = useState<ViewerNotConfiguredError | null>(null);

  const reload = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const next = await fetchViewer();
      setViewer(next);
      setStatus("ready");
    } catch (cause) {
      if (cause instanceof ViewerNotConfiguredError) {
        setViewer(null);
        setError(cause);
        setStatus("error");
        return;
      }

      throw cause;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <ViewerContext.Provider value={{ viewer, status, error, reload }}>{children}</ViewerContext.Provider>
  );
}

export function useViewer(): ViewerContextValue {
  const ctx = useContext(ViewerContext);
  if (!ctx) {
    throw new Error("useViewer must be used inside a ViewerProvider");
  }
  return ctx;
}

export function useViewerLogin(): string | null {
  const { viewer } = useViewer();
  return viewer?.githubLogin ?? null;
}
```

- [ ] **Step 8.4: Wrap routes in `App.tsx`**

Modify `tracker/src/App.tsx`:

```tsx
import { ViewerProvider } from "@/components/auth/ViewerProvider";
```

Inside `<Routes>`, change:

```tsx
        <Route element={<RequireToken />}>
          <Route path="/" element={<Layout />}>
```

to:

```tsx
        <Route
          element={
            <RequireToken>
              <ViewerProvider>
                <Outlet />
              </ViewerProvider>
            </RequireToken>
          }
        >
          <Route path="/" element={<Layout />}>
```

Update `RequireToken` to accept and render `children`:

```tsx
function RequireToken({ children }: { children: React.ReactNode }) {
  return getTrackerToken() ? <>{children}</> : <Navigate to="/token" replace />;
}
```

Outlet is no longer needed inside `RequireToken`; the `ViewerProvider` wraps the `<Outlet />` directly. Import `Outlet` if not already imported (it is).

- [ ] **Step 8.5: Update `TokenGatePage` to verify the viewer before persisting the token**

Modify `tracker/src/pages/TokenGatePage.tsx` — replace `handleSubmit`:

```tsx
import { ViewerNotConfiguredError, fetchViewer } from "@/services/viewer";

async function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const value = token.trim();
  if (!value) return;

  setError(null);
  setValidating(true);

  try {
    await validateTrackerToken(value);
    setTrackerToken(value);

    try {
      await fetchViewer();
    } catch (cause) {
      if (cause instanceof ViewerNotConfiguredError) {
        clearTrackerToken();
        setError(viewerErrorMessage(cause.code));
        return;
      }

      throw cause;
    }

    navigate("/projects", { replace: true });
  } catch {
    setError("Invalid tracker token.");
  } finally {
    setValidating(false);
  }
}

function viewerErrorMessage(code: string): string {
  switch (code) {
    case "github_token_missing":
      return "GITHUB_TOKEN is not configured on the Symphony server. Set it and restart Symphony.";
    case "github_unauthorized":
      return "GitHub rejected the configured GITHUB_TOKEN. Generate a new token with the required scopes.";
    case "github_network_error":
      return "Symphony could not reach GitHub. Check the server's connectivity and retry.";
    default:
      return "Symphony could not identify the operator. Check the server configuration.";
  }
}
```

Import `clearTrackerToken` from `@/config` (it already exists).

- [ ] **Step 8.6: Run the provider and token gate tests**

Run: `cd tracker && npm run test -- ViewerProvider TokenGatePage`
Expected: provider tests pass.

If `tracker/src/pages/__tests__/TokenGatePage.test.tsx` does not yet exist, create it with at least one test that asserts the viewer call blocks navigation:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TokenGatePage } from "@/pages/TokenGatePage";
import * as authService from "@/services/auth";
import * as viewerService from "@/services/viewer";

describe("TokenGatePage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("blocks navigation and clears token when viewer fails", async () => {
    vi.spyOn(authService, "validateTrackerToken").mockResolvedValueOnce(undefined);
    vi.spyOn(viewerService, "fetchViewer").mockRejectedValueOnce(
      new viewerService.ViewerNotConfiguredError("github_token_missing"),
    );

    render(
      <MemoryRouter>
        <TokenGatePage />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByPlaceholderText(/tracker token/i), "abc");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByText(/GITHUB_TOKEN is not configured/i)).toBeInTheDocument(),
    );
    expect(window.localStorage.getItem("symphony.tracker.token")).toBeNull();
  });
});
```

- [ ] **Step 8.7: Commit**

```bash
cd /home/raphaelcangucu/symphony
git add tracker/src/components/auth/ViewerProvider.tsx tracker/src/components/auth/__tests__/ViewerProvider.test.tsx tracker/src/App.tsx tracker/src/pages/TokenGatePage.tsx tracker/src/pages/__tests__/TokenGatePage.test.tsx
git commit -m "feat(tracker): block app on missing viewer with ViewerProvider context"
```

---

## Task 9 — Filter param wiring in `services/issues.ts`

**Files:**
- Modify: `tracker/src/services/issues.ts`
- Create or modify: `tracker/src/services/__tests__/issues.test.ts`

- [ ] **Step 9.1: Write the failing test**

Create `tracker/src/services/__tests__/issues.test.ts` (or append if it already exists):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { listIssues } from "@/services/issues";

describe("issues service filters", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls the issues endpoint without params when filters omitted", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: [] } });

    await listIssues("macro-markets");

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues");
  });

  it("forwards search, assignee, and creator filters", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: [] } });

    await listIssues("macro-markets", { search: "login ui", assignee: "me", creator: "octocat" });

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues", {
      params: { q: "login ui", assignee: "me", creator: "octocat" },
    });
  });

  it("omits empty filter values", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: [] } });

    await listIssues("macro-markets", { search: "", assignee: "alice" });

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues", {
      params: { assignee: "alice" },
    });
  });
});
```

- [ ] **Step 9.2: Run, expect failure**

Run: `cd tracker && npm run test -- issues.test.ts`
Expected: `listIssues` signature mismatch.

- [ ] **Step 9.3: Update `listIssues`**

Modify `tracker/src/services/issues.ts`:

```ts
export interface IssueListFilters {
  search?: string;
  assignee?: string;
  creator?: string;
}

export async function listIssues(projectSlug: string, filters: IssueListFilters = {}): Promise<Issue[]> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");

  const params = buildIssueListParams(filters);
  const path = trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues`);
  const response = Object.keys(params).length === 0
    ? await http.get(path)
    : await http.get(path, { params });

  return unwrapData<BackendIssueDto[]>(response).map(normalizeIssue);
}

function buildIssueListParams(filters: IssueListFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.search && filters.search.trim()) params.q = filters.search.trim();
  if (filters.assignee && filters.assignee.trim()) params.assignee = filters.assignee.trim();
  if (filters.creator && filters.creator.trim()) params.creator = filters.creator.trim();
  return params;
}
```

- [ ] **Step 9.4: Run, expect PASS**

Run: `cd tracker && npm run test -- issues.test.ts`
Expected: 3 tests pass.

- [ ] **Step 9.5: Commit**

```bash
cd /home/raphaelcangucu/symphony
git add tracker/src/services/issues.ts tracker/src/services/__tests__/issues.test.ts
git commit -m "feat(tracker): accept search/assignee/creator filters in listIssues"
```

---

## Task 10 — `issueFilters` helper and filter-aware `useIssueBoard`

**Files:**
- Create: `tracker/src/lib/issueFilters.ts`
- Create: `tracker/src/lib/__tests__/issueFilters.test.ts`
- Modify: `tracker/src/hooks/useIssueBoard.ts`
- Create or modify: `tracker/src/hooks/__tests__/useIssueBoard.test.tsx` (optional in MVP if the existing hook is already covered indirectly; create only if no coverage exists)

- [ ] **Step 10.1: Write the failing helper test**

Create `tracker/src/lib/__tests__/issueFilters.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { applyIssueFilters, filtersFromSearchParams, type IssueFilters } from "@/lib/issueFilters";
import type { Issue } from "@/types/issue";

function issueFixture(overrides: Partial<Issue>): Issue {
  return {
    id: "1",
    identifier: "AB-1",
    projectSlug: "demo",
    status: "Todo",
    title: "Sample",
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("filtersFromSearchParams", () => {
  it("reads supported keys and trims values", () => {
    const params = new URLSearchParams({ q: " login ", assignee: "me", creator: "octocat", foo: "bar" });

    expect(filtersFromSearchParams(params)).toEqual<IssueFilters>({
      search: "login",
      assignee: "me",
      creator: "octocat",
    });
  });

  it("omits empty values", () => {
    const params = new URLSearchParams({ q: "  ", assignee: "" });
    expect(filtersFromSearchParams(params)).toEqual<IssueFilters>({});
  });
});

describe("applyIssueFilters", () => {
  const viewerLogin = "octocat";

  it("returns all issues with no filters", () => {
    const issues = [issueFixture({}), issueFixture({ id: "2" })];
    expect(applyIssueFilters(issues, {}, viewerLogin)).toHaveLength(2);
  });

  it("filters by search across title, description and identifier", () => {
    const issues = [
      issueFixture({ id: "1", title: "Add dark mode" }),
      issueFixture({ id: "2", description: "Improve DARK theme" }),
      issueFixture({ id: "3", identifier: "DARK-99" }),
      issueFixture({ id: "4", title: "Unrelated" }),
    ];

    const ids = applyIssueFilters(issues, { search: "dark" }, viewerLogin).map((issue) => issue.id);
    expect(ids).toEqual(["1", "2", "3"]);
  });

  it("filters by assignee with 'me' substitution", () => {
    const issues = [
      issueFixture({ id: "1", assignee: "octocat" }),
      issueFixture({ id: "2", assignee: "alice" }),
    ];

    expect(applyIssueFilters(issues, { assignee: "me" }, viewerLogin).map((i) => i.id)).toEqual(["1"]);
  });

  it("filters by creator with literal login", () => {
    const issues = [
      issueFixture({ id: "1", creator: "octocat" }),
      issueFixture({ id: "2", creator: "alice" }),
    ];

    expect(applyIssueFilters(issues, { creator: "alice" }, viewerLogin).map((i) => i.id)).toEqual(["2"]);
  });
});
```

- [ ] **Step 10.2: Run, expect failure**

Run: `cd tracker && npm run test -- issueFilters.test.ts`
Expected: module missing.

- [ ] **Step 10.3: Implement `issueFilters`**

Create `tracker/src/lib/issueFilters.ts`:

```ts
import type { Issue } from "@/types/issue";

export interface IssueFilters {
  search?: string;
  assignee?: string;
  creator?: string;
}

const SUPPORTED_KEYS = ["q", "assignee", "creator"] as const;

export function filtersFromSearchParams(params: URLSearchParams): IssueFilters {
  const filters: IssueFilters = {};
  for (const key of SUPPORTED_KEYS) {
    const raw = params.get(key);
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (key === "q") filters.search = trimmed;
    if (key === "assignee") filters.assignee = trimmed;
    if (key === "creator") filters.creator = trimmed;
  }
  return filters;
}

export function applyIssueFilters(issues: Issue[], filters: IssueFilters, viewerLogin: string | null): Issue[] {
  const resolved = resolveMeFilters(filters, viewerLogin);

  return issues.filter((issue) => {
    if (resolved.search) {
      const term = resolved.search.toLowerCase();
      const haystack = [issue.title, issue.description ?? "", issue.identifier].join(" ").toLowerCase();
      if (!haystack.includes(term)) return false;
    }

    if (resolved.assignee && issue.assignee !== resolved.assignee) return false;
    if (resolved.creator && issue.creator !== resolved.creator) return false;
    return true;
  });
}

function resolveMeFilters(filters: IssueFilters, viewerLogin: string | null): IssueFilters {
  const resolved: IssueFilters = { ...filters };
  if (resolved.assignee === "me") {
    resolved.assignee = viewerLogin ?? undefined;
  }
  if (resolved.creator === "me") {
    resolved.creator = viewerLogin ?? undefined;
  }
  return resolved;
}
```

- [ ] **Step 10.4: Update `useIssueBoard` to accept filters and post-filter websocket events**

Modify `tracker/src/hooks/useIssueBoard.ts`:

```ts
import type { IssueFilters } from "@/lib/issueFilters";
import { applyIssueFilters } from "@/lib/issueFilters";
import { useViewer } from "@/components/auth/ViewerProvider";

export function useIssueBoard(
  projectSlug: string,
  filters: IssueFilters = {},
  statuses?: WorkflowStatusName[],
): UseIssueBoardResult {
  const { viewer } = useViewer();
  const viewerLogin = viewer?.githubLogin ?? null;

  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!projectSlug.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setIssues(await listIssues(projectSlug, filters));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to load issues";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectSlug, filters.search, filters.assignee, filters.creator]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const filteredIssues = useMemo(
    () => applyIssueFilters(issues, filters, viewerLogin),
    [issues, filters.search, filters.assignee, filters.creator, viewerLogin],
  );

  const board = useMemo(() => buildBoardState(filteredIssues, statuses), [filteredIssues, statuses]);

  // ... existing moveIssueOptimistically remains, but use filteredIssues for board state derivation
  // ... websocket event handlers stay; post-filtering is applied via filteredIssues above
```

Important: keep all current behaviour intact (move optimistic, websocket upsert). Only add the `filters` parameter, the resolved `filteredIssues`, and use `filteredIssues` for `board`. Tests in `tracker/src/pages/__tests__/ProjectListPage.test.tsx` (already passing) must remain green.

Return shape change: rename the exported `issues` field to expose the **unfiltered** list to existing consumers; add a new `filteredIssues` if needed. To minimize churn, the simplest path is:

- Keep `issues` as the raw list (existing behaviour).
- Add `filteredIssues` and `board` derived from `applyIssueFilters`.
- Update consumers that already read `board` (those automatically get filtered data).
- Consumers that read `issues` directly (e.g. `ProjectListPage`) should switch to `filteredIssues` when filters apply; pass a fresh `filters` argument.

Adjust the `UseIssueBoardResult` interface accordingly:

```ts
export interface UseIssueBoardResult {
  issues: Issue[];
  filteredIssues: Issue[];
  board: ReturnType<typeof buildBoardState>;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  moveIssueOptimistically: (...args: unknown[]) => Promise<void>;
  setIssues: React.Dispatch<React.SetStateAction<Issue[]>>;
}
```

- [ ] **Step 10.5: Run lint/typecheck + all tracker tests**

Run: `cd tracker && npm run lint && npm run test`
Expected: all tests green.

- [ ] **Step 10.6: Commit**

```bash
cd /home/raphaelcangucu/symphony
git add tracker/src/lib/issueFilters.ts tracker/src/lib/__tests__/issueFilters.test.ts tracker/src/hooks/useIssueBoard.ts
git commit -m "feat(tracker): post-filter issues with URL filters and viewer-aware me resolution"
```

---

## Task 11 — Right-side `BoardFiltersDrawer` + header trigger

**Files:**
- Create: `tracker/src/components/board/useBoardFiltersDrawer.ts`
- Create: `tracker/src/components/board/BoardFiltersDrawer.tsx`
- Create: `tracker/src/components/board/BoardFiltersTrigger.tsx`
- Create: `tracker/src/components/board/__tests__/BoardFiltersDrawer.test.tsx`

The drawer reuses the existing shadcn `Sheet` primitive at `tracker/src/components/ui/sheet.tsx` (`side="right"`). All three new components share a single React context hook `useBoardFiltersDrawer` so the header trigger, the drawer body, and the command palette (Task 12) all read/write the same `{ open, focusSearchSignal }` state.

- [ ] **Step 11.1: Write the failing drawer test**

Create `tracker/src/components/board/__tests__/BoardFiltersDrawer.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoardFiltersDrawer } from "@/components/board/BoardFiltersDrawer";
import { BoardFiltersDrawerProvider } from "@/components/board/useBoardFiltersDrawer";
import { BoardFiltersTrigger } from "@/components/board/BoardFiltersTrigger";
import { ViewerProvider } from "@/components/auth/ViewerProvider";
import * as viewerService from "@/services/viewer";

function Harness() {
  const [params] = useSearchParams();
  return (
    <BoardFiltersDrawerProvider>
      <BoardFiltersTrigger />
      <BoardFiltersDrawer knownLogins={["alice", "bob"]} />
      <output data-testid="params">{params.toString()}</output>
    </BoardFiltersDrawerProvider>
  );
}

function renderHarness() {
  vi.spyOn(viewerService, "fetchViewer").mockResolvedValueOnce({
    githubLogin: "octocat",
    name: null,
    avatarUrl: null,
  });

  return render(
    <MemoryRouter initialEntries={["/projects/x/board"]}>
      <ViewerProvider>
        <Routes>
          <Route path="/projects/:projectSlug/board" element={<Harness />} />
        </Routes>
      </ViewerProvider>
    </MemoryRouter>,
  );
}

describe("BoardFiltersDrawer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is closed by default and opens via the header trigger", async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByRole("button", { name: /filters/i })).toBeInTheDocument());

    expect(screen.queryByPlaceholderText(/search issues/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /filters/i }));

    expect(await screen.findByPlaceholderText(/search issues/i)).toBeInTheDocument();
  });

  it("debounces the search input into ?q=", async () => {
    vi.useFakeTimers();
    renderHarness();
    await waitFor(() => expect(screen.getByRole("button", { name: /filters/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.change(screen.getByPlaceholderText(/search issues/i), { target: { value: "login" } });
    vi.advanceTimersByTime(260);

    await waitFor(() => expect(screen.getByTestId("params").textContent).toContain("q=login"));
    vi.useRealTimers();
  });

  it("applies assignee=me from the dropdown", async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByRole("button", { name: /filters/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    await userEvent.click(screen.getByRole("button", { name: /assignee/i }));
    await userEvent.click(screen.getByText(/^Me$/));

    expect(screen.getByTestId("params").textContent).toContain("assignee=me");
  });

  it("clears all filters but keeps the drawer open", async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByRole("button", { name: /filters/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.change(screen.getByPlaceholderText(/search issues/i), { target: { value: "x" } });
    await userEvent.click(screen.getByRole("button", { name: /clear all filters/i }));

    expect(screen.getByTestId("params").textContent).toBe("");
    expect(screen.getByPlaceholderText(/search issues/i)).toBeInTheDocument();
  });

  it("trigger badge reflects the active filter count", async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByRole("button", { name: /filters/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.change(screen.getByPlaceholderText(/search issues/i), { target: { value: "login" } });
    // advance debounce
    await waitFor(() => expect(screen.getByTestId("params").textContent).toContain("q="));

    expect(screen.getByRole("button", { name: /filters/i })).toHaveTextContent("Filters · 1");
  });
});
```

- [ ] **Step 11.2: Run, expect failure**

Run: `cd tracker && npm run test -- BoardFiltersDrawer`
Expected: module not found.

- [ ] **Step 11.3: Implement the shared drawer hook**

Create `tracker/src/components/board/useBoardFiltersDrawer.ts`:

```ts
import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

interface DrawerState {
  open: boolean;
  focusSearchSignal: number;
}

interface DrawerContextValue extends DrawerState {
  setOpen: (next: boolean) => void;
  openAndFocusSearch: () => void;
}

const DrawerContext = createContext<DrawerContextValue | null>(null);

interface BoardFiltersDrawerProviderProps {
  children: ReactNode;
}

export function BoardFiltersDrawerProvider({ children }: BoardFiltersDrawerProviderProps) {
  const [state, setState] = useState<DrawerState>({ open: false, focusSearchSignal: 0 });

  const setOpen = useCallback((next: boolean) => {
    setState((current) => ({ ...current, open: next }));
  }, []);

  const openAndFocusSearch = useCallback(() => {
    setState((current) => ({ open: true, focusSearchSignal: current.focusSearchSignal + 1 }));
  }, []);

  const value = useMemo<DrawerContextValue>(
    () => ({ ...state, setOpen, openAndFocusSearch }),
    [state, setOpen, openAndFocusSearch],
  );

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}

export function useBoardFiltersDrawer(): DrawerContextValue {
  const ctx = useContext(DrawerContext);
  if (!ctx) throw new Error("useBoardFiltersDrawer must be used inside BoardFiltersDrawerProvider");
  return ctx;
}
```

Note: this file mixes JSX and `.ts`. Rename it to `.tsx` if your project's TS config enforces it; the existing `hooks/useProjectChannel.ts` uses `.ts` despite returning JSX-less code. If your project enforces no-JSX in `.ts`, switch the extension to `.tsx`.

- [ ] **Step 11.4: Implement the trigger button**

Create `tracker/src/components/board/BoardFiltersTrigger.tsx`:

```tsx
import { ListFilter } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useBoardFiltersDrawer } from "./useBoardFiltersDrawer";

const TRACKED_KEYS = ["q", "assignee", "creator"] as const;

export function BoardFiltersTrigger() {
  const { setOpen, open } = useBoardFiltersDrawer();
  const [searchParams] = useSearchParams();
  const activeCount = TRACKED_KEYS.reduce((acc, key) => {
    const value = searchParams.get(key);
    return acc + (value && value.trim() ? 1 : 0);
  }, 0);

  const label = activeCount === 0 ? "Filters" : `Filters · ${activeCount}`;

  return (
    <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
      <ListFilter className="h-4 w-4" />
      {label}
    </Button>
  );
}
```

- [ ] **Step 11.5: Implement the drawer body**

Create `tracker/src/components/board/BoardFiltersDrawer.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useViewer } from "@/components/auth/ViewerProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useBoardFiltersDrawer } from "./useBoardFiltersDrawer";

const DEBOUNCE_MS = 250;

interface BoardFiltersDrawerProps {
  knownLogins?: string[];
}

export function BoardFiltersDrawer({ knownLogins = [] }: BoardFiltersDrawerProps) {
  const { open, setOpen, focusSearchSignal } = useBoardFiltersDrawer();
  const [searchParams, setSearchParams] = useSearchParams();
  const { viewer, status } = useViewer();
  const viewerLogin = viewer?.githubLogin ?? null;

  const [searchDraft, setSearchDraft] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSearchDraft(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => {
    if (focusSearchSignal > 0) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [focusSearchSignal, open]);

  function commitSearch(next: string) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        const trimmed = next.trim();
        if (trimmed) params.set("q", trimmed);
        else params.delete("q");
        return params;
      },
      { replace: true },
    );
  }

  function setFilter(key: "assignee" | "creator", value: string | null) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (value) params.set(key, value);
        else params.delete(key);
        return params;
      },
      { replace: true },
    );
  }

  function clearFilters() {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.delete("q");
        params.delete("assignee");
        params.delete("creator");
        return params;
      },
      { replace: true },
    );
    setSearchDraft("");
  }

  function onSearchChange(value: string) {
    setSearchDraft(value);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => commitSearch(value), DEBOUNCE_MS);
  }

  const showViewerOptions = status === "ready" && viewerLogin;
  const assignee = searchParams.get("assignee");
  const creator = searchParams.get("creator");
  const hasAny = Boolean(searchDraft) || Boolean(assignee) || Boolean(creator);
  const logins = useMemo(() => Array.from(new Set(knownLogins.filter(Boolean))).sort(), [knownLogins]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex h-full flex-col gap-6 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Search and narrow issues by assignee or creator.</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 overflow-auto">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Search</label>
            <Input
              data-testid="board-filters-search"
              ref={searchInputRef}
              value={searchDraft}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search issues..."
            />
          </div>

          <FilterSection
            label="Assignee"
            currentValue={assignee}
            viewerLogin={showViewerOptions ? viewerLogin : null}
            logins={logins}
            onSelect={(value) => setFilter("assignee", value)}
            onClear={() => setFilter("assignee", null)}
          />

          <FilterSection
            label="Creator"
            currentValue={creator}
            viewerLogin={showViewerOptions ? viewerLogin : null}
            logins={logins}
            onSelect={(value) => setFilter("creator", value)}
            onClear={() => setFilter("creator", null)}
          />
        </div>

        <SheetFooter className="mt-auto flex flex-row items-center justify-between gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" disabled={!hasAny} onClick={clearFilters}>
            Clear all filters
          </Button>
          <SheetClose asChild>
            <Button size="sm">Done</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

interface FilterSectionProps {
  label: "Assignee" | "Creator";
  currentValue: string | null;
  viewerLogin: string | null;
  logins: string[];
  onSelect: (value: string) => void;
  onClear: () => void;
}

function FilterSection({ label, currentValue, viewerLogin, logins, onSelect, onClear }: FilterSectionProps) {
  const renderLabel = currentValue ? `${label}: ${currentValue === "me" ? "Me" : currentValue}` : `${label}: Any`;

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-start">
            {renderLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onClear()}>Any</DropdownMenuItem>
          {viewerLogin ? <DropdownMenuItem onSelect={() => onSelect("me")}>Me</DropdownMenuItem> : null}
          <DropdownMenuSeparator />
          {logins.length === 0 ? (
            <DropdownMenuItem disabled>No known logins</DropdownMenuItem>
          ) : (
            logins.map((login) => (
              <DropdownMenuItem key={login} onSelect={() => onSelect(login)}>
                @{login}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

If `tracker/src/components/ui/dropdown-menu.tsx` does not yet exist, add it via shadcn primitives (the project already pulls `@radix-ui/react-dropdown-menu`, and `components.json` is configured). If for any reason you cannot use the shadcn helper, the fallback is to consume `@radix-ui/react-dropdown-menu` primitives directly.

- [ ] **Step 11.6: Run, expect PASS**

Run: `cd tracker && npm run test -- BoardFiltersDrawer`
Expected: 5 tests pass.

- [ ] **Step 11.7: Commit**

```bash
cd /home/raphaelcangucu/symphony
git add tracker/src/components/board/useBoardFiltersDrawer.ts tracker/src/components/board/BoardFiltersDrawer.tsx tracker/src/components/board/BoardFiltersTrigger.tsx tracker/src/components/board/__tests__/BoardFiltersDrawer.test.tsx
git commit -m "feat(tracker): collapsible right-side board filter drawer with URL sync"
```

---

## Task 12 — Command palette + hotkeys (drives the drawer)

**Files:**
- Modify: `tracker/package.json` (add `cmdk`)
- Create: `tracker/src/components/board/BoardPaletteShortcuts.tsx`
- Create: `tracker/src/components/board/__tests__/BoardPaletteShortcuts.test.tsx`

The palette must operate on the same `useBoardFiltersDrawer()` state from Task 11 so the drawer reacts to its actions.

- [ ] **Step 12.1: Install `cmdk`**

Run: `cd tracker && npm install cmdk@latest`
Expected: `cmdk` appears in `dependencies`. Commit the `package.json`/`package-lock.json` update with this task's commit.

- [ ] **Step 12.2: Write the failing test**

Create `tracker/src/components/board/__tests__/BoardPaletteShortcuts.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoardPaletteShortcuts } from "@/components/board/BoardPaletteShortcuts";
import { BoardFiltersDrawer } from "@/components/board/BoardFiltersDrawer";
import { BoardFiltersDrawerProvider } from "@/components/board/useBoardFiltersDrawer";
import { ViewerProvider } from "@/components/auth/ViewerProvider";
import * as viewerService from "@/services/viewer";

function Harness() {
  const [params] = useSearchParams();
  return (
    <BoardFiltersDrawerProvider>
      <BoardPaletteShortcuts />
      <BoardFiltersDrawer />
      <output data-testid="params">{params.toString()}</output>
    </BoardFiltersDrawerProvider>
  );
}

function renderHarness() {
  vi.spyOn(viewerService, "fetchViewer").mockResolvedValueOnce({
    githubLogin: "octocat",
    name: null,
    avatarUrl: null,
  });

  return render(
    <MemoryRouter initialEntries={["/projects/x/board"]}>
      <ViewerProvider>
        <Routes>
          <Route path="/projects/:projectSlug/board" element={<Harness />} />
        </Routes>
      </ViewerProvider>
    </MemoryRouter>,
  );
}

describe("BoardPaletteShortcuts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens the palette via Cmd+K", async () => {
    renderHarness();
    await waitFor(() => expect(document.body).toBeInTheDocument());

    await userEvent.keyboard("{Meta>}k{/Meta}");

    expect(await screen.findByPlaceholderText(/type a command/i)).toBeInTheDocument();
  });

  it("opens the drawer and focuses search when '/' is pressed", async () => {
    renderHarness();
    await waitFor(() => expect(document.body).toBeInTheDocument());

    await userEvent.keyboard("/");

    expect(await screen.findByPlaceholderText(/search issues/i)).toHaveFocus();
  });

  it("'Filter: Assigned to me' sets assignee=me", async () => {
    renderHarness();
    await waitFor(() => expect(document.body).toBeInTheDocument());

    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.click(await screen.findByText(/Assigned to me/i));

    expect(screen.getByTestId("params").textContent).toContain("assignee=me");
  });

  it("'Clear filters' resets URL params", async () => {
    renderHarness();
    await waitFor(() => expect(document.body).toBeInTheDocument());

    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.click(await screen.findByText(/Assigned to me/i));
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.click(await screen.findByText(/Clear filters/i));

    expect(screen.getByTestId("params").textContent).toBe("");
  });
});
```

- [ ] **Step 12.3: Run, expect failure**

Run: `cd tracker && npm run test -- BoardPaletteShortcuts`
Expected: module not found.

- [ ] **Step 12.4: Implement the palette component**

Create `tracker/src/components/board/BoardPaletteShortcuts.tsx`:

```tsx
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "cmdk";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useViewer } from "@/components/auth/ViewerProvider";
import { useBoardFiltersDrawer } from "./useBoardFiltersDrawer";

export function BoardPaletteShortcuts() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [, setSearchParams] = useSearchParams();
  const { viewer } = useViewer();
  const { setOpen: setDrawerOpen, openAndFocusSearch } = useBoardFiltersDrawer();

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const insideInput = tagName === "input" || tagName === "textarea" || target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }

      if (event.key === "/" && !insideInput) {
        event.preventDefault();
        openAndFocusSearch();
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openAndFocusSearch]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  function applyFilter(action: "assignee_me" | "creator_me" | "clear" | "open_drawer" | "focus_search") {
    closePalette();

    if (action === "open_drawer") {
      setDrawerOpen(true);
      return;
    }

    if (action === "focus_search") {
      openAndFocusSearch();
      return;
    }

    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (action === "assignee_me") params.set("assignee", "me");
        if (action === "creator_me") params.set("creator", "me");
        if (action === "clear") {
          params.delete("assignee");
          params.delete("creator");
          params.delete("q");
        }
        return params;
      },
      { replace: true },
    );
  }

  if (!viewer) return null;

  return (
    <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <Command>
        <CommandInput placeholder="Type a command..." />
        <CommandList>
          <CommandEmpty>No matching command.</CommandEmpty>
          <CommandGroup heading="Filters">
            <CommandItem onSelect={() => applyFilter("open_drawer")}>Open filters</CommandItem>
            <CommandItem onSelect={() => applyFilter("focus_search")}>Search issues...</CommandItem>
            <CommandItem onSelect={() => applyFilter("assignee_me")}>Filter: Assigned to me</CommandItem>
            <CommandItem onSelect={() => applyFilter("creator_me")}>Filter: Created by me</CommandItem>
            <CommandItem onSelect={() => applyFilter("clear")}>Clear filters</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
```

If `tracker/src/components/ui/command.tsx` (shadcn) exists, prefer those imports for visual consistency; otherwise the raw `cmdk` primitives above suffice for Slice A.

- [ ] **Step 12.5: Run, expect PASS**

Run: `cd tracker && npm run test -- BoardPaletteShortcuts`
Expected: 4 tests pass.

- [ ] **Step 12.6: Commit**

```bash
cd /home/raphaelcangucu/symphony
git add tracker/package.json tracker/package-lock.json tracker/src/components/board/BoardPaletteShortcuts.tsx tracker/src/components/board/__tests__/BoardPaletteShortcuts.test.tsx
git commit -m "feat(tracker): board command palette drives the filter drawer"
```

---

## Task 13 — Wire drawer + trigger + palette into the pages

**Files:**
- Modify: `tracker/src/components/layout/ProjectHeader.tsx` (mount `<BoardFiltersTrigger />`)
- Modify: `tracker/src/pages/ProjectBoardPage.tsx`
- Modify: `tracker/src/pages/ProjectListPage.tsx`

The shared `BoardFiltersDrawerProvider` must wrap the trigger, the drawer, and the palette. Mounting the provider at the page level is simplest because the trigger lives in the header (which is rendered by the page).

- [ ] **Step 13.1: Read the existing files first**

Run via the Read tool:
- `tracker/src/components/layout/ProjectHeader.tsx`
- `tracker/src/pages/ProjectBoardPage.tsx`
- `tracker/src/pages/ProjectListPage.tsx`

Identify where the page mounts `<ProjectHeader />` and where it renders the issue area. Note any existing right-side controls inside the header where the new `Filters` button should sit (typically near the "New issue" / theme buttons).

- [ ] **Step 13.2: Embed the trigger in the header**

Modify `tracker/src/components/layout/ProjectHeader.tsx` — add an opt-in slot:

```tsx
import { ReactNode } from "react";

interface ProjectHeaderProps {
  projectSlug: string;
  onIssueCreated?: (...args: unknown[]) => void;
  rightSlot?: ReactNode;
}

// inside the JSX, render `{rightSlot}` next to existing right-aligned buttons
```

If `ProjectHeader` already accepts arbitrary children or its right-side region is fixed, prefer wrapping the existing right-aligned region with a fragment that includes `{rightSlot}` before the existing buttons. Keep the change minimal; no behaviour change when `rightSlot` is omitted.

- [ ] **Step 13.3: Mount the provider + drawer + palette + trigger on the board page**

Modify `tracker/src/pages/ProjectBoardPage.tsx`:

```tsx
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import {
  BoardFiltersDrawer,
} from "@/components/board/BoardFiltersDrawer";
import { BoardFiltersTrigger } from "@/components/board/BoardFiltersTrigger";
import { BoardPaletteShortcuts } from "@/components/board/BoardPaletteShortcuts";
import { BoardFiltersDrawerProvider } from "@/components/board/useBoardFiltersDrawer";
import { filtersFromSearchParams } from "@/lib/issueFilters";

// ... inside the component
const [searchParams] = useSearchParams();
const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
const { issues, filteredIssues, board, loading, error } = useIssueBoard(projectSlug, filters, statuses);

const knownLogins = useMemo(() => {
  const set = new Set<string>();
  for (const issue of issues) {
    if (issue.assignee) set.add(issue.assignee);
    if (issue.creator) set.add(issue.creator);
  }
  return Array.from(set);
}, [issues]);

return (
  <BoardFiltersDrawerProvider>
    <ProjectHeader
      projectSlug={projectSlug}
      onIssueCreated={...}
      rightSlot={<BoardFiltersTrigger />}
    />
    <BoardFiltersDrawer knownLogins={knownLogins} />
    <BoardPaletteShortcuts />
    {/* existing board rendering uses `board` and `filteredIssues` */}
  </BoardFiltersDrawerProvider>
);
```

- [ ] **Step 13.4: Repeat for the list view in `ProjectListPage.tsx`**

The list view component (inside `ProjectListPage.tsx`) also renders issues for a single project. Wrap it in `BoardFiltersDrawerProvider`, pass `filters` into `useIssueBoard`, and mount the same three components (trigger via header `rightSlot`, drawer, palette).

The index `/projects` view that lists *projects* (not issues) must remain unchanged — the drawer is project-scoped, not for the projects index.

- [ ] **Step 13.5: Verify**

Run: `cd tracker && npm run lint && npm run test && npm run build`
Expected: all green. If `useIssueBoard` consumers in any test still pass the legacy signature without `filters`, the default value `{}` keeps them compatible (Task 10 made `filters` optional).

- [ ] **Step 13.6: Commit**

```bash
cd /home/raphaelcangucu/symphony
git add tracker/src/components/layout/ProjectHeader.tsx tracker/src/pages/ProjectBoardPage.tsx tracker/src/pages/ProjectListPage.tsx
git commit -m "feat(tracker): mount filter drawer, trigger, and palette on board/list views"
```

---

## Task 14 — Final quality gates and PR readiness

- [ ] **Step 14.1: Run full Elixir quality gate**

Run: `cd elixir && mise exec -- mix all`
Expected: format check, credo, dialyzer, and full test suite all pass.

- [ ] **Step 14.2: Run full frontend gate**

Run: `cd tracker && npm run lint && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 14.3: Manual smoke (optional but recommended)**

Steps:

1. `export GITHUB_TOKEN=...` (a valid token).
2. `export SYMPHONY_TRACKER_TOKEN=secret`.
3. `cd elixir && mise exec -- mix ecto.migrate && mise exec -- mix phx.server` (or whatever launches the local app).
4. Open the tracker UI, paste `secret`, log in.
5. Observe `/api/tracker/v1/viewer` returns 200 with your login.
6. Unset `GITHUB_TOKEN`, restart server, retry token gate, observe the block.
7. With viewer ready, create an issue from the UI — verify the response contains `creator = <your_login>`.
8. Use `?assignee=me` in the URL — verify only your issues appear; same for `creator=me`.
9. Click the `Filters` button in the board header → drawer opens from the right. Pick "Me" in `Assignee` → URL gains `assignee=me`. Close the drawer → filter persists.
10. Type `/` → drawer opens and search input is focused. `Cmd+K` → palette opens with the 5 actions; selecting "Filter: Assigned to me" updates the URL without forcing the drawer open.

- [ ] **Step 14.4: Push branch**

```bash
cd /home/raphaelcangucu/symphony
git push -u origin feat/viewer-identity-and-board-filters
```

- [ ] **Step 14.5: Open PR (only if user requests)**

The PR creation step is intentionally manual — wait for the user to ask before creating the PR. When asked, follow the existing PR template at `.github/pull_request_template.md`.

---

## Self-Review

### Spec coverage

| Spec section | Task |
|---|---|
| 2.1 Resolve viewer from `GITHUB_TOKEN` | Task 1 |
| 2.2 Cache with TTL | Task 1 |
| 2.3 Expose `/viewer` endpoint | Task 2 |
| 2.4 Block app at token gate | Task 8 |
| 2.5 Persist `creator` column | Task 3 |
| 2.6 Filters on `/issues` endpoint with `me` resolution | Task 5 |
| 2.7 Filter bar + `/` + `Cmd+K` | Tasks 11, 12, 13 |
| 2.8 Local orchestrator honours `local.assignee: me` | Task 6 |
| 6.1 `LocalTracker.Viewer` module | Task 1 |
| 6.2 `ViewerController` mapping | Task 2 |
| 6.3 Migration + schema | Task 3 |
| 6.4 `Context.list_issues/2` filter SQL | Task 4 |
| 6.5 `IssueController.index` `me` substitution | Task 5 |
| 6.6 `Config.local_assignee/0` | Task 6 |
| 6.7 DTO updates | Tasks 3, 7 |
| 7.1 Frontend viewer service | Task 7 |
| 7.2 `ViewerProvider` + hook | Task 8 |
| 7.3 Token gate flow | Task 8 |
| 7.4 `BoardFiltersDrawer` + trigger | Task 11 |
| 7.5 `useIssueBoard` refactor | Task 10 |
| 7.6 `listIssues` filters | Task 9 |
| 7.7 Palette + hotkeys (drives drawer) | Task 12 |
| 7.8 Issue creation reads `creator` from response | Task 7 (mapper) |

### Placeholder scan

- No `TBD`, `TODO`, "implement later", or "similar to Task N" instructions remain.
- Where a step depends on reading an existing file (e.g. `TrackerErrors` clauses, `useIssueBoard` shape, `ProjectBoardPage` layout), the instruction explicitly says "read first, then apply" with the surrounding context that must be preserved. This is unavoidable for safe edits in an existing codebase; the action is concrete.

### Type consistency

- `Viewer` (backend) returns `%{login, name, avatar_url}`; controller emits `github_login / name / avatar_url`; frontend type uses `githubLogin / name / avatarUrl`. Mapper handles both casings (`normalizeViewer` accepts both).
- `Issue.creator` is `String.t() | nil` on backend → `string | null` on frontend → exposed through the same mapper that already normalizes `assignee`.
- `IssueListFilters` keys match `Context.list_issues/2` opts (`search/assignee/creator`) and URL params (`q/assignee/creator`).
- `applyIssueFilters` resolves `"me"` consistently with the backend (both substitute to `viewer.login`).

### Risks called out

1. The `TrackerErrors` clauses need to match the existing helper signature. The plan explicitly tells the engineer to read the file first.
2. SQLite case-insensitive `LIKE` only covers ASCII; non-ASCII titles may not match. Acceptable for MVP; documented in the spec section 6.4.
3. `cmdk` may require an extra peer dependency in some Node setups; the install step is isolated to Task 12 to catch issues quickly.
4. Existing `ProjectListPage.test.tsx` already covers archive/restore; Task 10/13 changes must not break it. Step 14.2 catches regressions.

### Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-viewer-identity-and-board-filters.md`. Two execution options:

1. **Task-per-session (recommended)** — One plan task (or small batch like 1–3) per subagent or focused session, review between tasks, fast iteration. Particularly useful for the migration + schema change (Task 3) and the React provider wiring (Tasks 8 + 13) which benefit from focused review.
2. **Inline** — Run tasks in this conversation with explicit checkpoints after each task (user reviews before continuing).

Which approach do you prefer?
