# Agent Preference Hierarchy & Native Claude Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the coding agent (codex | claude) a user-selectable preference resolved as task > project > user default, and replace the external `symphony-claude` bridge with a native Elixir Claude backend (embedded + standalone) with full tool support via an MCP gateway.

**Architecture:** A spatie-style `settings` table holds the user default; `AgentPreference.resolve/3` implements the chain; project choice lives as `agent.kind` in `workflow_markdown` front matter (absent = inherit); task choice stays on `symphony:<kind>` labels. A new `Claude.AppServer` component spawns the `claude` CLI per turn (`--print --output-format stream-json`), translates events to the bridge vocabulary, and serves tools through a loopback MCP HTTP gateway. The assistant chat and dispatch become agent-switchable.

**Tech Stack:** Elixir/Phoenix (Bandit, Ecto/SQLite, Jason), React/TS (vite, vitest, shadcn/ui), Claude Code CLI, Codex app-server protocol.

**Spec:** `docs/superpowers/specs/2026-06-05-agent-preference-and-claude-native-design.md`

**Conventions for every task:**
- Run backend tests from `elixir/`: `make test ARGS="test/path/file_test.exs"` (sources `.env.testing`).
- Run frontend tests from `tracker/`: `npx vitest run src/path/file.test.ts`.
- The repo enforces 100% coverage with an `ignore_modules` list in `elixir/mix.exs` — pure-config/IO-heavy modules get added there explicitly when a task says so.
- Commit after each task with the message given in its final step.

---

## Phase 1 — Settings store & resolution chain (backend)

### Task 1: Generic settings table + `Settings` context (spatie model)

**Files:**
- Create: `elixir/priv/repo/migrations/20260605000100_create_settings.exs`
- Create: `elixir/lib/symphony_elixir/settings/setting.ex`
- Create: `elixir/lib/symphony_elixir/settings/group.ex`
- Create: `elixir/lib/symphony_elixir/settings/agents.ex`
- Create: `elixir/lib/symphony_elixir/settings.ex`
- Test: `elixir/test/symphony_elixir/settings_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.SettingsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(Setting)
    :ok
  end

  test "get returns the in-code default when no row exists" do
    assert Settings.get("agents", "default_agent_kind") == "codex"
  end

  test "put upserts by (group, name) and get returns the stored value" do
    assert {:ok, "claude"} = Settings.put("agents", "default_agent_kind", "claude")
    assert Settings.get("agents", "default_agent_kind") == "claude"

    assert {:ok, "codex"} = Settings.put("agents", "default_agent_kind", "codex")
    assert Settings.get("agents", "default_agent_kind") == "codex"
    assert Repo.aggregate(Setting, :count) == 1
  end

  test "put rejects unknown groups, unknown names, and invalid values" do
    assert {:error, :unknown_group} = Settings.put("nope", "default_agent_kind", "codex")
    assert {:error, :unknown_setting} = Settings.put("agents", "nope", "codex")
    assert {:error, :invalid_value} = Settings.put("agents", "default_agent_kind", "gemini")
  end

  test "get_group and all merge stored rows over defaults" do
    assert Settings.get_group("agents") == %{"default_agent_kind" => "codex"}

    {:ok, _} = Settings.put("agents", "default_agent_kind", "claude")

    assert Settings.get_group("agents") == %{"default_agent_kind" => "claude"}
    assert Settings.all() == %{"agents" => %{"default_agent_kind" => "claude"}}
  end

  test "a corrupt payload falls back to the default" do
    Repo.insert!(%Setting{group: "agents", name: "default_agent_kind", payload: %{"bogus" => true}})
    assert Settings.get("agents", "default_agent_kind") == "codex"
  end

  test "Settings.Agents.default_agent_kind/0 convenience reads the chain" do
    assert Settings.Agents.default_agent_kind() == "codex"
    {:ok, _} = Settings.put("agents", "default_agent_kind", "claude")
    assert Settings.Agents.default_agent_kind() == "claude"
  end
end
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `make test ARGS="test/symphony_elixir/settings_test.exs"`
Expected: FAIL — `module SymphonyElixir.Settings is not available`.

- [ ] **Step 3: Create the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateSettings do
  use Ecto.Migration

  def change do
    create table(:settings) do
      add(:group, :string, null: false)
      add(:name, :string, null: false)
      add(:payload, :map, null: false, default: %{})

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:settings, [:group, :name]))
  end
end
```

- [ ] **Step 4: Create the Ecto schema**

`elixir/lib/symphony_elixir/settings/setting.ex`:

```elixir
defmodule SymphonyElixir.Settings.Setting do
  @moduledoc "One stored setting value, keyed by (group, name) — spatie/laravel-settings model."

  use Ecto.Schema
  import Ecto.Changeset

  @type t :: %__MODULE__{}

  schema "settings" do
    field(:group, :string)
    field(:name, :string)
    field(:payload, :map, default: %{})

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(setting, attrs) do
    setting
    |> cast(attrs, [:group, :name, :payload])
    |> validate_required([:group, :name, :payload])
    |> unique_constraint([:group, :name])
  end
end
```

- [ ] **Step 5: Create the group behaviour and the agents group**

`elixir/lib/symphony_elixir/settings/group.ex`:

```elixir
defmodule SymphonyElixir.Settings.Group do
  @moduledoc """
  Behaviour for a settings group (the role of a spatie settings class):
  declares the group key, the in-code defaults, and per-name casting.
  """

  @callback group() :: String.t()
  @callback defaults() :: %{String.t() => term()}
  @callback cast(name :: String.t(), value :: term()) :: {:ok, term()} | :error
end
```

`elixir/lib/symphony_elixir/settings/agents.ex`:

```elixir
defmodule SymphonyElixir.Settings.Agents do
  @moduledoc "Agent-related operator settings (group \"agents\")."

  @behaviour SymphonyElixir.Settings.Group

  alias SymphonyElixir.InstanceConfig

  @agent_kinds ["codex", "claude"]

  @impl true
  def group, do: "agents"

  @impl true
  def defaults, do: %{"default_agent_kind" => InstanceConfig.default_agent_kind()}

  @impl true
  def cast("default_agent_kind", value) when value in @agent_kinds, do: {:ok, value}
  def cast(_name, _value), do: :error

  @spec agent_kinds() :: [String.t()]
  def agent_kinds, do: @agent_kinds

  @spec default_agent_kind() :: String.t()
  def default_agent_kind, do: SymphonyElixir.Settings.get(group(), "default_agent_kind")
end
```

- [ ] **Step 6: Create the Settings context**

`elixir/lib/symphony_elixir/settings.ex`:

```elixir
defmodule SymphonyElixir.Settings do
  @moduledoc """
  Generic key-value settings store mirroring spatie/laravel-settings:
  rows live in the `settings` table keyed by (group, name); group modules
  declare defaults and casts in code. Reads merge stored rows over
  defaults; a missing or corrupt row yields the default.
  """

  import Ecto.Query

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Setting

  @groups %{"agents" => SymphonyElixir.Settings.Agents}

  @spec groups() :: %{String.t() => module()}
  def groups, do: @groups

  @spec get(String.t(), String.t()) :: term()
  def get(group, name) when is_binary(group) and is_binary(name) do
    with {:ok, module} <- fetch_group(group),
         %{} = defaults <- module.defaults(),
         {:ok, default} <- Map.fetch(defaults, name) do
      case stored_value(group, name) do
        {:ok, value} ->
          case module.cast(name, value) do
            {:ok, cast} -> cast
            :error -> default
          end

        :missing ->
          default
      end
    else
      _ -> nil
    end
  end

  @spec get_group(String.t()) :: %{String.t() => term()} | nil
  def get_group(group) when is_binary(group) do
    case fetch_group(group) do
      {:ok, module} ->
        module.defaults()
        |> Map.new(fn {name, _default} -> {name, get(group, name)} end)

      :error ->
        nil
    end
  end

  @spec all() :: %{String.t() => %{String.t() => term()}}
  def all do
    Map.new(@groups, fn {group, _module} -> {group, get_group(group)} end)
  end

  @spec put(String.t(), String.t(), term()) ::
          {:ok, term()} | {:error, :unknown_group | :unknown_setting | :invalid_value | Ecto.Changeset.t()}
  def put(group, name, value) when is_binary(group) and is_binary(name) do
    with {:ok, module} <- fetch_group_or(group, :unknown_group),
         {:ok, _default} <- fetch_default_or(module, name, :unknown_setting),
         {:ok, cast} <- cast_or(module, name, value, :invalid_value) do
      %Setting{}
      |> Setting.changeset(%{group: group, name: name, payload: %{"value" => cast}})
      |> Repo.insert(
        on_conflict: {:replace, [:payload, :updated_at]},
        conflict_target: [:group, :name]
      )
      |> case do
        {:ok, _setting} -> {:ok, cast}
        {:error, changeset} -> {:error, changeset}
      end
    end
  end

  defp stored_value(group, name) do
    query = from(s in Setting, where: s.group == ^group and s.name == ^name)

    case Repo.one(query) do
      %Setting{payload: %{"value" => value}} -> {:ok, value}
      _ -> :missing
    end
  end

  defp fetch_group(group), do: Map.fetch(@groups, group) |> ok_or_error()

  defp fetch_group_or(group, error) do
    case fetch_group(group) do
      {:ok, module} -> {:ok, module}
      :error -> {:error, error}
    end
  end

  defp fetch_default_or(module, name, error) do
    case Map.fetch(module.defaults(), name) do
      {:ok, default} -> {:ok, default}
      :error -> {:error, error}
    end
  end

  defp cast_or(module, name, value, error) do
    case module.cast(name, value) do
      {:ok, cast} -> {:ok, cast}
      :error -> {:error, error}
    end
  end

  defp ok_or_error({:ok, value}), do: {:ok, value}
  defp ok_or_error(:error), do: :error
end
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `make test ARGS="test/symphony_elixir/settings_test.exs"`
Expected: PASS (6 tests).

- [ ] **Step 8: Add trivial modules to the coverage ignore list**

In `elixir/mix.exs`, inside `test_coverage.ignore_modules`, add (keep alphabetical neighborhood):

```elixir
SymphonyElixir.Settings.Agents,
SymphonyElixir.Settings.Group,
SymphonyElixir.Settings.Setting,
```

- [ ] **Step 9: Commit**

```bash
git add elixir/priv/repo/migrations/20260605000100_create_settings.exs \
  elixir/lib/symphony_elixir/settings* elixir/test/symphony_elixir/settings_test.exs elixir/mix.exs
git commit -m "feat(settings): add spatie-style generic settings store with agents group"
```

### Task 2: Settings API (GET all / PUT group) + availability probe

**Files:**
- Create: `elixir/lib/symphony_elixir/agent_availability.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/settings_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex` (tracker scope)
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/settings_controller_test.exs`
- Test: `elixir/test/symphony_elixir/agent_availability_test.exs`

- [ ] **Step 1: Write the failing controller test**

```elixir
defmodule SymphonyElixirWeb.Tracker.SettingsControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Setting

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    Repo.delete_all(Setting)
    previous = System.get_env(@token_env)
    System.put_env(@token_env, "test-token")
    on_exit(fn -> restore_env(previous) end)
    :ok
  end

  defp restore_env(nil), do: System.delete_env(@token_env)
  defp restore_env(value), do: System.put_env(@token_env, value)

  defp authed_conn do
    build_conn() |> put_req_header("authorization", "Bearer test-token")
  end

  test "GET /api/tracker/v1/settings returns all groups with defaults" do
    conn = get(authed_conn(), "/api/tracker/v1/settings")

    assert %{"data" => %{"agents" => %{"default_agent_kind" => "codex"}}} = json_response(conn, 200)
  end

  test "PUT /api/tracker/v1/settings/agents updates and echoes the group" do
    conn = put(authed_conn(), "/api/tracker/v1/settings/agents", %{"default_agent_kind" => "claude"})

    assert %{"data" => %{"default_agent_kind" => "claude"}} = json_response(conn, 200)

    conn = get(authed_conn(), "/api/tracker/v1/settings")
    assert %{"data" => %{"agents" => %{"default_agent_kind" => "claude"}}} = json_response(conn, 200)
  end

  test "PUT rejects invalid values with 422 and unknown groups with 404" do
    conn = put(authed_conn(), "/api/tracker/v1/settings/agents", %{"default_agent_kind" => "gemini"})
    assert %{"error" => %{"code" => "validation_error"}} = json_response(conn, 422)

    conn = put(authed_conn(), "/api/tracker/v1/settings/nope", %{"x" => 1})
    assert json_response(conn, 404)
  end

  test "requests without the bearer token are unauthorized" do
    conn = get(build_conn(), "/api/tracker/v1/settings")
    assert json_response(conn, 401)
  end

  test "GET /api/tracker/v1/settings/agents/availability reports both agents" do
    conn = get(authed_conn(), "/api/tracker/v1/settings/agents/availability")

    assert %{"data" => %{"codex" => codex, "claude" => claude}} = json_response(conn, 200)
    assert is_boolean(codex["available"]) and is_boolean(claude["available"])
    assert Map.has_key?(codex, "version") and Map.has_key?(codex, "command")
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test ARGS="test/symphony_elixir_web/controllers/tracker/settings_controller_test.exs"`
Expected: FAIL — no route / module undefined.

- [ ] **Step 3: Write the failing availability test**

```elixir
defmodule SymphonyElixir.AgentAvailabilityTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentAvailability

  setup do
    AgentAvailability.invalidate_cache()
    :ok
  end

  test "probe reports available=true with a version for a real binary" do
    # `sh` exists on every CI/dev host; "--version"-less binaries still count as available.
    result = AgentAvailability.probe_command("sh", cache: false)

    assert result.available == true
    assert result.command == "sh"
  end

  test "probe reports available=false for a missing binary" do
    result = AgentAvailability.probe_command("definitely-not-a-real-binary-xyz", cache: false)

    assert result == %{available: false, version: nil, command: "definitely-not-a-real-binary-xyz"}
  end

  test "probe/0 keys results by agent kind and caches them" do
    assert %{codex: %{available: _}, claude: %{available: _}} = AgentAvailability.probe()
    assert %{codex: _} = AgentAvailability.probe()
  end
end
```

- [ ] **Step 4: Implement `AgentAvailability`**

`elixir/lib/symphony_elixir/agent_availability.ex`:

```elixir
defmodule SymphonyElixir.AgentAvailability do
  @moduledoc """
  Probes whether the codex/claude CLI binaries are present, with a short
  cache so the Settings page can poll cheaply. The probed binary is the
  first word of the configured command.
  """

  alias SymphonyElixir.InstanceConfig

  @cache_key {__MODULE__, :cache}
  @cache_ttl_ms 60_000

  @type result :: %{available: boolean(), version: String.t() | nil, command: String.t()}

  @spec probe() :: %{codex: result(), claude: result()}
  def probe do
    case cached() do
      {:ok, value} ->
        value

      :miss ->
        value = %{
          codex: probe_command(InstanceConfig.codex_command(), cache: false),
          claude: probe_command(InstanceConfig.claude_command(), cache: false)
        }

        :persistent_term.put(@cache_key, {value, now_ms()})
        value
    end
  end

  @spec probe_command(String.t(), keyword()) :: result()
  def probe_command(command, _opts \\ []) when is_binary(command) do
    binary = command |> String.split(" ", trim: true) |> List.first() || command

    case System.find_executable(binary) do
      nil ->
        %{available: false, version: nil, command: binary}

      path ->
        %{available: true, version: read_version(path), command: binary}
    end
  end

  @spec invalidate_cache() :: :ok
  def invalidate_cache do
    :persistent_term.erase(@cache_key)
    :ok
  end

  defp read_version(path) do
    case System.cmd(path, ["--version"], stderr_to_stdout: true) do
      {output, 0} -> output |> String.split("\n", trim: true) |> List.first()
      _ -> nil
    end
  rescue
    _ -> nil
  end

  defp cached do
    case :persistent_term.get(@cache_key, :miss) do
      {value, at} -> if now_ms() - at < @cache_ttl_ms, do: {:ok, value}, else: :miss
      :miss -> :miss
    end
  end

  defp now_ms, do: System.monotonic_time(:millisecond)
end
```

- [ ] **Step 5: Implement the controller**

`elixir/lib/symphony_elixir_web/controllers/tracker/settings_controller.ex`:

```elixir
defmodule SymphonyElixirWeb.Tracker.SettingsController do
  @moduledoc "Operator settings (spatie-style groups) + agent availability probe."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.AgentAvailability
  alias SymphonyElixir.Settings
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params), do: json(conn, %{data: Settings.all()})

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"group" => group} = params) do
    attrs = Map.drop(params, ["group"])

    case put_all(group, attrs) do
      :ok ->
        json(conn, %{data: Settings.get_group(group)})

      {:error, :unknown_group} ->
        conn |> Conn.put_status(:not_found) |> json(%{error: %{code: "not_found", message: "unknown settings group"}})

      {:error, name, reason} ->
        TrackerErrors.validation(conn, "invalid setting #{name}: #{reason}")
    end
  end

  @spec availability(Conn.t(), map()) :: Conn.t()
  def availability(conn, _params) do
    json(conn, %{data: AgentAvailability.probe()})
  end

  defp put_all(group, attrs) do
    Enum.reduce_while(attrs, :ok, fn {name, value}, :ok ->
      case Settings.put(group, name, value) do
        {:ok, _} -> {:cont, :ok}
        {:error, :unknown_group} -> {:halt, {:error, :unknown_group}}
        {:error, reason} -> {:halt, {:error, name, reason}}
      end
    end)
  end
end
```

Note: confirm `TrackerErrors.validation/2` renders `%{error: %{code: "validation_error"}}` with 422 (it is used the same way in `assistant_controller.ex`); if the code key differs, match the test to the real value.

- [ ] **Step 6: Add routes**

In `elixir/lib/symphony_elixir_web/router.ex`, inside `scope "/api/tracker/v1"`, add these three lines together right under the viewer route:

```elixir
get("/settings", SettingsController, :index)
put("/settings/:group", SettingsController, :update)
get("/settings/agents/availability", SettingsController, :availability)
```

- [ ] **Step 7: Run both tests**

Run: `make test ARGS="test/symphony_elixir_web/controllers/tracker/settings_controller_test.exs test/symphony_elixir/agent_availability_test.exs"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add elixir/lib/symphony_elixir/agent_availability.ex \
  elixir/lib/symphony_elixir_web/controllers/tracker/settings_controller.ex \
  elixir/lib/symphony_elixir_web/router.ex elixir/test
git commit -m "feat(settings): settings API + agent availability probe endpoint"
```

### Task 3: `AgentPreference.resolve/3` + label-only helper in `AgentRouting`

**Files:**
- Create: `elixir/lib/symphony_elixir/agent_preference.ex`
- Modify: `elixir/lib/symphony_elixir/agent_routing.ex` (add `label_agent_kind/1`, label-only `routable?/1`)
- Test: `elixir/test/symphony_elixir/agent_preference_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.AgentPreferenceTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentPreference
  alias SymphonyElixir.AgentRouting
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(Setting)
    :ok
  end

  describe "resolve/3 chain" do
    test "task label wins over project and user" do
      assert AgentPreference.resolve(["symphony:claude"], "codex", "codex") == "claude"
      assert AgentPreference.resolve(["Symphony:Codex"], "claude", "claude") == "codex"
    end

    test "project explicit wins over user when no task label" do
      assert AgentPreference.resolve(["symphony"], "claude", "codex") == "claude"
      assert AgentPreference.resolve([], "codex", "claude") == "codex"
    end

    test "user default applies when task and project are silent" do
      assert AgentPreference.resolve([], nil, "claude") == "claude"
    end

    test "falls back to codex when everything is silent or invalid" do
      assert AgentPreference.resolve([], nil, nil) == "codex"
      assert AgentPreference.resolve([], "gemini", "gemini") == "codex"
    end

    test "resolve/2 reads the user default from Settings" do
      {:ok, _} = Settings.put("agents", "default_agent_kind", "claude")
      assert AgentPreference.resolve([], nil) == "claude"
    end
  end

  describe "AgentRouting.label_agent_kind/1" do
    test "returns the explicit agent label kind, nil otherwise" do
      assert AgentRouting.label_agent_kind(["bug", "symphony:claude"]) == "claude"
      assert AgentRouting.label_agent_kind(["symphony:codex"]) == "codex"
      assert AgentRouting.label_agent_kind(["symphony"]) == nil
      assert AgentRouting.label_agent_kind([]) == nil
    end
  end

  describe "AgentRouting.routable?/1 (admission no longer gates on configured kinds)" do
    test "any admission label routes" do
      assert AgentRouting.routable?(["symphony"])
      assert AgentRouting.routable?(["symphony:claude"])
      refute AgentRouting.routable?(["bug"])
    end
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test ARGS="test/symphony_elixir/agent_preference_test.exs"`
Expected: FAIL — `AgentPreference` undefined / `label_agent_kind` undefined.

- [ ] **Step 3: Add the helpers to `AgentRouting`**

In `elixir/lib/symphony_elixir/agent_routing.ex`, after `resolve_agent_kind/3` add:

```elixir
@doc "Explicit per-task agent from labels (`symphony:codex|claude`); plain `symphony` is no preference."
@spec label_agent_kind([String.t()]) :: String.t() | nil
def label_agent_kind(label_names) when is_list(label_names) do
  normalized = label_names |> Enum.map(&normalize_label/1) |> Enum.reject(&(&1 == ""))

  cond do
    @label_claude in normalized -> "claude"
    @label_codex in normalized -> "codex"
    true -> nil
  end
end

@doc "Admission check by labels alone — agent availability no longer gates admission."
@spec routable?([String.t()]) :: boolean()
def routable?(label_names) when is_list(label_names) do
  normalized = label_names |> Enum.map(&normalize_label/1)
  Enum.any?(admission_labels(), &(&1 in normalized))
end
```

Keep the existing `resolve_agent_kind/3` and `routable?/3` working (callers migrate in Task 4); `routable?/1` is a new arity, not a replacement.

- [ ] **Step 4: Create `AgentPreference`**

`elixir/lib/symphony_elixir/agent_preference.ex`:

```elixir
defmodule SymphonyElixir.AgentPreference do
  @moduledoc """
  Resolves the effective coding agent with the chain
  task label > project explicit > user default > "codex".

  Task signal comes from `symphony:<kind>` labels; project signal from
  `agent.kind` in the project's workflow_markdown front matter (nil =
  inherit); user signal from the spatie-style settings store.
  """

  alias SymphonyElixir.AgentRouting
  alias SymphonyElixir.Settings

  @fallback "codex"
  @valid_kinds ["codex", "claude"]

  @spec valid_kinds() :: [String.t()]
  def valid_kinds, do: @valid_kinds

  @spec resolve([String.t()], String.t() | nil) :: String.t()
  def resolve(label_names, project_agent_kind) do
    resolve(label_names, project_agent_kind, Settings.Agents.default_agent_kind())
  end

  @spec resolve([String.t()], String.t() | nil, String.t() | nil) :: String.t()
  def resolve(label_names, project_agent_kind, user_default) when is_list(label_names) do
    AgentRouting.label_agent_kind(label_names) ||
      normalize(project_agent_kind) ||
      normalize(user_default) ||
      @fallback
  end

  @spec normalize(term()) :: String.t() | nil
  def normalize(kind) when kind in @valid_kinds, do: kind
  def normalize(_kind), do: nil
end
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `make test ARGS="test/symphony_elixir/agent_preference_test.exs"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/agent_preference.ex elixir/lib/symphony_elixir/agent_routing.ex \
  elixir/test/symphony_elixir/agent_preference_test.exs
git commit -m "feat(agents): AgentPreference chain (task > project > user > codex)"
```

### Task 4: Front-matter `agent.kind` precedence + nil-able project agent

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex` — `agent_kind_from_config/1` (line ~509)
- Test: extend the existing config test file that covers `agent_kind_from_config` (find with `grep -rn "agent_kind_from_config" elixir/test`), or create `elixir/test/symphony_elixir/config_agent_kind_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.ConfigAgentKindTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Config

  test "explicit agent.kind wins over section inference" do
    assert Config.agent_kind_from_config(%{"agent" => %{"kind" => "claude"}, "codex" => %{}}) == "claude"
    assert Config.agent_kind_from_config(%{"agent" => %{"kind" => "codex"}, "claude" => %{}}) == "codex"
  end

  test "exactly one agent section infers that kind (compat)" do
    assert Config.agent_kind_from_config(%{"codex" => %{"command" => "codex app-server"}}) == "codex"
    assert Config.agent_kind_from_config(%{"claude" => %{}}) == "claude"
  end

  test "no section and no explicit kind means inherit (nil)" do
    assert Config.agent_kind_from_config(%{}) == nil
    assert Config.agent_kind_from_config(%{"agent" => %{"max_turns" => 5}}) == nil
  end

  test "both sections without explicit kind means inherit (nil)" do
    assert Config.agent_kind_from_config(%{"codex" => %{}, "claude" => %{}}) == nil
  end

  test "invalid explicit kind is ignored" do
    assert Config.agent_kind_from_config(%{"agent" => %{"kind" => "gemini"}}) == nil
    assert Config.agent_kind_from_config(%{"agent" => %{"kind" => "gemini"}, "codex" => %{}}) == "codex"
  end

  test "non-map input means inherit" do
    assert Config.agent_kind_from_config(nil) == nil
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test ARGS="test/symphony_elixir/config_agent_kind_test.exs"`
Expected: FAIL — today `%{}` returns `"codex"` (instance default), both-sections returns `"codex"`.

- [ ] **Step 3: Rewrite `agent_kind_from_config/1`**

Replace the current implementation in `elixir/lib/symphony_elixir/config.ex` (keep `@agent_sections`, `normalize_keys/1` as-is):

```elixir
@doc """
Resolves the agent kind from a project's own front-matter map.

Precedence: explicit `agent.kind` > exactly-one-section inference
(`codex:`/`claude:`) > nil (= inherit; resolved later by
`SymphonyElixir.AgentPreference`).
"""
@spec agent_kind_from_config(map() | term()) :: String.t() | nil
def agent_kind_from_config(front_matter) when is_map(front_matter) do
  normalized = normalize_keys(front_matter)

  explicit_agent_kind(normalized) ||
    case Enum.filter(@agent_sections, &Map.has_key?(normalized, &1)) do
      [single] -> single
      _ -> nil
    end
end

def agent_kind_from_config(_front_matter), do: nil

defp explicit_agent_kind(normalized) do
  case Map.get(normalized, "agent") do
    %{} = section ->
      section
      |> Map.new(fn {key, value} -> {to_string(key), value} end)
      |> Map.get("kind")
      |> SymphonyElixir.AgentPreference.normalize()

    _ ->
      nil
  end
end
```

- [ ] **Step 4: Fix the ripple at the two callers that assumed a binary**

1. `Config.agent_kind/0` currently delegates to `default_agent_kind/0` — leave it.
2. `grep -rn "agent_kind_from_config" elixir/lib elixir/test` — for any OTHER caller that pattern-matches a binary, wrap with `|| Config.default_agent_kind()` ONLY if it is not one of the call sites Task 5 migrates (`ProjectConfig.resolve/1` keeps the raw nil — that is the point). Existing tests asserting the old both-sections/none behavior must be updated to the new table above.

- [ ] **Step 5: Run the focused test, then the full config + project-config suites**

Run: `make test ARGS="test/symphony_elixir/config_agent_kind_test.exs"`
Expected: PASS.
Run: `make test ARGS="$(cd elixir && ls test/symphony_elixir/config*_test.exs test/symphony_elixir/project_config_test.exs 2>/dev/null | tr '\n' ' ')"`
Expected: PASS after updating stale assertions (the project-config test may assert `agent_kind == "codex"` for sectionless front matter — change those expectations to `nil`).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/config.ex elixir/test
git commit -m "feat(config): agent.kind explicit > single-section inference > inherit(nil)"
```

### Task 5: Wire the chain — `AgentRunner`, `IssueMapper`, GitHub client, form options

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex` — `issue_agent_kind/1`
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_mapper.ex` — label-only `agent_kind`
- Modify: `elixir/lib/symphony_elixir/github/client.ex` — same label-only change + admission via `routable?/1`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex` — `agent_options/0` → effective agent
- Test: `elixir/test/symphony_elixir/agent_runner_agent_kind_test.exs` (new) + update existing mapper/client/controller tests

- [ ] **Step 1: Write the failing resolution test**

```elixir
defmodule SymphonyElixir.AgentRunnerAgentKindTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentRunner
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(Setting)
    {:ok, project} = Context.ensure_project(%{name: "Pref", slug: "pref"})

    {:ok, _} =
      Context.update_setup("pref", %{
        workflow_markdown: """
        ---
        agent:
          kind: claude
        ---
        Prompt body.
        """
      })

    {:ok, project: project}
  end

  test "issue label beats the project's explicit agent.kind" do
    issue = %Issue{id: "1", identifier: "PREF-1", project_slug: "pref", agent_kind: "codex"}
    assert AgentRunner.issue_agent_kind(issue) == "codex"
  end

  test "project explicit agent.kind beats the user default" do
    {:ok, _} = Settings.put("agents", "default_agent_kind", "codex")
    issue = %Issue{id: "1", identifier: "PREF-1", project_slug: "pref", agent_kind: nil}
    assert AgentRunner.issue_agent_kind(issue) == "claude"
  end

  test "user default applies when the project inherits" do
    {:ok, _} = Context.update_setup("pref", %{workflow_markdown: "---\n---\nPrompt body."})
    {:ok, _} = Settings.put("agents", "default_agent_kind", "claude")

    issue = %Issue{id: "1", identifier: "PREF-1", project_slug: "pref", agent_kind: nil}
    assert AgentRunner.issue_agent_kind(issue) == "claude"
  end

  test "unknown project falls back to user default then codex" do
    issue = %Issue{id: "1", identifier: "X-1", project_slug: "missing", agent_kind: nil}
    assert AgentRunner.issue_agent_kind(issue) == "codex"
  end
end
```

Note: if `Context.update_setup/2` has a different name/signature, find the real setup-update function with `grep -n "def update_setup\|def upsert_setup" elixir/lib/symphony_elixir/local_tracker/context.ex` and use it; the assertion logic stays the same.

- [ ] **Step 2: Run it to verify it fails**

Run: `make test ARGS="test/symphony_elixir/agent_runner_agent_kind_test.exs"`
Expected: FAIL — today project-level `agent_kind` is never nil so the user-default case can't pass (and `%{}` front matter resolves "codex" ignoring settings).

- [ ] **Step 3: Rewrite `issue_agent_kind/1` in `agent_runner.ex`**

```elixir
@spec issue_agent_kind(SymphonyElixir.Issue.t()) :: String.t()
def issue_agent_kind(%Issue{} = issue) do
  task_kind = AgentPreference.normalize(issue.agent_kind)
  AgentPreference.resolve(task_labels(task_kind), project_agent_kind(issue))
end

def issue_agent_kind(_issue), do: AgentPreference.resolve([], nil)

defp task_labels(nil), do: []
defp task_labels(kind), do: ["symphony:" <> kind]

defp project_agent_kind(%Issue{project_slug: slug}) when is_binary(slug) and slug != "" do
  case Context.get_project(slug) do
    {:ok, project} ->
      project |> Repo.preload(:setup) |> ProjectConfig.resolve() |> Map.get(:agent_kind)

    {:error, _reason} ->
      nil
  end
end

defp project_agent_kind(_issue), do: nil
```

Add `alias SymphonyElixir.AgentPreference` to the module's aliases.

- [ ] **Step 4: Make `IssueMapper` task-label-only**

In `elixir/lib/symphony_elixir/local_tracker/issue_mapper.ex` replace the `agent_kind` computation:

```elixir
agent_kind = AgentRouting.label_agent_kind(label_names)
```

(Remove the now-unused `Config` from the alias list if nothing else uses it.) `Issue.agent_kind` becomes "explicit task override or nil" — resolution happens in `AgentRunner.issue_agent_kind/1` at dispatch.

- [ ] **Step 5: Same change in the GitHub client**

In `elixir/lib/symphony_elixir/github/client.ex`, find `resolve_issue_agent_kind` (grep). Replace its body to delegate to `AgentRouting.label_agent_kind(label_names)` and replace any admission call of `AgentRouting.routable?(labels, configured, default)` with `AgentRouting.routable?(labels)`. Update the client tests asserting the old admission drop (labeled `symphony:claude` without a `claude:` section must now be ADMITTED with `agent_kind == "claude"`).

- [ ] **Step 6: Effective agent in `form_options`**

In `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex`:

```elixir
# in form_options/2 json data map, add:
effective_agent: effective_agent(project),

# replace agent_options/0 with (no per-option default anymore):
defp agent_options do
  Enum.map(["codex", "claude"], fn kind ->
    %{value: kind, label: Map.fetch!(@agent_labels, kind), default: false}
  end)
end

defp effective_agent(project) do
  project_kind =
    project
    |> SymphonyElixir.Repo.preload(:setup)
    |> SymphonyElixir.ProjectConfig.resolve()
    |> Map.get(:agent_kind)

  SymphonyElixir.AgentPreference.resolve([], project_kind)
end
```

Update the existing `form_options` controller test: assert `data["effective_agent"] in ["codex", "claude"]` and that no agent option has `"default" => true`.

- [ ] **Step 7: Run the touched suites**

Run: `make test ARGS="test/symphony_elixir/agent_runner_agent_kind_test.exs"` → PASS.
Run: `make test` (full backend) → PASS; fix any remaining assertions that relied on baked-in defaults (search failures for `agent_kind`).

- [ ] **Step 8: Commit**

```bash
git add elixir/lib elixir/test
git commit -m "feat(agents): resolve task>project>user chain at dispatch; admission no longer gated by configured kinds"
```

---

## Phase 2 — Settings UI (frontend)

### Task 6: Settings service + page + sidebar entry

**Files:**
- Create: `tracker/src/services/settings.ts`
- Create: `tracker/src/components/shared/AgentChip.tsx` (extracted from IssueCreateDialog)
- Create: `tracker/src/pages/SettingsPage.tsx`
- Modify: `tracker/src/App.tsx` (route), `tracker/src/components/layout/ProjectSidebar.tsx` (nav item)
- Modify: `tracker/src/components/issues/IssueCreateDialog.tsx` (import the shared chip)
- Test: `tracker/src/pages/__tests__/SettingsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "@/pages/SettingsPage";
import * as settingsService from "@/services/settings";

vi.mock("@/services/settings", () => ({
  fetchSettings: vi.fn(),
  updateAgentSettings: vi.fn(),
  fetchAgentAvailability: vi.fn(),
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsService.fetchSettings).mockResolvedValue({
      agents: { default_agent_kind: "codex" },
    });
    vi.mocked(settingsService.fetchAgentAvailability).mockResolvedValue({
      codex: { available: true, version: "codex 3.1.0", command: "codex" },
      claude: { available: false, version: null, command: "claude" },
    });
  });

  it("renders the current default and availability", async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /Codex/ })).toBeTruthy());
    expect(screen.getByText(/codex 3\.1\.0/)).toBeTruthy();
    expect(screen.getByText(/not found/i)).toBeTruthy();
  });

  it("saves a new default agent via PUT", async () => {
    vi.mocked(settingsService.updateAgentSettings).mockResolvedValue({ default_agent_kind: "claude" });

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /Claude/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Claude/ }));

    await waitFor(() =>
      expect(settingsService.updateAgentSettings).toHaveBeenCalledWith({ default_agent_kind: "claude" }),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tracker && npx vitest run src/pages/__tests__/SettingsPage.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the service**

`tracker/src/services/settings.ts`:

```typescript
import { http, trackerPath, unwrapData } from "@/services/http";
import type { AgentKind } from "@/types/issue";

export interface AgentSettings {
  default_agent_kind: AgentKind;
}

export interface AllSettings {
  agents: AgentSettings;
}

export interface AgentAvailabilityEntry {
  available: boolean;
  version: string | null;
  command: string;
}

export interface AgentAvailability {
  codex: AgentAvailabilityEntry;
  claude: AgentAvailabilityEntry;
}

export async function fetchSettings(): Promise<AllSettings> {
  const response = await http.get(trackerPath("/settings"));
  return unwrapData<AllSettings>(response);
}

export async function updateAgentSettings(input: Partial<AgentSettings>): Promise<AgentSettings> {
  const response = await http.put(trackerPath("/settings/agents"), input);
  return unwrapData<AgentSettings>(response);
}

export async function fetchAgentAvailability(): Promise<AgentAvailability> {
  const response = await http.get(trackerPath("/settings/agents/availability"));
  return unwrapData<AgentAvailability>(response);
}
```

- [ ] **Step 4: Extract the shared `AgentChip`**

`tracker/src/components/shared/AgentChip.tsx` — move the `AgentChip` component and the `AGENT_ICONS` map out of `IssueCreateDialog.tsx` verbatim (find both there; the icons import `CodexIcon`/`ClaudeIcon` from their current location) and export them:

```tsx
import type { ReactElement, ReactNode, SVGProps } from "react";

import { CodexIcon } from "@/components/icons/CodexIcon";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { cn } from "@/lib/utils";
import type { AgentKind } from "@/types/issue";

// NOTE: adjust the two icon import paths to wherever IssueCreateDialog imports them from today.

export const AGENT_ICONS: Record<AgentKind, (props: SVGProps<SVGSVGElement>) => ReactElement> = {
  codex: CodexIcon,
  claude: ClaudeIcon,
};

export function AgentChip({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
```

If `IssueCreateDialog.tsx` already has its own styled chip, copy THAT body instead of the classNames above — visual parity matters more than this snippet. Then update `IssueCreateDialog.tsx` to `import { AGENT_ICONS, AgentChip } from "@/components/shared/AgentChip";` and delete its local copies.

- [ ] **Step 5: Implement the page**

`tracker/src/pages/SettingsPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AGENT_ICONS, AgentChip } from "@/components/shared/AgentChip";
import {
  AgentAvailability,
  fetchAgentAvailability,
  fetchSettings,
  updateAgentSettings,
} from "@/services/settings";
import type { AgentKind } from "@/types/issue";

const AGENT_LABELS: Record<AgentKind, string> = { codex: "Codex", claude: "Claude Code" };

export function SettingsPage() {
  const [defaultAgent, setDefaultAgent] = useState<AgentKind | null>(null);
  const [availability, setAvailability] = useState<AgentAvailability | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchSettings().then((settings) => {
      if (!cancelled) setDefaultAgent(settings.agents.default_agent_kind);
    });
    void fetchAgentAvailability().then((result) => {
      if (!cancelled) setAvailability(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function selectAgent(kind: AgentKind) {
    if (saving || kind === defaultAgent) return;
    setSaving(true);
    const previous = defaultAgent;
    setDefaultAgent(kind);
    try {
      await updateAgentSettings({ default_agent_kind: kind });
      toast.success(`Default coding agent set to ${AGENT_LABELS[kind]}`);
    } catch {
      setDefaultAgent(previous);
      toast.error("Failed to save the default coding agent");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Operator-level defaults for this Symphony instance.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coding agent</CardTitle>
          <CardDescription>
            Default agent for new work. Projects and tasks can override it (task &gt; project &gt; this default).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(AGENT_LABELS) as AgentKind[]).map((kind) => {
              const Icon = AGENT_ICONS[kind];
              return (
                <AgentChip
                  key={kind}
                  label={AGENT_LABELS[kind]}
                  icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined}
                  active={defaultAgent === kind}
                  disabled={saving || defaultAgent === null}
                  onClick={() => void selectAgent(kind)}
                />
              );
            })}
          </div>

          {availability ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {(Object.keys(AGENT_LABELS) as AgentKind[]).map((kind) => {
                const entry = availability[kind];
                return (
                  <li key={kind}>
                    {entry.available
                      ? `✓ ${entry.version ?? entry.command}`
                      : `✗ ${entry.command} not found — install it or pick the other agent`}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Route + sidebar**

In `tracker/src/App.tsx` add, next to the `observability`/`backups` routes:

```tsx
<Route path="settings" element={<SettingsPage />} />
```

(plus `import { SettingsPage } from "@/pages/SettingsPage";`). In `tracker/src/components/layout/ProjectSidebar.tsx`, add `Settings` to the lucide import and a NavLink below Backups, same classes as the Backups block:

```tsx
<NavLink
  to="/settings"
  className={({ isActive }) =>
    cn(
      "mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
      isActive && "bg-accent text-foreground",
    )
  }
>
  <Settings className="h-4 w-4" />
  Settings
</NavLink>
```

- [ ] **Step 7: Run tests + lint**

Run: `cd tracker && npx vitest run src/pages/__tests__/SettingsPage.test.tsx` → PASS.
Run: `cd tracker && npm run lint && npx vitest run` → PASS (existing IssueCreateDialog tests must still pass after the chip extraction).

- [ ] **Step 8: Commit**

```bash
git add tracker/src
git commit -m "feat(tracker): Settings page with default coding agent + availability"
```

---

## Phase 3 — Project & task surfaces (frontend + small backend)

### Task 7: Front-matter `agent.kind` text manipulation library

**Files:**
- Create: `tracker/src/lib/workflowFrontMatter.ts`
- Test: `tracker/src/lib/__tests__/workflowFrontMatter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";

import { readAgentKind, writeAgentKind } from "@/lib/workflowFrontMatter";

const BASE = `---
tracker:
  active_states:
    - Todo
agent:
  max_turns: 20
---

Prompt body.
`;

describe("readAgentKind", () => {
  it("returns null when agent.kind is absent", () => {
    expect(readAgentKind(BASE)).toBeNull();
    expect(readAgentKind("no front matter at all")).toBeNull();
    expect(readAgentKind("")).toBeNull();
  });

  it("reads an explicit kind", () => {
    const md = writeAgentKind(BASE, "claude");
    expect(readAgentKind(md)).toBe("claude");
  });
});

describe("writeAgentKind", () => {
  it("adds kind inside an existing agent section, preserving siblings", () => {
    const md = writeAgentKind(BASE, "claude");
    expect(md).toContain("agent:\n  kind: claude\n  max_turns: 20");
    expect(md).toContain("Prompt body.");
  });

  it("creates the agent section when missing", () => {
    const md = writeAgentKind("---\ntracker:\n  active_states: []\n---\nBody.", "codex");
    expect(md).toContain("agent:\n  kind: codex");
    expect(readAgentKind(md)).toBe("codex");
  });

  it("updates an existing kind in place", () => {
    const withClaude = writeAgentKind(BASE, "claude");
    const withCodex = writeAgentKind(withClaude, "codex");
    expect(readAgentKind(withCodex)).toBe("codex");
    expect(withCodex.match(/kind:/g)).toHaveLength(1);
  });

  it("removes the kind line when set to null, keeping other agent keys", () => {
    const withClaude = writeAgentKind(BASE, "claude");
    const cleared = writeAgentKind(withClaude, null);
    expect(readAgentKind(cleared)).toBeNull();
    expect(cleared).toContain("max_turns: 20");
  });

  it("removes the whole agent section when kind was its only key", () => {
    const md = writeAgentKind("---\ntracker:\n  active_states: []\n---\nBody.", "codex");
    const cleared = writeAgentKind(md, null);
    expect(cleared).not.toContain("agent:");
  });

  it("creates front matter when the document has none", () => {
    const md = writeAgentKind("Just a prompt.", "claude");
    expect(md.startsWith("---\nagent:\n  kind: claude\n---\n")).toBe(true);
    expect(md).toContain("Just a prompt.");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tracker && npx vitest run src/lib/__tests__/workflowFrontMatter.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement (line-based, no YAML re-serialization)**

`tracker/src/lib/workflowFrontMatter.ts`:

```typescript
import type { AgentKind } from "@/types/issue";

const KINDS: readonly string[] = ["codex", "claude"];

interface FrontMatterSplit {
  lines: string[]; // front-matter lines, without the --- fences
  body: string; // everything after the closing fence (includes leading newline content)
  had: boolean;
}

function split(markdown: string): FrontMatterSplit {
  const text = markdown ?? "";
  if (!text.startsWith("---")) return { lines: [], body: text, had: false };

  const end = text.indexOf("\n---", 3);
  if (end === -1) return { lines: [], body: text, had: false };

  const inner = text.slice(text.indexOf("\n") + 1, end);
  const body = text.slice(end + "\n---".length).replace(/^\n/, "");
  return { lines: inner.length > 0 ? inner.split("\n") : [], body, had: true };
}

function join(lines: string[], body: string): string {
  const fm = lines.length > 0 ? `---\n${lines.join("\n")}\n---\n` : "";
  return `${fm}${body.startsWith("\n") || body === "" ? body : `\n${body}`}`.replace(/^---\n\n/, "---\n");
}

/** Locates the `agent:` top-level section. Returns [start, endExclusive] of its lines, or null. */
function agentSection(lines: string[]): [number, number] | null {
  const start = lines.findIndex((line) => /^agent:\s*$/.test(line) || /^agent:\s+#/.test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && (/^\s+\S/.test(lines[end]) || lines[end].trim() === "")) end += 1;
  return [start, end];
}

export function readAgentKind(markdown: string): AgentKind | null {
  const { lines } = split(markdown);
  const section = agentSection(lines);
  if (!section) return null;

  for (let i = section[0] + 1; i < section[1]; i += 1) {
    const match = lines[i].match(/^\s+kind:\s*["']?([\w-]+)["']?\s*(#.*)?$/);
    if (match) return KINDS.includes(match[1]) ? (match[1] as AgentKind) : null;
  }
  return null;
}

export function writeAgentKind(markdown: string, kind: AgentKind | null): string {
  const { lines, body } = split(markdown);
  const section = agentSection(lines);

  if (kind === null) {
    if (!section) return markdown;
    const inner = lines.slice(section[0] + 1, section[1]).filter((l) => !/^\s+kind:/.test(l));
    const next = [...lines.slice(0, section[0])];
    if (inner.some((l) => l.trim() !== "")) next.push(lines[section[0]], ...inner);
    next.push(...lines.slice(section[1]));
    return join(next, body);
  }

  if (!section) {
    return join([...lines, "agent:", `  kind: ${kind}`], body);
  }

  const inner = lines.slice(section[0] + 1, section[1]);
  const kindIndex = inner.findIndex((l) => /^\s+kind:/.test(l));
  const nextInner =
    kindIndex >= 0
      ? inner.map((l, i) => (i === kindIndex ? `  kind: ${kind}` : l))
      : [`  kind: ${kind}`, ...inner];

  const next = [...lines.slice(0, section[0]), lines[section[0]], ...nextInner, ...lines.slice(section[1])];
  return join(next, body);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tracker && npx vitest run src/lib/__tests__/workflowFrontMatter.test.ts`
Expected: PASS. If an assertion about exact spacing fails, fix the IMPLEMENTATION (tests define the contract: 2-space indent, section appended at front-matter end when created).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/lib/workflowFrontMatter.ts tracker/src/lib/__tests__/workflowFrontMatter.test.ts
git commit -m "feat(tracker): front-matter agent.kind read/write helpers"
```

### Task 8: Project agent picker (config editor + creation wizard)

**Files:**
- Modify: `tracker/src/components/projects/ProjectConfigEditor.tsx`
- Modify: `tracker/src/components/projects/ProjectWorkspaceWizard.tsx`
- Test: `tracker/src/components/projects/__tests__/ProjectAgentSelect.test.tsx`

- [ ] **Step 1: Write the failing test for the select component**

Create the select as a small reusable component inside the editor file's folder so it is testable. Test:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectAgentSelect } from "@/components/projects/ProjectAgentSelect";

describe("ProjectAgentSelect", () => {
  it("shows Inherit with the effective agent and fires null", () => {
    const onChange = vi.fn();
    render(<ProjectAgentSelect value="claude" effectiveDefault="codex" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Inherit \(Codex\)/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("fires the explicit kind", () => {
    const onChange = vi.fn();
    render(<ProjectAgentSelect value={null} effectiveDefault="codex" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Claude Code" }));
    expect(onChange).toHaveBeenCalledWith("claude");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tracker && npx vitest run src/components/projects/__tests__/ProjectAgentSelect.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement `ProjectAgentSelect`**

`tracker/src/components/projects/ProjectAgentSelect.tsx`:

```tsx
import { AGENT_ICONS, AgentChip } from "@/components/shared/AgentChip";
import type { AgentKind } from "@/types/issue";

const LABELS: Record<AgentKind, string> = { codex: "Codex", claude: "Claude Code" };

export function ProjectAgentSelect({
  value,
  effectiveDefault,
  onChange,
  disabled,
}: {
  value: AgentKind | null;
  effectiveDefault: AgentKind;
  onChange: (kind: AgentKind | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">Coding agent</span>
      <div className="flex flex-wrap gap-1.5">
        <AgentChip
          label={`Inherit (${LABELS[effectiveDefault]})`}
          active={value === null}
          disabled={disabled}
          onClick={() => onChange(null)}
        />
        {(Object.keys(LABELS) as AgentKind[]).map((kind) => {
          const Icon = AGENT_ICONS[kind];
          return (
            <AgentChip
              key={kind}
              label={LABELS[kind]}
              icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined}
              active={value === kind}
              disabled={disabled}
              onClick={() => onChange(kind)}
            />
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Inherit follows the user default from Settings; explicit choices write{" "}
        <code>agent.kind</code> into the workflow front matter.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Wire it into `ProjectConfigEditor` (Workflow tab)**

In `ProjectConfigEditor.tsx`:

1. Imports: `ProjectAgentSelect`, `readAgentKind`, `writeAgentKind`, `fetchSettings`.
2. State: `const [userDefaultAgent, setUserDefaultAgent] = useState<AgentKind>("codex");` and an effect `useEffect(() => { void fetchSettings().then((s) => setUserDefaultAgent(s.agents.default_agent_kind)); }, []);`
3. In the Workflow tab JSX, directly ABOVE `<WorkflowMarkdownEditor ...>`:

```tsx
<ProjectAgentSelect
  value={readAgentKind(workflowMarkdown)}
  effectiveDefault={userDefaultAgent}
  onChange={(kind) => setWorkflowMarkdown((current) => writeAgentKind(current, kind))}
/>
```

The picker is a pure view over the markdown buffer — Save persists `workflowMarkdown` exactly as today (`handleSave` untouched).

- [ ] **Step 5: Wire it into the creation wizard**

In `ProjectWorkspaceWizard.tsx`:

1. Same `userDefaultAgent` state + fetch effect as above.
2. State: `const [projectAgent, setProjectAgent] = useState<AgentKind | null>(null);` (null = inherit, the default for new projects per spec).
3. Render `<ProjectAgentSelect value={projectAgent} effectiveDefault={userDefaultAgent} onChange={setProjectAgent} />` in the setup/review step (next to where `workflowMarkdown` from the suggestion is shown).
4. At submit, where `createWorkspaceProject({ ..., setup: { workflowMarkdown, ... } })` is called, pass:

```tsx
workflowMarkdown: projectAgent ? writeAgentKind(workflowMarkdown ?? "", projectAgent) : workflowMarkdown,
```

- [ ] **Step 6: Run tests + full frontend suite**

Run: `cd tracker && npx vitest run src/components/projects/__tests__/ProjectAgentSelect.test.tsx` → PASS.
Run: `cd tracker && npm run lint && npx vitest run` → PASS.

- [ ] **Step 7: Commit**

```bash
git add tracker/src
git commit -m "feat(tracker): project-level agent picker writing agent.kind front matter"
```

### Task 9: Task surfaces — inherit chip in IssueCreateDialog + agent change on existing issues

**Files:**
- Modify: `tracker/src/components/issues/IssueCreateDialog.tsx`
- Modify: `tracker/src/types/issue.ts` (`IssueFormOptions.effectiveAgent`)
- Modify: `tracker/src/services/issues.ts` (normalize `effective_agent`, add `updateIssueAgent`)
- Modify: `tracker/src/components/issues/issue-detail/AgentTab.tsx`
- Modify (backend): `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex` + `elixir/lib/symphony_elixir/local_tracker/context.ex` — accept `"agent"` on issue update
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/issue_agent_update_test.exs`

- [ ] **Step 1: Write the failing backend test (agent change on existing issue)**

```elixir
defmodule SymphonyElixirWeb.Tracker.IssueAgentUpdateTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    previous = System.get_env(@token_env)
    System.put_env(@token_env, "test-token")
    on_exit(fn -> if previous, do: System.put_env(@token_env, previous), else: System.delete_env(@token_env) end)

    {:ok, _project} = Context.ensure_project(%{name: "Pref", slug: "pref"})
    {:ok, issue} = Context.create_issue("pref", %{"title" => "Switchable", "status" => "Todo"})
    {:ok, issue: issue}
  end

  defp authed_conn, do: build_conn() |> put_req_header("authorization", "Bearer test-token")

  test "PUT issues/:identifier with agent writes the symphony:<kind> label", %{issue: issue} do
    conn = put(authed_conn(), "/api/tracker/v1/projects/pref/issues/#{issue.identifier}", %{"agent" => "claude"})

    assert %{"data" => _} = json_response(conn, 200)

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert "symphony:claude" in label_names(updated)

    conn = put(authed_conn(), "/api/tracker/v1/projects/pref/issues/#{issue.identifier}", %{"agent" => "codex"})
    assert json_response(conn, 200)

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert "symphony:codex" in label_names(updated)
    refute "symphony:claude" in label_names(updated)
  end

  test "agent: null clears the routing label back to inherit", %{issue: issue} do
    put(authed_conn(), "/api/tracker/v1/projects/pref/issues/#{issue.identifier}", %{"agent" => "claude"})
    conn = put(authed_conn(), "/api/tracker/v1/projects/pref/issues/#{issue.identifier}", %{"agent" => nil})

    assert json_response(conn, 200)
    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    refute Enum.any?(label_names(updated), &String.starts_with?(&1, "symphony:"))
  end

  defp label_names(issue) do
    issue |> SymphonyElixir.Repo.preload(:labels) |> Map.get(:labels) |> Enum.map(& &1.name)
  end
end
```

Adjust `Context.create_issue/2` / `Context.get_issue/2` call shapes to the real signatures (grep `def create_issue`, `def get_issue` in `context.ex`); the assertions are the contract.

- [ ] **Step 2: Run it to verify it fails**

Run: `make test ARGS="test/symphony_elixir_web/controllers/tracker/issue_agent_update_test.exs"`
Expected: FAIL — update path ignores `"agent"` (or only create/move handles it).

- [ ] **Step 3: Backend — route `"agent"` through issue update**

In `context.ex`, the move/dispatch path already calls `replace_agent_routing_label/3` when attrs include `"agent"` (see `sync_agent_routing` area, ~line 1199). Extend the UPDATE path: in the function that applies issue updates (find with `grep -n "def update_issue" elixir/lib/symphony_elixir/local_tracker/context.ex`), after persisting the record, add:

```elixir
defp maybe_sync_agent_label(issue, %{"agent" => agent}, project_id) when agent in ["codex", "claude"] do
  replace_agent_routing_label(issue, project_id, agent)
end

defp maybe_sync_agent_label(issue, %{"agent" => nil}, _project_id) do
  with :ok <- delete_agent_routing_labels(issue.id), do: {:ok, issue}
end

defp maybe_sync_agent_label(issue, _attrs, _project_id), do: {:ok, issue}
```

and call `maybe_sync_agent_label(issue, attrs, project.id)` inside `update_issue` before returning. In `issue_controller.ex`'s update action, allow `"agent"` through the permitted params (mirror how create permits it).

- [ ] **Step 4: Run the backend test**

Run: `make test ARGS="test/symphony_elixir_web/controllers/tracker/issue_agent_update_test.exs"`
Expected: PASS.

- [ ] **Step 5: Frontend — inherit semantics in the create dialog**

In `tracker/src/types/issue.ts` add to `IssueFormOptions`:

```typescript
effectiveAgent: AgentKind;
```

In `tracker/src/services/issues.ts` `normalizeIssueFormOptions`, map `effective_agent` → `effectiveAgent` (default `"codex"` when absent). In `IssueCreateDialog.tsx`:

1. DELETE the auto-select inside the options effect:
```typescript
const defaultAgent = result.agents.find((option) => option.default);
if (defaultAgent) setAgent(defaultAgent.value);
```
2. Replace the None chip label:
```tsx
<AgentChip
  label={`Inherit (${options?.effectiveAgent === "claude" ? "Claude" : "Codex"})`}
  active={agent === ""}
  onClick={() => setAgent("")}
/>
```

- [ ] **Step 6: Frontend — agent chips in the issue drawer Agent tab**

In `AgentTab.tsx`, under the Assignment section, add an "Agent" section. The component receives `issue` and `execution` props already:

```tsx
<section>
  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Agent</div>
  <div className="mt-2 flex flex-wrap gap-1.5">
    <AgentChip
      label="Inherit"
      active={!issue.agentKind}
      disabled={Boolean(execution)}
      onClick={() => void changeAgent(null)}
    />
    {(["codex", "claude"] as AgentKind[]).map((kind) => {
      const Icon = AGENT_ICONS[kind];
      return (
        <AgentChip
          key={kind}
          label={kind === "codex" ? "Codex" : "Claude"}
          icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined}
          active={issue.agentKind === kind}
          disabled={Boolean(execution)}
          onClick={() => void changeAgent(kind)}
        />
      );
    })}
  </div>
  {execution ? <p className="mt-1 text-xs text-muted-foreground">Stop the active run to change the agent.</p> : null}
</section>
```

With a `changeAgent` handler calling the new service + a refresh callback (follow how the tab already mutates/refreshes; if the Issue type lacks `agentKind`, add it to `tracker/src/types/issue.ts` and map `agent_kind` in `normalizeIssue`). Service in `issues.ts`:

```typescript
export async function updateIssueAgent(
  projectSlug: string,
  identifier: string,
  agent: AgentKind | null,
): Promise<Issue> {
  const response = await http.put(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}`),
    { agent },
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}
```

- [ ] **Step 7: Run both suites**

Run: `cd tracker && npm run lint && npx vitest run` → PASS.
Run: `cd elixir && make test` → PASS.

- [ ] **Step 8: Commit**

```bash
git add tracker/src elixir/lib elixir/test
git commit -m "feat(issues): inherit-aware agent chips on create dialog and Agent tab"
```

---

## Phase 4 — Native Claude backend (`Claude.AppServer`)

Reference implementation to port: https://github.com/sapsaldog/claude-app-server (`src/server.ts`, MIT). Component rule: **no Phoenix/Ecto/tracker imports** under `lib/symphony_elixir/claude/app_server/` — only `Jason`, `Bandit`/`Plug`, stdlib.

### Task 10: `CliRunner` — spawn claude CLI, parse stream-json, translate events

**Files:**
- Create: `elixir/lib/symphony_elixir/claude/app_server/cli_runner.ex`
- Create: `elixir/test/support/fixtures/fake_claude.sh` (fake CLI)
- Test: `elixir/test/symphony_elixir/claude/app_server/cli_runner_test.exs`

- [ ] **Step 1: Create the fake claude CLI fixture**

`elixir/test/support/fixtures/fake_claude.sh` (then `chmod +x`):

```bash
#!/usr/bin/env bash
# Fake `claude --print --output-format stream-json` for tests.
# Modes via FAKE_CLAUDE_MODE: happy (default) | error | hang
prompt="$(cat)"
case "${FAKE_CLAUDE_MODE:-happy}" in
  happy)
    echo '{"type":"system","subtype":"init","session_id":"sess-123"}'
    echo '{"type":"assistant","is_partial":true,"message":{"id":"m1","content":[{"type":"text","text":"Hel"}]}}'
    echo '{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"Hello from fake claude"}]}}'
    echo '{"type":"assistant","message":{"id":"m2","content":[{"type":"tool_use","id":"tu1","name":"mcp__symphony__list_issues","input":{"limit":1}}]}}'
    echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu1","content":[{"type":"text","text":"ok"}],"is_error":false}]}}'
    echo '{"type":"result","subtype":"success","session_id":"sess-123","usage":{"input_tokens":10,"output_tokens":5},"total_cost_usd":0.01}'
    ;;
  error)
    echo '{"type":"result","subtype":"error","error":"boom"}'
    exit 1
    ;;
  hang)
    sleep 60
    ;;
esac
```

- [ ] **Step 2: Write the failing test**

```elixir
defmodule SymphonyElixir.Claude.AppServer.CliRunnerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Claude.AppServer.CliRunner

  @fake Path.expand("../../../support/fixtures/fake_claude.sh", __DIR__)

  defp run(env_mode, opts \\ []) do
    workspace = Path.join(System.tmp_dir!(), "cli-runner-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    {:ok, collector} = Agent.start_link(fn -> [] end)
    on_event = fn event -> Agent.update(collector, &[event | &1]) end

    result =
      CliRunner.run_turn(
        %{
          command: "FAKE_CLAUDE_MODE=#{env_mode} #{@fake}",
          workspace: workspace,
          prompt: "do the thing",
          session_uuid: "11111111-1111-1111-1111-111111111111",
          cli_session_id: Keyword.get(opts, :cli_session_id),
          model: Keyword.get(opts, :model),
          mcp_config_path: Keyword.get(opts, :mcp_config_path),
          permission_mode: "bypassPermissions",
          timeout_ms: Keyword.get(opts, :timeout_ms, 5_000)
        },
        on_event
      )

    events = collector |> Agent.get(&Enum.reverse/1)
    Agent.stop(collector)
    {result, events}
  end

  test "happy turn captures session id, usage, cost, and emits translated events" do
    {result, events} = run("happy")

    assert {:ok, %{cli_session_id: "sess-123", status: :completed} = turn} = result
    assert turn.usage == %{input_tokens: 10, output_tokens: 5, total_tokens: 15}
    assert turn.cost_usd == 0.01

    methods = Enum.map(events, & &1["method"])
    assert "item/progress" in methods
    assert "item/created" in methods
    assert "turn/completed" in methods

    tool_item =
      Enum.find_value(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "tool_call"} = item}} -> item
        _ -> nil
      end)

    assert tool_item["name"] == "mcp__symphony__list_issues"
  end

  test "error result yields turn/failed and an error tuple" do
    {result, events} = run("error")

    assert {:error, {:turn_failed, _details}} = result
    assert Enum.any?(events, &(&1["method"] == "turn/failed"))
  end

  test "timeout kills the process and returns turn_timeout" do
    {result, _events} = run("hang", timeout_ms: 300)
    assert {:error, :turn_timeout} = result
  end

  test "argv: first turn uses --session-id, resumed turn uses --resume, model and mcp flags included" do
    args = CliRunner.build_args(%{session_uuid: "u-1", cli_session_id: nil, model: nil, mcp_config_path: nil, permission_mode: "bypassPermissions"})
    assert args =~ "--session-id u-1"
    refute args =~ "--resume"

    args = CliRunner.build_args(%{session_uuid: "u-1", cli_session_id: "sess-9", model: "claude-opus-4-6", mcp_config_path: "/tmp/m.json", permission_mode: "bypassPermissions"})
    assert args =~ "--resume sess-9"
    assert args =~ "--model claude-opus-4-6"
    assert args =~ "--mcp-config /tmp/m.json --strict-mcp-config"
    assert args =~ "--permission-mode bypassPermissions"
  end
end
```

- [ ] **Step 3: Run it to verify it fails**

Run: `make test ARGS="test/symphony_elixir/claude/app_server/cli_runner_test.exs"`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `CliRunner`**

`elixir/lib/symphony_elixir/claude/app_server/cli_runner.ex` — port of `runClaudeTurn`/`buildClaudeArgs`/`processClaudeEvent` from the reference. Key contracts:

```elixir
defmodule SymphonyElixir.Claude.AppServer.CliRunner do
  @moduledoc """
  Runs ONE Claude Code CLI turn:
  `claude --print --output-format stream-json --verbose --include-partial-messages ...`
  with the prompt delivered via a temp file + stdin redirect (Erlang ports
  cannot half-close stdin), parses the NDJSON stream and emits bridge-style
  notifications (`item/progress`, `item/created`, `usage/update`,
  `turn/completed`, `turn/failed`) through `on_event`.
  """

  require Logger

  @port_line_bytes 1_048_576

  @type turn_args :: %{
          required(:command) => String.t(),
          required(:workspace) => Path.t(),
          required(:prompt) => String.t(),
          required(:session_uuid) => String.t(),
          required(:cli_session_id) => String.t() | nil,
          required(:model) => String.t() | nil,
          required(:mcp_config_path) => Path.t() | nil,
          required(:permission_mode) => String.t(),
          required(:timeout_ms) => pos_integer()
        }

  @type turn_result :: %{
          cli_session_id: String.t() | nil,
          status: :completed,
          usage: map() | nil,
          cost_usd: number() | nil
        }

  @spec run_turn(turn_args(), (map() -> any())) :: {:ok, turn_result()} | {:error, term()}
  def run_turn(args, on_event) when is_function(on_event, 1) do
    prompt_file = write_prompt_file!(args.workspace, args.session_uuid, args.prompt)

    shell =
      "exec #{args.command} #{build_args(args)} < #{shell_escape(prompt_file)}"

    port =
      Port.open({:spawn_executable, System.find_executable("bash")}, [
        :binary,
        :exit_status,
        :stderr_to_stdout,
        args: ["-lc", shell],
        cd: String.to_charlist(Path.expand(args.workspace)),
        line: @port_line_bytes
      ])

    try do
      receive_loop(port, on_event, args.timeout_ms, "", initial_state(args))
    after
      File.rm(prompt_file)
      close_port(port)
    end
  end

  @spec build_args(map()) :: String.t()
  def build_args(args) do
    base = "--print --output-format stream-json --verbose --include-partial-messages --permission-mode #{args.permission_mode}"

    base
    |> append_if(args.model, &"--model #{&1}")
    |> append_if(args.mcp_config_path, &"--mcp-config #{&1} --strict-mcp-config")
    |> append_session(args)
  end

  defp append_session(acc, %{cli_session_id: nil, session_uuid: uuid}), do: acc <> " --session-id #{uuid}"
  defp append_session(acc, %{cli_session_id: sid}), do: acc <> " --resume #{sid}"

  defp append_if(acc, nil, _fun), do: acc
  defp append_if(acc, value, fun), do: acc <> " " <> fun.(value)
end
```

Implement the rest following the reference semantics exactly:

- `initial_state/1` → `%{cli_session_id: args.cli_session_id, usage: nil, cost_usd: nil, partial_text: %{}, error: nil}`.
- `receive_loop/5` — same `{:eol, chunk}` / `{:noeol, chunk}` / `{:exit_status, status}` / `after timeout_ms` structure as the CURRENT `elixir/lib/symphony_elixir/claude/coding_agent.ex:262-282` (copy that skeleton). On exit_status: status `0` or `130` with no recorded error → emit `turn/completed` notification map `%{"method" => "turn/completed", "params" => %{"usage" => usage_with_total, "cost_usd" => cost}}` through `on_event` and return `{:ok, result}`; recorded error or other status → emit `%{"method" => "turn/failed", "params" => %{"error" => message}}` and return `{:error, {:turn_failed, message}}`. Timeout → kill port, `{:error, :turn_timeout}`.
- `handle_line/…` decodes JSON and switches on `"type"`:
  - `"system"` + `"subtype" => "init"` → store `session_id`.
  - `"assistant"` → for each content block: text partial → delta vs `partial_text[msg_id]`, emit `%{"method" => "item/progress", "params" => %{"delta" => %{"type" => "text", "text" => delta}}}`; text final → emit `%{"method" => "item/created", "params" => %{"item" => %{"type" => "text", "text" => text}}}` and clear partial; `thinking` final → `item/created` with `%{"type" => "thinking", "thinking" => t}`; `tool_use` final → `item/created` with `%{"type" => "tool_call", "tool_use_id" => id, "name" => name, "input" => input}`.
  - `"user"` → `tool_result` blocks → `item/created` with `%{"type" => "tool_result", "tool_use_id" => id, "content" => joined_text, "is_error" => bool}`.
  - `"stream_event"` with `event.type == "message_delta"` and usage → store usage, emit `%{"method" => "usage/update", "params" => %{"usage" => usage_with_total}}`.
  - `"result"` → update `cli_session_id`, usage, cost; `subtype == "error"` → record `error`.
  - `"rate_limit_event"` → emit as-is wrapped `%{"method" => "rate_limit", "params" => event}`.
  - Non-JSON lines → `Logger.debug`, continue (copy `log_non_json_stream_line/2` from the current claude/coding_agent.ex).
- `usage_with_total/1` sums input + output + cache_read + cache_creation into `total_tokens` (atoms keys in the returned map: `%{input_tokens: _, output_tokens: _, total_tokens: _}`).
- `write_prompt_file!/3` → `Path.join([workspace, ".symphony", "claude-prompt-#{session_uuid}.md"])`, `File.mkdir_p!` + `File.write!`.
- `shell_escape/1` → `"'" <> String.replace(path, "'", "'\\''") <> "'"`.

- [ ] **Step 5: Run the test until green**

Run: `make test ARGS="test/symphony_elixir/claude/app_server/cli_runner_test.exs"`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/claude/app_server/cli_runner.ex elixir/test
git commit -m "feat(claude): native CLI runner with stream-json -> bridge event translation"
```

### Task 11: `ToolGateway` — loopback MCP server (per-session token)

**Files:**
- Create: `elixir/lib/symphony_elixir/claude/app_server/tool_gateway.ex`
- Modify: `elixir/lib/symphony_elixir/application.ex` — add the gateway to the supervision tree children list
- Test: `elixir/test/symphony_elixir/claude/app_server/tool_gateway_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Claude.AppServer.ToolGatewayTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Claude.AppServer.ToolGateway

  @specs [
    %{
      "name" => "echo_tool",
      "description" => "Echoes input.",
      "inputSchema" => %{"type" => "object", "properties" => %{"text" => %{"type" => "string"}}}
    }
  ]

  setup do
    executor = fn "echo_tool", %{"text" => text} ->
      %{"success" => true, "contentItems" => [%{"type" => "inputText", "text" => "echo: " <> text}]}
    end

    {:ok, token, url} = ToolGateway.register_session(@specs, executor)
    on_exit(fn -> ToolGateway.unregister_session(token) end)
    {:ok, url: url, token: token}
  end

  defp rpc(url, body) do
    {:ok, response} = Req.post(url, json: body, retry: false)
    response
  end

  test "initialize / tools/list / tools/call round-trip", %{url: url} do
    response = rpc(url, %{"jsonrpc" => "2.0", "id" => 1, "method" => "initialize", "params" => %{}})
    assert response.status == 200
    assert %{"result" => %{"protocolVersion" => _, "serverInfo" => %{"name" => "symphony"}}} = response.body

    response = rpc(url, %{"jsonrpc" => "2.0", "id" => 2, "method" => "tools/list", "params" => %{}})
    assert %{"result" => %{"tools" => [%{"name" => "echo_tool", "inputSchema" => _}]}} = response.body

    response =
      rpc(url, %{
        "jsonrpc" => "2.0",
        "id" => 3,
        "method" => "tools/call",
        "params" => %{"name" => "echo_tool", "arguments" => %{"text" => "hi"}}
      })

    assert %{"result" => %{"content" => [%{"type" => "text", "text" => "echo: hi"}], "isError" => false}} =
             response.body
  end

  test "failed executor result maps to isError", %{url: url, token: token} do
    ToolGateway.unregister_session(token)

    failing = fn _name, _args ->
      %{"success" => false, "contentItems" => [%{"type" => "inputText", "text" => "nope"}]}
    end

    {:ok, token2, url2} = ToolGateway.register_session(@specs, failing)
    on_exit(fn -> ToolGateway.unregister_session(token2) end)

    response =
      rpc(url2, %{"jsonrpc" => "2.0", "id" => 1, "method" => "tools/call", "params" => %{"name" => "echo_tool", "arguments" => %{}}})

    assert %{"result" => %{"isError" => true}} = response.body
    _ = url
  end

  test "unknown token is 401, notifications are 202", %{url: url} do
    bad = String.replace(url, ~r/mcp\/.+$/, "mcp/not-a-token")
    {:ok, response} = Req.post(bad, json: %{"jsonrpc" => "2.0", "id" => 1, "method" => "tools/list"}, retry: false)
    assert response.status == 401

    {:ok, response} = Req.post(url, json: %{"jsonrpc" => "2.0", "method" => "notifications/initialized"}, retry: false)
    assert response.status == 202
  end

  test "mcp_config_path writes the cursor file", %{url: url} do
    workspace = Path.join(System.tmp_dir!(), "gw-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)

    path = ToolGateway.write_mcp_config!(workspace, url)
    assert {:ok, body} = File.read(path)
    assert %{"mcpServers" => %{"symphony" => %{"type" => "http", "url" => ^url}}} = Jason.decode!(body)
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test ARGS="test/symphony_elixir/claude/app_server/tool_gateway_test.exs"`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the gateway**

`elixir/lib/symphony_elixir/claude/app_server/tool_gateway.ex`:

```elixir
defmodule SymphonyElixir.Claude.AppServer.ToolGateway do
  @moduledoc """
  Loopback MCP server (Streamable HTTP, JSON-RPC over POST) exposing
  per-session dynamic tools to the Claude Code CLI. The per-session token in
  the URL is the session binding: register_session/2 mints it and maps it to
  {tool specs, executor closure}; the CLI calls back with it.

  Owned by this component (NOT Phoenix) so Claude tools work even when the
  web subtree is down. Bandit listens on 127.0.0.1 with a random port.
  """

  use Plug.Router

  @table __MODULE__
  @protocol_version "2025-06-18"

  plug(Plug.Parsers, parsers: [:json], json_decoder: Jason)
  plug(:match)
  plug(:dispatch)

  # ── Supervision ────────────────────────────────────────────────────────────

  @spec child_spec(keyword()) :: Supervisor.child_spec()
  def child_spec(_opts) do
    %{
      id: __MODULE__,
      start: {__MODULE__, :start_link, []},
      type: :supervisor
    }
  end

  @spec start_link() :: {:ok, pid()} | {:error, term()}
  def start_link do
    ensure_table()
    Bandit.start_link(plug: __MODULE__, ip: {127, 0, 0, 1}, port: 0, startup_log: false)
  end

  # ── Session registry ───────────────────────────────────────────────────────

  @spec register_session([map()], (String.t(), map() -> map())) ::
          {:ok, String.t(), String.t()} | {:error, term()}
  def register_session(tool_specs, executor) when is_list(tool_specs) and is_function(executor, 2) do
    ensure_table()

    with {:ok, port} <- listening_port() do
      token = Base.url_encode64(:crypto.strong_rand_bytes(24), padding: false)
      :ets.insert(@table, {token, tool_specs, executor})
      {:ok, token, "http://127.0.0.1:#{port}/mcp/#{token}"}
    end
  end

  @spec unregister_session(String.t()) :: :ok
  def unregister_session(token) when is_binary(token) do
    ensure_table()
    :ets.delete(@table, token)
    :ok
  end

  @spec write_mcp_config!(Path.t(), String.t()) :: Path.t()
  def write_mcp_config!(workspace, url) do
    path = Path.join([workspace, ".symphony", "claude-mcp-#{System.unique_integer([:positive])}.json"])
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, Jason.encode!(%{mcpServers: %{symphony: %{type: "http", url: url}}}))
    path
  end

  # ── HTTP ───────────────────────────────────────────────────────────────────

  post "/mcp/:token" do
    case :ets.lookup(@table, token) do
      [{^token, specs, executor}] -> handle_rpc(conn, conn.body_params, specs, executor)
      [] -> send_json(conn, 401, %{error: "unknown session token"})
    end
  end

  match(_, do: send_json(conn, 404, %{error: "not found"}))

  defp handle_rpc(conn, %{"method" => method} = body, specs, executor) do
    case Map.get(body, "id") do
      nil ->
        # notifications (e.g. notifications/initialized) need no body
        send_resp(conn, 202, "")

      id ->
        send_json(conn, 200, %{jsonrpc: "2.0", id: id, result: result_for(method, body, specs, executor)})
    end
  end

  defp handle_rpc(conn, _body, _specs, _executor), do: send_json(conn, 400, %{error: "invalid JSON-RPC"})

  defp result_for("initialize", _body, _specs, _executor) do
    %{
      protocolVersion: @protocol_version,
      capabilities: %{tools: %{}},
      serverInfo: %{name: "symphony", version: to_string(Application.spec(:symphony_elixir, :vsn))}
    }
  end

  defp result_for("ping", _body, _specs, _executor), do: %{}

  defp result_for("tools/list", _body, specs, _executor) do
    %{
      tools:
        Enum.map(specs, fn spec ->
          %{
            name: spec["name"],
            description: spec["description"],
            inputSchema: spec["inputSchema"] || %{"type" => "object"}
          }
        end)
    }
  end

  defp result_for("tools/call", %{"params" => %{"name" => name} = params}, _specs, executor) do
    arguments = Map.get(params, "arguments") || %{}
    response = executor.(name, arguments)

    text =
      response
      |> Map.get("contentItems", [])
      |> Enum.map(&Map.get(&1, "text", ""))
      |> Enum.join("\n")

    %{content: [%{type: "text", text: text}], isError: Map.get(response, "success") != true}
  end

  defp result_for(_method, _body, _specs, _executor), do: %{}

  defp listening_port do
    case Process.whereis(__MODULE__.Listener) do
      nil -> start_listener()
      pid -> {:ok, registered_port(pid)}
    end
  end

  defp send_json(conn, status, payload) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(payload))
  end

  defp ensure_table do
    if :ets.whereis(@table) == :undefined do
      :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    end

    :ok
  end
end
```

Implementation detail the snippet leaves to you: the listening port. Use the approach Bandit documents — name the Bandit child (`Bandit.start_link(plug: __MODULE__, ip: ..., port: 0, name: __MODULE__.Listener)`) and read the bound port with `ThousandIsland.listener_info/1` on that name, memoizing it in `:persistent_term`. `start_listener/0` starts it on demand (so the standalone escript and tests work without the app tree) and `register_session/2` calls `listening_port/0` which starts-or-reads. Wrap the Bandit start in a `DynamicSupervisor`-free `case` that tolerates `{:error, {:already_started, pid}}`.

Add `{:req, "~> 0.5"}` is already a dep (used in tests). Add the gateway to `elixir/lib/symphony_elixir/application.ex` children (open it, find the `children = [...]` list, append `SymphonyElixir.Claude.AppServer.ToolGateway` before the Endpoint entry).

- [ ] **Step 4: Run the test until green**

Run: `make test ARGS="test/symphony_elixir/claude/app_server/tool_gateway_test.exs"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/claude/app_server/tool_gateway.ex elixir/lib/symphony_elixir/application.ex elixir/test
git commit -m "feat(claude): loopback MCP tool gateway with per-session tokens"
```

### Task 12: Rewrite `Claude.CodingAgent` as the embedded adapter (drop the bridge)

**Files:**
- Rewrite: `elixir/lib/symphony_elixir/claude/coding_agent.ex`
- Modify: `elixir/lib/symphony_elixir/instance_config.ex` — `@default_claude_command "claude"`
- Modify: `elixir/lib/symphony_elixir/claude/config.ex` — keep `command/1`, default now resolves to `claude`
- Test: rewrite `elixir/test/symphony_elixir/claude/coding_agent_test.exs` (find the existing one with `ls elixir/test/symphony_elixir/claude/`)

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Claude.CodingAgentTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Claude.CodingAgent

  @fake Path.expand("../../support/fixtures/fake_claude.sh", __DIR__)
  @issue %{id: "1", identifier: "PREF-1", title: "Test issue"}

  defp workspace do
    root = Path.join(System.tmp_dir!(), "claude-adapter-#{System.unique_integer([:positive])}")
    ws = Path.join(root, "issue-1")
    File.mkdir_p!(ws)
    {root, ws}
  end

  test "start_session is portless and run_turn completes via the CLI runner" do
    {root, ws} = workspace()

    assert {:ok, session} =
             CodingAgent.start_session(ws,
               workspace_root: root,
               claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}"
             )

    assert session.cli_session_id == nil
    assert is_binary(session.session_uuid)

    {:ok, collector} = Agent.start_link(fn -> [] end)
    on_message = fn message -> Agent.update(collector, &[message | &1]) end

    assert {:ok, result} = CodingAgent.run_turn(session, "do it", @issue, on_message: on_message)
    assert result.session_id =~ session.session_uuid
    assert result.cli_session_id == "sess-123"

    events = collector |> Agent.get(&Enum.reverse/1) |> Enum.map(& &1.event)
    assert :session_started in events
    assert :turn_completed in events
    Agent.stop(collector)
  end

  test "second turn resumes with the captured cli session id" do
    {root, ws} = workspace()

    {:ok, session} =
      CodingAgent.start_session(ws, workspace_root: root, claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}")

    {:ok, result} = CodingAgent.run_turn(session, "turn 1", @issue, [])
    session = Map.put(session, :cli_session_id, result.cli_session_id)

    # build_args is exercised through CliRunner; resumed sessions must use --resume.
    args =
      SymphonyElixir.Claude.AppServer.CliRunner.build_args(%{
        session_uuid: session.session_uuid,
        cli_session_id: session.cli_session_id,
        model: nil,
        mcp_config_path: nil,
        permission_mode: "bypassPermissions"
      })

    assert args =~ "--resume sess-123"
  end

  test "dynamic tools register a gateway session and pass --mcp-config" do
    {root, ws} = workspace()

    specs = [%{"name" => "echo_tool", "description" => "d", "inputSchema" => %{"type" => "object"}}]
    executor = fn _name, _args -> %{"success" => true, "contentItems" => []} end

    {:ok, session} =
      CodingAgent.start_session(ws,
        workspace_root: root,
        claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}",
        dynamic_tools: specs,
        tool_executor: executor
      )

    assert is_binary(session.mcp_config_path)
    assert File.exists?(session.mcp_config_path)
    assert {:ok, _} = CodingAgent.run_turn(session, "with tools", @issue, [])
    assert :ok = CodingAgent.stop_session(session)
    refute File.exists?(session.mcp_config_path)
  end

  test "workspace guard still rejects the workspace root itself" do
    {root, _ws} = workspace()
    assert {:error, {:invalid_workspace_cwd, :workspace_root, _}} = CodingAgent.start_session(root, workspace_root: root)
  end

  test "missing binary fails the turn visibly" do
    {root, ws} = workspace()

    {:ok, session} =
      CodingAgent.start_session(ws, workspace_root: root, claude_command: "definitely-not-a-binary-xyz")

    assert {:error, _reason} = CodingAgent.run_turn(session, "x", @issue, [])
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test ARGS="test/symphony_elixir/claude/coding_agent_test.exs"`
Expected: FAIL — current module speaks the bridge protocol (port-based session).

- [ ] **Step 3: Rewrite the adapter**

Replace `elixir/lib/symphony_elixir/claude/coding_agent.ex`. KEEP from the old file verbatim: `validate_workspace_cwd/2`, `resolve_workspace_root/1`, `normalize_event/1` + all its private helpers (`normalize_usage/1`, `normalize_rate_limits/1`, `token_value/2`, `parse_token_value/1`, `put_if_*`), `default_on_message/1`, `emit_message/4`, `issue_context/1`. New core:

```elixir
defmodule SymphonyElixir.Claude.CodingAgent do
  @moduledoc """
  Native Claude Code backend implementing the CodingAgent behaviour by
  spawning the `claude` CLI per turn (no external bridge). Tools are served
  through the component-owned MCP ToolGateway; events are translated by
  CliRunner into the bridge vocabulary the rest of Symphony understands.
  """

  @behaviour SymphonyElixir.CodingAgent

  require Logger

  alias SymphonyElixir.Claude.AppServer.{CliRunner, ToolGateway}
  alias SymphonyElixir.Config

  @permission_mode "bypassPermissions"

  @type session :: %{
          session_uuid: String.t(),
          workspace: Path.t(),
          command: String.t(),
          cli_session_id: String.t() | nil,
          model: String.t() | nil,
          gateway_token: String.t() | nil,
          mcp_config_path: Path.t() | nil,
          metadata: map()
        }

  @impl true
  def start_session(workspace, opts \\ []) do
    with :ok <- validate_workspace_cwd(workspace, opts),
         {:ok, gateway} <- maybe_register_tools(workspace, opts) do
      {:ok,
       %{
         session_uuid: generate_uuid(),
         workspace: Path.expand(workspace),
         command: resolve_command(opts),
         cli_session_id: nil,
         model: Keyword.get(opts, :model),
         gateway_token: gateway[:token],
         mcp_config_path: gateway[:path],
         metadata: %{}
       }}
    end
  end

  @impl true
  def run_turn(session, prompt, issue, opts \\ []) do
    on_message = Keyword.get(opts, :on_message, &default_on_message/1)
    turn_id = generate_uuid()
    session_id = "#{session.session_uuid}-#{turn_id}"

    emit_message(on_message, :session_started, %{session_id: session_id, thread_id: session.session_uuid, turn_id: turn_id}, %{})

    on_event = fn notification ->
      emit_message(on_message, :notification, %{payload: notification, raw: Jason.encode!(notification)}, usage_metadata(notification))
    end

    case CliRunner.run_turn(turn_args(session, prompt, opts), on_event) do
      {:ok, result} ->
        emit_message(on_message, :turn_completed, %{payload: %{"usage" => result.usage}, result: result}, %{usage: result.usage})

        {:ok,
         %{
           result: :turn_completed,
           session_id: session_id,
           thread_id: session.session_uuid,
           turn_id: turn_id,
           cli_session_id: result.cli_session_id,
           usage: result.usage,
           cost_usd: result.cost_usd
         }}

      {:error, reason} ->
        Logger.warning("Claude turn failed for #{issue_context(issue)}: #{inspect(reason)}")
        emit_message(on_message, :turn_ended_with_error, %{session_id: session_id, reason: reason}, %{})
        {:error, reason}
    end
  end

  @impl true
  def stop_session(%{gateway_token: token, mcp_config_path: path}) do
    if is_binary(token), do: ToolGateway.unregister_session(token)
    if is_binary(path), do: File.rm(path)
    :ok
  end

  def stop_session(_session), do: :ok

  defp turn_args(session, prompt, opts) do
    %{
      command: session.command,
      workspace: session.workspace,
      prompt: prompt,
      session_uuid: session.session_uuid,
      cli_session_id: session.cli_session_id,
      model: Keyword.get(opts, :model, session.model),
      mcp_config_path: session.mcp_config_path,
      permission_mode: @permission_mode,
      timeout_ms: Config.agent_turn_timeout_ms()
    }
  end

  defp maybe_register_tools(workspace, opts) do
    specs = Keyword.get(opts, :dynamic_tools, [])
    executor = Keyword.get(opts, :tool_executor)

    if specs != [] and is_function(executor, 2) do
      with {:ok, token, url} <- ToolGateway.register_session(specs, wrap_executor(executor)) do
        {:ok, %{token: token, path: ToolGateway.write_mcp_config!(Path.expand(workspace), url)}}
      end
    else
      {:ok, %{}}
    end
  end

  # The CLI prefixes MCP tools as mcp__symphony__<name>; executors know bare names.
  defp wrap_executor(executor) do
    fn name, arguments ->
      executor.(String.replace_prefix(name, "mcp__symphony__", ""), arguments)
    end
  end

  defp resolve_command(opts) do
    Keyword.get(opts, :claude_command) || SymphonyElixir.Claude.Config.command()
  end

  defp generate_uuid do
    <<a::32, b::16, c::16, d::16, e::48>> = :crypto.strong_rand_bytes(16)
    :io_lib.format("~8.16.0b-~4.16.0b-4~3.16.0b-~4.16.0b-~12.16.0b", [a, b, Bitwise.band(c, 0xFFF), Bitwise.bor(Bitwise.band(d, 0x3FFF), 0x8000), e])
    |> IO.iodata_to_binary()
  end

  defp usage_metadata(%{"method" => "usage/update", "params" => %{"usage" => usage}}), do: %{usage: usage}
  defp usage_metadata(_notification), do: %{}
end
```

Two wiring notes the engineer must apply:
1. The gateway tool-call wrapper strips `mcp__symphony__` so the CLI's prefixed names reach executors with bare names — that is also where the spec's "strip the prefix for display" happens for chips: tool_use items in the event stream keep the full name; the assistant relay (Task 14) strips it.
2. The turn loop is one CLI process per `run_turn`; cross-turn continuity = caller stores `cli_session_id`. Update `AgentRunner`'s claude path: after each `{:ok, result}` from `CodingAgent.run_turn/4`, if `result[:cli_session_id]` is a binary, `session = Map.put(session, :cli_session_id, result.cli_session_id)` before the next turn — do this inside `do_run_codex_turns/9` generically (`session = maybe_advance_session(session, result)`; a no-op for codex sessions, which have no `:cli_session_id` key).

In `instance_config.ex` change `@default_claude_command "symphony-claude"` → `@default_claude_command "claude"`. Delete the now-dead bridge protocol code paths left in the old file. Update any existing claude adapter tests that asserted bridge JSON-RPC behavior — they are replaced by this suite.

- [ ] **Step 4: Run the suite + the full backend**

Run: `make test ARGS="test/symphony_elixir/claude/coding_agent_test.exs"` → PASS.
Run: `make test` → PASS (fix `AgentRunner` claude-path tests; the `maybe_advance_session` change is covered by the resume test above).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib elixir/test
git commit -m "feat(claude): native embedded adapter replaces symphony-claude bridge"
```

---

## Phase 5 — Assistant: switchable chat engine + agnostic dispatch

### Task 13: Thread schema — `agent_kind` + `agent_thread_ids`

**Files:**
- Create: `elixir/priv/repo/migrations/20260605000200_add_agent_fields_to_assistant_threads.exs`
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex` (schema fields + helpers; find the `Thread` schema at "schema \"assistant_threads\"")
- Test: `elixir/test/symphony_elixir/assistant/history_agent_fields_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Assistant.HistoryAgentFieldsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.History

  setup do
    SymphonyElixir.Repo.delete_all(SymphonyElixir.Assistant.Thread)
    :ok
  end

  test "threads default to agent_kind nil and empty agent_thread_ids" do
    {:ok, thread} = History.create_thread(%{scope: "freeform", workspace_path: "/tmp/x"})
    assert thread.agent_kind == nil
    assert thread.agent_thread_ids == %{}
  end

  test "put_agent_thread_id stores per-kind backend ids and mirrors codex_thread_id" do
    {:ok, thread} = History.create_thread(%{scope: "freeform", workspace_path: "/tmp/x"})

    {:ok, thread} = History.put_agent_thread_id(thread, "codex", "codex-t1")
    assert History.agent_thread_id(thread, "codex") == "codex-t1"
    assert thread.codex_thread_id == "codex-t1"

    {:ok, thread} = History.put_agent_thread_id(thread, "claude", "sess-9")
    assert History.agent_thread_id(thread, "claude") == "sess-9"
    assert History.agent_thread_id(thread, "codex") == "codex-t1"
  end

  test "set_thread_agent persists the per-thread agent choice" do
    {:ok, thread} = History.create_thread(%{scope: "freeform", workspace_path: "/tmp/x"})
    {:ok, thread} = History.set_thread_agent(thread, "claude")
    assert thread.agent_kind == "claude"
  end
end
```

Adjust `History.create_thread/1` to the real creation function name (`grep -n "def create_thread\|def ensure_.*thread" elixir/lib/symphony_elixir/assistant/history.ex`); if `Thread` lives in its own module, alias accordingly.

- [ ] **Step 2: Run it to verify it fails**

Run: `make test ARGS="test/symphony_elixir/assistant/history_agent_fields_test.exs"`
Expected: FAIL — unknown fields/functions.

- [ ] **Step 3: Migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.AddAgentFieldsToAssistantThreads do
  use Ecto.Migration

  def up do
    alter table(:assistant_threads) do
      add(:agent_kind, :string)
      add(:agent_thread_ids, :map, null: false, default: %{})
    end

    execute("""
    UPDATE assistant_threads
    SET agent_thread_ids = json_object('codex', codex_thread_id)
    WHERE codex_thread_id IS NOT NULL
    """)
  end

  def down do
    alter table(:assistant_threads) do
      remove(:agent_kind)
      remove(:agent_thread_ids)
    end
  end
end
```

- [ ] **Step 4: Schema + helpers in `history.ex`**

Add to the `Thread` schema block:

```elixir
field(:agent_kind, :string)
field(:agent_thread_ids, :map, default: %{})
```

Add both to the changeset `cast` list. Add the helpers:

```elixir
@spec agent_thread_id(Thread.t(), String.t()) :: String.t() | nil
def agent_thread_id(%Thread{agent_thread_ids: ids}, kind) when is_map(ids), do: Map.get(ids, kind)
def agent_thread_id(_thread, _kind), do: nil

@spec put_agent_thread_id(Thread.t(), String.t(), String.t()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
def put_agent_thread_id(%Thread{} = thread, kind, backend_id) when is_binary(kind) and is_binary(backend_id) do
  ids = Map.put(thread.agent_thread_ids || %{}, kind, backend_id)
  attrs = %{agent_thread_ids: ids}
  attrs = if kind == "codex", do: Map.put(attrs, :codex_thread_id, backend_id), else: attrs
  update_thread(thread, attrs)
end

@spec set_thread_agent(Thread.t(), String.t()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
def set_thread_agent(%Thread{} = thread, kind) when kind in ["codex", "claude"] do
  update_thread(thread, %{agent_kind: kind})
end
```

- [ ] **Step 5: Run the test, then commit**

Run: `make test ARGS="test/symphony_elixir/assistant/history_agent_fields_test.exs"` → PASS.

```bash
git add elixir/priv/repo/migrations/20260605000200_add_agent_fields_to_assistant_threads.exs \
  elixir/lib/symphony_elixir/assistant/history.ex elixir/test
git commit -m "feat(assistant): per-thread agent_kind and per-agent backend thread ids"
```

### Task 14: Agent-aware assistant turns (session + channel)

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/codex_session.ex` — agent-kind plumb-through
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` — accept `context.agent`, expose effective agent on join
- Test: `elixir/test/symphony_elixir/assistant/codex_session_agent_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Assistant.CodexSessionAgentTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{CodexSession, History}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(SymphonyElixir.Assistant.Thread)
    Repo.delete_all(Setting)
    :ok
  end

  test "the runner receives the resolved agent kind and the per-agent backend thread id" do
    {:ok, thread} = History.create_thread(%{scope: "freeform", workspace_path: "/tmp/agent-test"})
    {:ok, thread} = History.put_agent_thread_id(thread, "claude", "sess-prev")

    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      send(test_pid, {:runner_opts, Keyword.get(opts, :agent_kind), Keyword.get(opts, :agent_thread_id)})
      {:ok, %{assistant_message: "ok", tool_calls: [], thread_id: "sess-new", turn_id: "t1"}}
    end

    {:ok, _result} =
      CodexSession.send_message_to_thread(thread, "hello", %{"agent" => "claude"}, runner: runner)

    assert_received {:runner_opts, "claude", "sess-prev"}

    reloaded = Repo.get!(SymphonyElixir.Assistant.Thread, thread.id)
    assert History.agent_thread_id(reloaded, "claude") == "sess-new"
    assert reloaded.agent_kind == "claude"
  end

  test "without context.agent the thread's stored agent (or settings default) applies" do
    {:ok, thread} = History.create_thread(%{scope: "freeform", workspace_path: "/tmp/agent-test"})
    {:ok, _} = SymphonyElixir.Settings.put("agents", "default_agent_kind", "claude")

    test_pid = self()

    runner = fn _w, _p, _i, opts ->
      send(test_pid, {:agent, Keyword.get(opts, :agent_kind)})
      {:ok, %{assistant_message: "ok", tool_calls: [], thread_id: "x", turn_id: "t"}}
    end

    {:ok, _} = CodexSession.send_message_to_thread(thread, "hi", %{}, runner: runner)
    assert_received {:agent, "claude"}
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test ARGS="test/symphony_elixir/assistant/codex_session_agent_test.exs"`
Expected: FAIL — opts carry no `:agent_kind`.

- [ ] **Step 3: Implement in `codex_session.ex`**

1. Add a resolution helper:

```elixir
defp resolve_thread_agent(thread, context) do
  AgentPreference.normalize(Map.get(context, "agent") || Map.get(context, :agent)) ||
    AgentPreference.normalize(Map.get(thread, :agent_kind)) ||
    Settings.Agents.default_agent_kind()
end
```

(aliases: `SymphonyElixir.AgentPreference`, `SymphonyElixir.Settings`).

2. In EVERY `send_message_to_thread/4` clause (freeform / project_explore / issue) compute `agent_kind = resolve_thread_agent(thread, context)` and extend the runner opts:

```elixir
opts =
  opts
  |> Keyword.put(:agent_kind, agent_kind)
  |> Keyword.put(:agent_thread_id, History.agent_thread_id(thread, agent_kind))
```

3. `default_runner/4` passes the kind to the adapter boundary (root adapter already takes it — `coding_agent.ex:36`):

```elixir
with {:ok, session} <- CodingAgent.start_session(workspace, Keyword.get(opts, :agent_kind), opts) do
```

and forwards `Keyword.put(opts, :agent_kind, ...)` into `CodingAgent.run_turn/4` (it reads `opts[:agent_kind]`). For codex the extra opts are inert; for claude, `start_session` consumes `:model` and `run_turn`'s session resume comes from `:agent_thread_id` — in `default_runner`, before `run_turn`, do `session = if id = Keyword.get(opts, :agent_thread_id), do: Map.put(session, :cli_session_id, id), else: session` (no-op for codex map).

4. Generalize the post-turn persistence: rename `maybe_update_codex_thread/2` → `maybe_update_agent_thread/3` taking `(thread, runner_result, agent_kind)`:

```elixir
defp maybe_update_agent_thread(thread, runner_result, agent_kind) do
  backend_id =
    Map.get(runner_result, :codex_thread_id) || Map.get(runner_result, "codex_thread_id") ||
      Map.get(runner_result, :cli_session_id) || Map.get(runner_result, :thread_id)

  with {:ok, thread} <- History.set_thread_agent(thread, agent_kind) do
    if is_binary(backend_id),
      do: History.put_agent_thread_id(thread, agent_kind, backend_id),
      else: {:ok, thread}
  end
end
```

Update its call sites in each scope clause. Also make `normalize_runner_result/1` pass `:cli_session_id` through (add it to the returned map alongside `codex_thread_id`).

5. The claude runner emits raw bridge notifications; the relay that feeds the UI (`relay_codex_event/3`) matches `item/progress` / `item/created` payloads — verify the claude notifications produced by `CliRunner` flow through unchanged (they use the same `"method"` strings on purpose). Where the relay extracts tool names for chips, strip the MCP prefix: `String.replace_prefix(name, "mcp__symphony__", "")`.

- [ ] **Step 4: Channel — accept the agent + expose the effective one**

In `assistant_channel.ex`:

1. `do_send_message/3` already copies `model`/`effort` into context — add agent the same way:

```elixir
|> Map.put("agent", Map.get(context, "agent") || Map.get(context, :agent))
```

2. In every `join/3` reply payload add `effective_agent`:

```elixir
effective_agent: thread_effective_agent(thread),
```

with:

```elixir
defp thread_effective_agent(thread) do
  SymphonyElixir.AgentPreference.normalize(Map.get(thread, :agent_kind)) ||
    SymphonyElixir.Settings.Agents.default_agent_kind()
end
```

(For issue-scoped joins, prefer the issue's task label when present: resolve via `AgentRunner.issue_agent_kind/1` if the issue struct is available at join; otherwise thread/user is fine — document the choice in a comment.)

- [ ] **Step 5: Run the session + channel suites**

Run: `make test ARGS="test/symphony_elixir/assistant/codex_session_agent_test.exs"` → PASS.
Run: `make test ARGS="$(cd elixir && ls test/symphony_elixir/assistant/*_test.exs test/symphony_elixir_web/channels/*_test.exs | tr '\n' ' ')"` → PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib elixir/test
git commit -m "feat(assistant): per-message agent resolution and per-agent thread resume"
```

### Task 15: `dispatch_coding_agent` tool (+ alias) and dynamic dispatch UI strings

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/tool_executor.ex`
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` (`handle_in("dispatch_codex", ...)` accepts `"agent"`)
- Modify: `tracker/src/components/assistant/assistantToolCall.ts`, `tracker/src/components/assistant/IssueAuthoringPanel.tsx`, `tracker/src/services/phoenix/assistantChannel.ts`
- Test: `elixir/test/symphony_elixir/assistant/tool_executor_dispatch_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Assistant.ToolExecutorDispatchTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.ToolExecutor
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(Setting)
    {:ok, _project} = Context.ensure_project(%{name: "Pref", slug: "pref"})
    {:ok, issue} = Context.create_issue("pref", %{"title" => "Dispatchable", "status" => "Todo"})
    {:ok, issue: issue}
  end

  test "dispatch_coding_agent honors the explicit agent argument", %{issue: issue} do
    {:ok, result} =
      ToolExecutor.execute("pref", "dispatch_coding_agent", %{
        "identifier" => issue.identifier,
        "instructions" => "do it",
        "agent" => "claude"
      })

    assert result.tool == "dispatch_coding_agent"
    assert result.message =~ "Claude"
    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert "symphony:claude" in label_names(updated)
  end

  test "without an agent argument the chain resolves (user default claude)", %{issue: issue} do
    {:ok, _} = Settings.put("agents", "default_agent_kind", "claude")

    {:ok, result} =
      ToolExecutor.execute("pref", "dispatch_coding_agent", %{
        "identifier" => issue.identifier,
        "instructions" => "do it"
      })

    assert result.message =~ "Claude"
    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert "symphony:claude" in label_names(updated)
  end

  test "dispatch_codex stays as a working alias", %{issue: issue} do
    {:ok, result} =
      ToolExecutor.execute("pref", "dispatch_codex", %{
        "identifier" => issue.identifier,
        "instructions" => "do it"
      })

    assert result.message =~ "Codex"
  end

  defp label_names(issue) do
    issue |> Repo.preload(:labels) |> Map.get(:labels) |> Enum.map(& &1.name)
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test ARGS="test/symphony_elixir/assistant/tool_executor_dispatch_test.exs"`
Expected: FAIL — `dispatch_coding_agent` unsupported.

- [ ] **Step 3: Implement in `tool_executor.ex`**

1. Tool spec: rename the spec (line ~171) to `dispatch_coding_agent`, generalize wording, add the `agent` property:

```elixir
tool_spec("dispatch_coding_agent", "Request coding-agent work (Codex or Claude) through the existing issue workflow.", %{
  "type" => "object",
  "additionalProperties" => false,
  "required" => ["identifier", "instructions"],
  "properties" => %{
    "identifier" => string_schema("Issue identifier to dispatch, for example MAC-1."),
    "instructions" => string_schema("Concrete coding instructions for the agent."),
    "agent" => string_schema("Optional agent override: codex or claude. Omit to follow task > project > user preference."),
    "goal" => string_schema("Optional long-running goal (Codex only) to persist for the orchestrator.")
  }
})
```

2. Membership lists: replace `"dispatch_codex"` with `"dispatch_coding_agent"` in `@tracker_tools`, `@issue_bound_mutable_tools`, `@issue_bound_supported_tools` (lines 27/36/37) — and KEEP `"dispatch_codex"` in all three as the alias.

3. Execution: rename the `do_execute(project, "dispatch_codex", ...)` clause to `"dispatch_coding_agent"` and add an alias clause + agent resolution:

```elixir
defp do_execute(project, "dispatch_codex", arguments, opts),
  do: do_execute(project, "dispatch_coding_agent", arguments, opts)

defp do_execute(project, "dispatch_coding_agent", arguments, _opts) do
  with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
       {:ok, instructions} <- normalize_required_string(Map.get(arguments, "instructions"), :instructions),
       :ok <- ensure_status_available(project, @in_progress_state),
       {:ok, agent} <- resolve_dispatch_agent(project, identifier, Map.get(arguments, "agent")),
       {:ok, _comment} <- IssueAdapter.dispatch(project, :add_comment, [identifier, codex_comment(instructions), %{"author" => "assistant"}]),
       {:ok, issue} <- IssueAdapter.dispatch(project, :move_issue, [identifier, dispatch_agent_attrs(agent, arguments)]) do
    presented = TrackerPresenter.issue(issue)

    {:ok,
     %{
       tool: "dispatch_coding_agent",
       message: "Requested #{agent_display(agent)} work on #{presented.identifier}",
       data: presented
     }}
  end
end

defp resolve_dispatch_agent(project, identifier, explicit) do
  case AgentPreference.normalize(explicit) do
    nil ->
      project_kind = project |> Repo.preload(:setup) |> ProjectConfig.resolve() |> Map.get(:agent_kind)
      labels = issue_label_names(project, identifier)
      {:ok, AgentPreference.resolve(labels, project_kind)}

    kind ->
      {:ok, kind}
  end
end

defp issue_label_names(project, identifier) do
  case IssueAdapter.dispatch(project, :get_issue, [identifier]) do
    {:ok, issue} -> Map.get(issue, :labels) |> List.wrap() |> Enum.map(&to_string/1)
    _ -> []
  end
end

defp agent_display("claude"), do: "Claude"
defp agent_display(_), do: "Codex"

defp dispatch_agent_attrs(agent, arguments) do
  %{
    "status" => @in_progress_state,
    "agent" => agent,
    "agent_goal" => if(agent == "codex", do: normalize_optional_string(Map.get(arguments, "goal")), else: nil)
  }
end
```

Delete the old `dispatch_codex_attrs/1`. Confirm `:get_issue` is a real `IssueAdapter` op (grep; otherwise use the adapter's actual fetch op and the issue struct's label field — the mapper already exposes `labels`; note `visible_labels` strips `symphony:*`, so use the ISSUE's `agent_kind` field instead when labels are filtered: `task_kind = Map.get(issue, :agent_kind)` and feed `AgentPreference.resolve(if(task_kind, do: ["symphony:" <> task_kind], else: []), project_kind)`).

4. Channel: in `handle_in("dispatch_codex", payload, socket)` pass the optional agent through `dispatch_arguments/2` → `Map.put(args, "agent", Map.get(payload, "agent"))` (nil-safe) and call the new tool name. Keep the inbound event name `"dispatch_codex"` for wire compat and ALSO add a `handle_in("dispatch_coding_agent", ...)` clause delegating to the same private function.

- [ ] **Step 4: Frontend strings + payloads**

1. `assistantToolCall.ts`: add `"dispatch_coding_agent"` to `ACTION_TOOLS` (the `dispatch_` prefix already matches, but the explicit entry keeps the set honest).
2. `assistantChannel.ts` (line ~392): replace the hardcoded `agent: "codex"` in the send payload with the selected agent from composer settings (Task 16 introduces the value; for now thread it as a parameter with default `"codex"`). Add the dispatch push param: where the channel exposes a `dispatch` function pushing `"dispatch_codex"`, accept `{ agent?: AgentKind }` and include it in the payload.
3. `IssueAuthoringPanel.tsx`: the dispatch handler + status strings become agent-aware — replace "Dispatching to Codex..." with `` `Dispatching to ${agentLabel}...` `` where `agentLabel` comes from the resolved effective agent (`effective_agent` from the channel join payload, overridable by the composer picker). Goal-mode toggles render ONLY when the effective agent is `codex` (wrap the existing goal-mode block in `{effectiveAgent === "codex" ? ... : null}`).

- [ ] **Step 5: Run suites**

Run: `make test ARGS="test/symphony_elixir/assistant/tool_executor_dispatch_test.exs"` → PASS.
Run: `make test` → PASS (update tool-spec snapshot/assertion tests listing `dispatch_codex`).
Run: `cd tracker && npm run lint && npx vitest run` → PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir tracker/src
git commit -m "feat(assistant): dispatch_coding_agent with chain resolution; dispatch_codex aliased"
```

### Task 16: Per-agent model catalogs + composer agent picker

**Files:**
- Create: `elixir/lib/symphony_elixir/claude/model_catalog.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_controller.ex` — `config/2` returns both catalogs
- Modify: `tracker/src/lib/assistantSettings.ts` — multi-agent catalogs + per-agent composer settings
- Modify: `tracker/src/components/assistant/AssistantComposer.tsx` — agent picker (badge → menu), hide effort when empty
- Test: `elixir/test/symphony_elixir/claude/model_catalog_test.exs`, `tracker/src/lib/__tests__/assistantSettings.test.ts`

- [ ] **Step 1: Write the failing backend test**

```elixir
defmodule SymphonyElixir.Claude.ModelCatalogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Claude.ModelCatalog

  test "static catalog mirrors the codex catalog shape" do
    assert {:ok, catalog} = ModelCatalog.list_models()

    assert catalog.agent == "claude"
    assert catalog.agent_label == "Claude Code"
    assert is_binary(catalog.command)
    assert catalog.default_model == "claude-opus-4-6"

    ids = Enum.map(catalog.models, & &1.id)
    assert ids == ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"]

    assert Enum.all?(catalog.models, &(&1.efforts == []))
    assert Enum.find(catalog.models, & &1.is_default).id == "claude-opus-4-6"
  end
end
```

- [ ] **Step 2: Implement `Claude.ModelCatalog`**

```elixir
defmodule SymphonyElixir.Claude.ModelCatalog do
  @moduledoc """
  Static Claude Code model catalog, shaped exactly like
  `SymphonyElixir.Codex.ModelCatalog.catalog()`. Mirrors the reference
  bridge's AVAILABLE_MODELS list; no efforts (reasoning effort is a Codex
  concept — the composer hides the menu when `efforts == []`).
  """

  alias SymphonyElixir.InstanceConfig

  @models [
    %{id: "claude-opus-4-6", label: "Claude Opus 4.6", default: true},
    %{id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", default: false},
    %{id: "claude-haiku-4-5", label: "Claude Haiku 4.5", default: false}
  ]

  @spec list_models(keyword()) :: {:ok, map()}
  def list_models(_opts \\ []) do
    models =
      Enum.map(@models, fn model ->
        %{
          id: model.id,
          model: model.id,
          label: model.label,
          is_default: model.default,
          default_effort: "",
          efforts: [],
          input_modalities: ["text", "image"]
        }
      end)

    {:ok,
     %{
       agent: "claude",
       agent_label: "Claude Code",
       command: InstanceConfig.claude_command(),
       default_model: "claude-opus-4-6",
       models: models
     }}
  end
end
```

Run: `make test ARGS="test/symphony_elixir/claude/model_catalog_test.exs"` → PASS.

- [ ] **Step 3: Both catalogs from the config endpoint**

In `assistant_controller.ex` replace `config/2`:

```elixir
@spec config(Conn.t(), map()) :: Conn.t()
def config(conn, _params) do
  {:ok, codex} = ModelCatalog.list_models()
  {:ok, claude} = SymphonyElixir.Claude.ModelCatalog.list_models()

  json(conn, %{
    data: %{
      agents: [codex, claude],
      default_agent: SymphonyElixir.Settings.Agents.default_agent_kind()
    }
  })
end
```

Update the controller test for the new shape. Backward note: the old shape was the bare codex catalog — the frontend is updated in the same release (Step 4); no external consumers exist.

- [ ] **Step 4: Frontend — multi-agent settings**

In `assistantSettings.ts`:

1. Rename `AssistantCodexCatalog` → `AssistantAgentCatalog` with `agent: AgentKind` (keep a deprecated alias export `type AssistantCodexCatalog = AssistantAgentCatalog` to limit churn).
2. New container types + storage:

```typescript
export interface AssistantCatalogBundle {
  agents: AssistantAgentCatalog[];
  defaultAgent: AgentKind;
}

const STORAGE_KEY = "symphony.assistant.composer.v2"; // { agent, byAgent: { codex: {model,effort}, claude: {...} } }
const CATALOG_STORAGE_KEY = "symphony.assistant.catalogs";

export interface AssistantComposerState {
  agent: AgentKind;
  byAgent: Partial<Record<AgentKind, AssistantComposerSettings>>;
}
```

3. Add `fallbackClaudeCatalog()` mirroring the backend statics (opus/sonnet/haiku, `efforts: []`), `fallbackCatalogBundle()` combining both with `defaultAgent: "codex"`, and rewrite load/save to the v2 state: `loadComposerState(bundle): AssistantComposerState` (picks `bundle.defaultAgent` when nothing stored; per-agent settings default via `defaultComposerSettings(catalogFor(bundle, agent))`), `saveComposerState(state)`, `catalogFor(bundle, agent)`. Keep the existing per-catalog helpers (`modelLabel`, `effortsForModel`, ...) — they take a single catalog and remain unchanged.

4. Vitest for the new pure helpers in `tracker/src/lib/__tests__/assistantSettings.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  catalogFor,
  fallbackCatalogBundle,
  loadComposerState,
  saveComposerState,
} from "@/lib/assistantSettings";

describe("composer state v2", () => {
  it("defaults to the bundle's default agent with that catalog's default model", () => {
    window.localStorage.clear();
    const bundle = fallbackCatalogBundle();
    const state = loadComposerState(bundle);

    expect(state.agent).toBe("codex");
    expect(state.byAgent.codex?.model).toBe("gpt-5.5");
  });

  it("persists per-agent model choices independently", () => {
    window.localStorage.clear();
    const bundle = fallbackCatalogBundle();
    const state = loadComposerState(bundle);

    state.agent = "claude";
    state.byAgent.claude = { model: "claude-sonnet-4-6", effort: "" };
    saveComposerState(state);

    const reloaded = loadComposerState(bundle);
    expect(reloaded.agent).toBe("claude");
    expect(reloaded.byAgent.claude?.model).toBe("claude-sonnet-4-6");
    expect(catalogFor(bundle, "claude").agentLabel).toBe("Claude Code");
  });
});
```

- [ ] **Step 5: Composer picker**

In `AssistantComposer.tsx`:

1. Props change: `catalog: AssistantCodexCatalog` → `bundle: AssistantCatalogBundle` (update the callers — grep `AssistantComposer` usages — to fetch the new config shape; the service that fetches `/assistant/config` maps `data.agents`/`data.default_agent`).
2. State: `const [state, setState] = useState(() => loadComposerState(bundle));` with `const catalog = catalogFor(bundle, state.agent);` and `const settings = state.byAgent[state.agent] ?? defaultComposerSettings(catalog);`.
3. Replace the static `{catalog.agentLabel}` badge with an `AgentMenu` (same `DropdownMenu` pattern as `ModelMenu`, options = `bundle.agents.map(c => ({value: c.agent, label: c.agentLabel}))`, onChange sets `state.agent` + persists).
4. Hide the effort menu when empty: `{effortOptions.length > 0 ? <EffortMenu ... /> : null}`.
5. The submit payload's `context.agent` (see `assistantChannel.ts:392`) now sends `state.agent`.

- [ ] **Step 6: Run everything**

Run: `cd tracker && npm run lint && npx vitest run` → PASS.
Run: `cd elixir && make test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add elixir tracker/src
git commit -m "feat(assistant): per-agent model catalogs and composer agent picker"
```

---

## Phase 6 — Standalone app-server + docs/compat

### Task 17: Stdio app-server (`bin/symphony-claude` drop-in)

**Files:**
- Create: `elixir/lib/symphony_elixir/claude/app_server/server.ex` (threads/turns state machine)
- Create: `elixir/lib/symphony_elixir/claude/app_server/stdio_main.ex`
- Modify: `elixir/lib/symphony_elixir/cli.ex` — subcommand dispatch
- Modify: `elixir/Makefile` — `build` also emits the `bin/symphony-claude` wrapper
- Test: `elixir/test/symphony_elixir/claude/app_server/server_test.exs`

- [ ] **Step 1: Write the failing server test (protocol level, no real CLI)**

```elixir
defmodule SymphonyElixir.Claude.AppServer.ServerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Claude.AppServer.Server

  @fake Path.expand("../../../support/fixtures/fake_claude.sh", __DIR__)

  defp start_server do
    test_pid = self()
    sender = fn payload -> send(test_pid, {:out, payload}) end
    {:ok, server} = Server.start_link(sender: sender, command: "FAKE_CLAUDE_MODE=happy #{@fake}")
    server
  end

  defp request(server, id, method, params) do
    Server.handle_message(server, %{"jsonrpc" => "2.0", "id" => id, "method" => method, "params" => params})
    assert_receive {:out, %{"id" => ^id} = response}, 5_000
    response
  end

  test "initialize -> thread/start -> turn/start -> turn/completed flow" do
    server = start_server()

    response = request(server, 1, "initialize", %{"clientInfo" => %{"name" => "test"}})
    assert %{"result" => %{"server" => %{"name" => "symphony-claude"}}} = response
    assert_receive {:out, %{"method" => "initialized"}}

    workspace = Path.join(System.tmp_dir!(), "appserver-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)

    response = request(server, 2, "thread/start", %{"cwd" => workspace, "permissionMode" => "bypassPermissions"})
    assert %{"result" => %{"thread" => %{"id" => thread_id}}} = response

    response = request(server, 3, "turn/start", %{"threadId" => thread_id, "input" => [%{"type" => "text", "text" => "hi"}]})
    assert %{"result" => %{"turn" => %{"id" => _turn_id}}} = response

    assert_receive {:out, %{"method" => "turn/completed", "params" => %{"usage" => _}}}, 10_000
  end

  test "model/list returns the static catalog and uninitialized requests are rejected" do
    server = start_server()

    Server.handle_message(server, %{"jsonrpc" => "2.0", "id" => 9, "method" => "model/list", "params" => %{}})
    assert_receive {:out, %{"id" => 9, "error" => %{"message" => message}}}
    assert message =~ "initialize"

    request(server, 1, "initialize", %{})
    response = request(server, 2, "model/list", %{})
    assert %{"result" => %{"models" => [%{"id" => "claude-opus-4-6"} | _]}} = response
  end

  test "dynamicTools at thread/start round-trip as item/tool/call reverse requests" do
    server = start_server()
    request(server, 1, "initialize", %{})

    workspace = Path.join(System.tmp_dir!(), "appserver-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)

    specs = [%{"name" => "echo_tool", "description" => "d", "inputSchema" => %{"type" => "object"}}]
    response = request(server, 2, "thread/start", %{"cwd" => workspace, "dynamicTools" => specs})
    assert %{"result" => %{"thread" => %{"id" => thread_id}}} = response

    request(server, 3, "turn/start", %{"threadId" => thread_id, "input" => [%{"type" => "text", "text" => "use tools"}]})

    # The fake CLI does not actually call MCP; exercise the gateway executor directly:
    # the server's registered executor must forward to the stdio client and await the response.
    executor = Server.tool_executor_for_test(server, thread_id)

    task = Task.async(fn -> executor.("echo_tool", %{"text" => "hi"}) end)

    assert_receive {:out, %{"method" => "item/tool/call", "id" => call_id, "params" => %{"name" => "echo_tool"}}}, 5_000

    Server.handle_message(server, %{
      "jsonrpc" => "2.0",
      "id" => call_id,
      "result" => %{"success" => true, "contentItems" => [%{"type" => "inputText", "text" => "echo: hi"}]}
    })

    assert %{"success" => true} = Task.await(task)
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test ARGS="test/symphony_elixir/claude/app_server/server_test.exs"`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `Server`**

`elixir/lib/symphony_elixir/claude/app_server/server.ex` — a GenServer port of the reference `ClaudeAppServer` class:

- State: `%{sender: fun, command: String.t(), initialized: false, threads: %{}, pending_tool_calls: %{}, next_out_id: 1000}`.
- `start_link(opts)` — `sender:` (fn payload -> any; stdio main passes a stdout writer; tests pass `send/2`), `command:` (default `SymphonyElixir.Claude.Config.command()`).
- `handle_message(server, msg)` — `GenServer.cast` for fire-and-forget; requests with `"id"` produce a sender call with `%{"jsonrpc" => "2.0", "id" => id, "result" | "error" => ...}`. Responses from the client (an `"id"` the server itself emitted — tool-call replies) resolve `pending_tool_calls[id]` by replying to the waiting task (`GenServer.reply`? use a `from`-less map of `id => caller_pid` and `send(caller, {:tool_result, id, result})`).
- Methods (mirror the reference dispatcher):
  - `initialize` → mark initialized, reply `%{"server" => %{"name" => "symphony-claude", "version" => Application.spec(:symphony_elixir, :vsn) |> to_string()}, "capabilities" => %{"threads" => ["start", "resume"], "turns" => ["start", "steer", "interrupt"], "models" => model_ids()}}`, then notify `initialized`. Any other method before initialize → error `%{"code" => -32002, "message" => "Not initialized. Send initialize first."}`.
  - `thread/start` → create `%{id: uuid, cwd: expand(cwd), permission_mode: params["permissionMode"] || "bypassPermissions", cli_session_id: nil, dynamic_tools: params["dynamicTools"] || [], gateway: nil, steer_queue: [], active_turn: nil}`; when `dynamic_tools != []` register a ToolGateway session whose executor forwards to the stdio client (see below) and store `{token, mcp_config_path}`. Reply `%{"thread" => %{"id" => id}}`.
  - `thread/resume` → reply with the stored thread (id, cwd, cli_session_id).
  - `turn/start` → busy-guard (`active_turn` → error TurnBusy), build prompt from `content` or `input` array (concat `type == "text"` entries), prepend + clear `steer_queue`, reply `%{"turn" => %{"id" => turn_id}}`, then `Task.start` a `CliRunner.run_turn/2` whose `on_event` forwards every notification through `sender` augmented with `turn_id`/`thread_id` in params; on `{:ok, result}` store `cli_session_id` (the runner already emitted `turn/completed`); on `{:error, reason}` the runner already emitted `turn/failed` — also clear `active_turn` via a message back to the server process.
  - `turn/steer` → push content to the active thread's `steer_queue`, reply `%{"turn_id" => active, "note" => "queued: will be prepended to the next user message"}`; no active turn → error.
  - `turn/interrupt` → kill the running turn's task/port (store the runner task pid; `Process.exit(pid, :kill)`), clear `active_turn`, reply `%{"status" => "interrupted"}`.
  - `model/list` → `{:ok, catalog} = SymphonyElixir.Claude.ModelCatalog.list_models()`; reply `%{"models" => Enum.map(catalog.models, &%{"id" => &1.id, "name" => &1.label})}`.
  - Unknown → error MethodNotFound.
- Stdio-client tool executor (the standalone dynamicTools contract): a closure that (1) asks the server process for a fresh outbound id, (2) sends `%{"jsonrpc" => "2.0", "id" => out_id, "method" => "item/tool/call", "params" => %{"name" => name, "arguments" => arguments, "threadId" => thread_id}}` through `sender`, (3) blocks `receive {:tool_result, ^out_id, result}` (timeout 60s → `%{"success" => false, "contentItems" => [%{"type" => "inputText", "text" => "tool call timed out"}]}`). Expose `tool_executor_for_test/2` returning that closure (used by the test above; `@doc false`).

- [ ] **Step 4: Implement `StdioMain` + CLI dispatch + wrapper**

`elixir/lib/symphony_elixir/claude/app_server/stdio_main.ex`:

```elixir
defmodule SymphonyElixir.Claude.AppServer.StdioMain do
  @moduledoc """
  Standalone entrypoint: serves the Codex app-server protocol over stdio,
  backed by the native Claude CLI runner. A dynamicTools-capable drop-in for
  the retired symphony-claude TS bridge. Never starts the Repo (escript-safe).
  """

  alias SymphonyElixir.Claude.AppServer.Server

  @spec run([String.t()]) :: no_return()
  def run(_argv) do
    {:ok, server} = Server.start_link(sender: &write_stdout/1)
    loop(server)
  end

  defp loop(server) do
    case IO.read(:stdio, :line) do
      :eof ->
        System.halt(0)

      {:error, _reason} ->
        System.halt(1)

      line ->
        case Jason.decode(String.trim(line)) do
          {:ok, message} -> Server.handle_message(server, message)
          {:error, _} -> :ok
        end

        loop(server)
    end
  end

  defp write_stdout(payload) do
    IO.puts(:stdio, Jason.encode!(Map.put_new(payload, "jsonrpc", "2.0")))
  end
end
```

In `elixir/lib/symphony_elixir/cli.ex`, at the TOP of `main/1` add the subcommand intercept:

```elixir
def main(["claude-app-server" | rest]) do
  SymphonyElixir.Claude.AppServer.StdioMain.run(rest)
end
```

(keep the existing `main/1` clauses below it). In `elixir/Makefile`, extend the `build` target:

```make
build:
	$(MIX) build
	@printf '#!/usr/bin/env bash\nexec "$$(dirname "$$0")/symphony" claude-app-server "$$@"\n' > bin/symphony-claude
	@chmod +x bin/symphony-claude
```

- [ ] **Step 5: Run the server suite + a manual stdio smoke**

Run: `make test ARGS="test/symphony_elixir/claude/app_server/server_test.exs"` → PASS.
Run: `make build && printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' | ./bin/symphony-claude | head -2`
Expected: two JSON lines — the initialize result (`"symphony-claude"`) and the `initialized` notification.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib elixir/test elixir/Makefile
git commit -m "feat(claude): standalone stdio app-server (bin/symphony-claude drop-in)"
```

### Task 18: Docs, compat sweep, full CI

**Files:**
- Modify: `elixir/README.md`, `elixir/docs/troubleshooting.md` (grep `symphony-claude`), `README.md` if it mentions the bridge
- Modify: `elixir/mix.exs` — coverage `ignore_modules` additions for IO-bound modules
- Test: full suites

- [ ] **Step 1: README updates**

In `elixir/README.md`:
1. Homebrew section: delete the `brew install symphony-claude` block; replace with: "The Claude backend is built in — it drives your locally installed `claude` CLI directly (run `claude` once to log in). The packaged `bin/symphony-claude` escript exposes the same app-server protocol over stdio for external orchestrators."
2. The GitHub routing rule "The WORKFLOW must include a `codex:` and/or `claude:` section for the targeted agent" → replace with: "Issues labeled `symphony:codex`/`symphony:claude` route to that agent; unlabeled `symphony` issues follow the project's `agent.kind` (workflow front matter), else the operator default from **Settings**."
3. Add a short "Agent preference" subsection documenting the chain (task > project > user > codex), the Settings page, and `agent.kind` in front matter.
4. `grep -rn "symphony-claude" elixir/ docs/ README.md --include="*.md"` — update every remaining hit (troubleshooting, WORKFLOW examples mentioning `claude.command: symphony-claude` → `claude.command: claude`).

- [ ] **Step 2: Coverage ignore list**

Add to `elixir/mix.exs` `ignore_modules` (IO/process-heavy by design):

```elixir
SymphonyElixir.AgentAvailability,
SymphonyElixir.Claude.AppServer.StdioMain,
SymphonyElixir.Claude.ModelCatalog,
```

(`CliRunner`, `ToolGateway`, `Server`, `Settings`, `AgentPreference` have real suites and stay covered.)

- [ ] **Step 3: Full verification**

Run: `cd elixir && make all` → setup, build, fmt-check, lint, coverage, dialyzer ALL PASS.
Run: `cd elixir && make tracker-ci` → deps, lint, tests, build ALL PASS.
Fix anything red before committing — do not skip dialyzer (new @specs must be accurate).

- [ ] **Step 4: Manual smoke checklist (from the spec)**

With `make serve` running and `npm run build` deployed:
1. Settings page: pick **Claude Code** → availability shows `✓ claude <version>`.
2. New project wizard: agent select shows `Inherit (Claude Code)`; create without pinning.
3. New issue dialog: chip reads `Inherit (Claude)`; create and confirm board shows it.
4. Issue Agent tab: switch the issue to Codex → label `symphony:codex` appears; switch back to Inherit.
5. Assistant: composer badge is a picker; choose Claude Code → model menu lists Opus/Sonnet/Haiku, effort menu hidden; send a message and watch streamed deltas.
6. Issue authoring: dispatch → status string names the resolved agent; goal-mode checkbox only visible when effective agent is Codex.
7. `printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' | ./bin/symphony-claude` answers as `symphony-claude`.

- [ ] **Step 5: Commit**

```bash
git add elixir README.md docs
git commit -m "docs(claude): retire symphony-claude bridge docs; document agent preference chain"
```

---

## Task dependency order

```
1 → 2 → 3 → 4 → 5            (backend chain; strictly ordered)
5 → 6 → 7 → 8 → 9            (UI; 7 only needs 6's AgentChip extraction)
10 → 11 → 12                 (claude backend; independent of 6-9, needs 3 for nothing — parallel-safe with Phase 2/3)
12 + 13 → 14 → 15 → 16       (assistant; 15 needs 5's chain + 9's label sync)
12 + 16 → 17 → 18            (standalone + docs last)
```

## Plan self-review notes (already applied)

- **Spec coverage:** settings store §1.1 → T1-2; chain §1.4-1.5 → T3-5; Settings UI §2.1 → T6; project picker §2.2 → T7-8; task surfaces §2.3 → T9; assistant §2.4 → T13-16; AppServer §3 → T10-12, 17; errors §4 → T2 (probe), T12 (visible failure); tests §5 → per task; compat §6 → T15 (alias), T18 (docs). Goal-mode gating (§2.4 last bullet) → T15 Step 4.3.
- **Known judgment calls for the executor:** exact helper names in `context.ex`/`history.ex` may differ from the greps embedded here — every such step names the grep to run; the TESTS are the contract, not the helper names.
- **Type consistency:** `AgentKind`/`agent_kind` values are always the strings `"codex" | "claude"`; `nil`/`null` means inherit at every level (project front matter, issue label, thread agent, dialog chip `""`).





