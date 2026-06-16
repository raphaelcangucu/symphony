# Smart Preview Port Scheme Implementation Plan

**Goal:** Replace first-free dev-server port allocation with deterministic per-project bands + leased per-issue slots + positional service offsets, so previews get stable, isolated local ports across multiple projects and repos.

**Architecture:** A node-level preview pool (`10000-30000`) is carved into fixed `256`-port bands. Each project leases one band (auto, persisted) or pins its own via `dev_server.port_range`. Each running issue leases a slot inside the band; each serve step occupies a fixed offset inside the slot, so `port = band_start + slot_index*PORTS_PER_SLOT + service_offset`. A pure `PortPlan` computes/falls back on ports; a DB-backed `LeaseStore` owns band/slot assignment; the `Manager` wires them in and the `Reconciler` GCs stale slots.

**Tech Stack:** Elixir/OTP, Ecto + SQLite (local tracker DB), ExUnit. Run from `elixir/`.

**Spec:** `docs/superpowers/specs/2026-06-15-smart-preview-port-scheme-design.md`

---

## Conventions for every task

- Work from the `elixir/` directory: `cd elixir`.
- Run a single test file with: `mix test test/path/to/file_test.exs`.
- Public `def` functions in `lib/` need an adjacent `@spec` (enforced by `mix specs.check`).
- Commit after each task. Do not skip hooks.

## Task 1: Node-level preview pool config

**Files:**
- Modify: `lib/symphony_elixir/instance_config.ex`
- Modify: `lib/symphony_elixir/config.ex`
- Modify: `config/runtime.exs`
- Test: `test/symphony_elixir/instance_config_test.exs`

- [ ] **Step 1: Write failing tests for the InstanceConfig accessors**

Add to `test/symphony_elixir/instance_config_test.exs`. First extend `@keys` with the three new keys so the setup saves/restores them:

```elixir
  @keys [
    :poll_interval_ms,
    :max_concurrent_agents,
    :default_max_turns,
    :server_port,
    :server_port_override,
    :editor_enabled,
    :editor_port,
    :default_agent_kind,
    :preview_pool_range,
    :preview_slots_per_project,
    :preview_ports_per_slot
  ]
```

Then add tests:

```elixir
  test "preview pool falls back to module defaults when env is unset" do
    assert InstanceConfig.preview_pool_range() == [10_000, 30_000]
    assert InstanceConfig.preview_slots_per_project() == 32
    assert InstanceConfig.preview_ports_per_slot() == 8
  end

  test "preview pool reads values from application env" do
    Application.put_env(:symphony_elixir, :preview_pool_range, [20_000, 25_000])
    Application.put_env(:symphony_elixir, :preview_slots_per_project, 16)
    Application.put_env(:symphony_elixir, :preview_ports_per_slot, 4)

    assert InstanceConfig.preview_pool_range() == [20_000, 25_000]
    assert InstanceConfig.preview_slots_per_project() == 16
    assert InstanceConfig.preview_ports_per_slot() == 4
  end

  test "preview pool range rejects malformed env and uses the default" do
    Application.put_env(:symphony_elixir, :preview_pool_range, [30_000, 10_000])
    assert InstanceConfig.preview_pool_range() == [10_000, 30_000]

    Application.put_env(:symphony_elixir, :preview_pool_range, "nope")
    assert InstanceConfig.preview_pool_range() == [10_000, 30_000]
  end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `mix test test/symphony_elixir/instance_config_test.exs`
Expected: FAIL with `UndefinedFunctionError` for `InstanceConfig.preview_pool_range/0`.

- [ ] **Step 3: Implement the InstanceConfig accessors**

In `lib/symphony_elixir/instance_config.ex`, add module attributes near the other defaults (after `@default_agent_kind "codex"`):

```elixir
  @default_preview_pool_range [10_000, 30_000]
  @default_preview_slots_per_project 32
  @default_preview_ports_per_slot 8
```

Add accessor functions (after `default_agent_kind/0`):

```elixir
  @spec preview_pool_range() :: [pos_integer()]
  def preview_pool_range do
    case get(:preview_pool_range, @default_preview_pool_range) do
      [min, max] when is_integer(min) and is_integer(max) and min > 0 and max > min ->
        [min, max]

      _invalid ->
        @default_preview_pool_range
    end
  end

  @spec preview_slots_per_project() :: pos_integer()
  def preview_slots_per_project,
    do: get(:preview_slots_per_project, @default_preview_slots_per_project)

  @spec preview_ports_per_slot() :: pos_integer()
  def preview_ports_per_slot,
    do: get(:preview_ports_per_slot, @default_preview_ports_per_slot)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `mix test test/symphony_elixir/instance_config_test.exs`
Expected: PASS.

- [ ] **Step 5: Delegate from Config**

In `lib/symphony_elixir/config.ex`, after `editor_base_url/0` (~line 824), add:

```elixir
  @spec preview_pool_range() :: [pos_integer()]
  def preview_pool_range, do: InstanceConfig.preview_pool_range()

  @spec preview_slots_per_project() :: pos_integer()
  def preview_slots_per_project, do: InstanceConfig.preview_slots_per_project()

  @spec preview_ports_per_slot() :: pos_integer()
  def preview_ports_per_slot, do: InstanceConfig.preview_ports_per_slot()
```

- [ ] **Step 6: Wire the env vars in runtime.exs**

In `config/runtime.exs`, inside the `if config_env() != :test do` block, add a range parser next to `parse_int`:

```elixir
  parse_range = fn name, default ->
    case System.get_env(name) do
      value when is_binary(value) and value != "" ->
        case String.split(value, "-", parts: 2) do
          [min, max] ->
            with {min_int, ""} <- Integer.parse(String.trim(min)),
                 {max_int, ""} <- Integer.parse(String.trim(max)),
                 true <- min_int > 0 and max_int > min_int do
              [min_int, max_int]
            else
              _ -> default
            end

          _ ->
            default
        end

      _ ->
        default
    end
  end
```

Then add these three keys to the `config :symphony_elixir,` keyword list (e.g. after `default_agent_kind:`):

```elixir
    preview_pool_range: parse_range.("SYMPHONY_PREVIEW_POOL", [10_000, 30_000]),
    preview_slots_per_project: parse_int.("SYMPHONY_PREVIEW_SLOTS_PER_PROJECT", 32),
    preview_ports_per_slot: parse_int.("SYMPHONY_PREVIEW_PORTS_PER_SLOT", 8),
```

- [ ] **Step 7: Verify specs + format**

Run: `mix specs.check && mix format --check-formatted lib/symphony_elixir/instance_config.ex lib/symphony_elixir/config.ex config/runtime.exs`
Expected: no specs violations; files formatted (run `mix format` on them if needed).

- [ ] **Step 8: Commit**

```bash
git add lib/symphony_elixir/instance_config.ex lib/symphony_elixir/config.ex config/runtime.exs test/symphony_elixir/instance_config_test.exs
git commit -m "feat(dev-server): add node-level preview port pool config"
```

---

## Task 2: PortPlan formula

**Files:**
- Create: `lib/symphony_elixir/dev_server/port_plan.ex`
- Test: `test/symphony_elixir/dev_server/port_plan_test.exs`

- [ ] **Step 1: Write the failing test**

Create `test/symphony_elixir/dev_server/port_plan_test.exs`:

```elixir
defmodule SymphonyElixir.DevServer.PortPlanTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.PortPlan

  test "band_size multiplies slots by ports per slot" do
    assert PortPlan.band_size(32, 8) == 256
  end

  test "max_bands divides the pool by the band size" do
    assert PortPlan.max_bands([10_000, 30_000], 256) == 78
    assert PortPlan.max_bands([10_000, 10_100], 256) == 0
  end

  test "band_start offsets from the pool minimum" do
    assert PortPlan.band_start([10_000, 30_000], 0, 256) == 10_000
    assert PortPlan.band_start([10_000, 30_000], 1, 256) == 10_256
  end

  test "port composes band, slot and offset" do
    assert PortPlan.port(10_000, 0, 0, 8) == {:ok, 10_000}
    assert PortPlan.port(10_000, 0, 2, 8) == {:ok, 10_002}
    assert PortPlan.port(10_000, 1, 0, 8) == {:ok, 10_008}
    assert PortPlan.port(10_000, 1, 2, 8) == {:ok, 10_010}
  end

  test "port rejects an offset that does not fit the slot" do
    assert PortPlan.port(10_000, 0, 8, 8) == {:error, :offset_out_of_range}
  end
end
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `mix test test/symphony_elixir/dev_server/port_plan_test.exs`
Expected: FAIL with `UndefinedFunctionError` for `PortPlan.band_size/2`.

- [ ] **Step 3: Implement the module**

Create `lib/symphony_elixir/dev_server/port_plan.ex`:

```elixir
defmodule SymphonyElixir.DevServer.PortPlan do
  @moduledoc """
  Pure helpers for the hierarchical preview port scheme:

      port = band_start + slot_index * ports_per_slot + service_offset

  See `docs/superpowers/specs/2026-06-15-smart-preview-port-scheme-design.md`.
  """

  @spec band_size(pos_integer(), pos_integer()) :: pos_integer()
  def band_size(slots_per_project, ports_per_slot)
      when is_integer(slots_per_project) and slots_per_project > 0 and
             is_integer(ports_per_slot) and ports_per_slot > 0 do
    slots_per_project * ports_per_slot
  end

  @spec max_bands([pos_integer()], pos_integer()) :: non_neg_integer()
  def max_bands([pool_min, pool_max], band_size)
      when is_integer(pool_min) and is_integer(pool_max) and pool_min <= pool_max and
             is_integer(band_size) and band_size > 0 do
    div(pool_max - pool_min + 1, band_size)
  end

  @spec band_start([pos_integer()], non_neg_integer(), pos_integer()) :: pos_integer()
  def band_start([pool_min, _pool_max], band_index, band_size)
      when is_integer(pool_min) and is_integer(band_index) and band_index >= 0 and
             is_integer(band_size) and band_size > 0 do
    pool_min + band_index * band_size
  end

  @spec port(pos_integer(), non_neg_integer(), non_neg_integer(), pos_integer()) ::
          {:ok, pos_integer()} | {:error, :offset_out_of_range}
  def port(band_start, slot_index, service_offset, ports_per_slot)
      when is_integer(band_start) and band_start > 0 and
             is_integer(slot_index) and slot_index >= 0 and
             is_integer(service_offset) and service_offset >= 0 and
             is_integer(ports_per_slot) and ports_per_slot > 0 do
    if service_offset < ports_per_slot do
      {:ok, band_start + slot_index * ports_per_slot + service_offset}
    else
      {:error, :offset_out_of_range}
    end
  end
end
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `mix test test/symphony_elixir/dev_server/port_plan_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/dev_server/port_plan.ex test/symphony_elixir/dev_server/port_plan_test.exs
git commit -m "feat(dev-server): add PortPlan port formula"
```

## Task 3: PortPlan port selection + fallback

This adds the runtime selection logic to `PortPlan`: prefer the computed port, else scan the band, else (auto only) scan the pool. It takes an injectable `allocate` function (defaulting to `PortAllocator.allocate/2`) so it is testable without binding real sockets.

**Files:**
- Modify: `lib/symphony_elixir/dev_server/port_plan.ex`
- Test: `test/symphony_elixir/dev_server/port_plan_test.exs`

- [ ] **Step 1: Write the failing tests**

Append to `test/symphony_elixir/dev_server/port_plan_test.exs` (inside the module). The fake allocator returns the first port in the range not in `claimed`:

```elixir
  defp fake_allocate do
    fn [min, max], claimed ->
      claimed_set = MapSet.new(claimed)

      case Enum.find(min..max//1, &(not MapSet.member?(claimed_set, &1))) do
        nil -> {:error, :no_free_port}
        port -> {:ok, port}
      end
    end
  end

  defp ctx(overrides) do
    Map.merge(
      %{
        band: {10_000, 10_255},
        slot_index: 0,
        ports_per_slot: 8,
        pool_range: [10_000, 30_000],
        auto?: true,
        allocate: fake_allocate()
      },
      Map.new(overrides)
    )
  end

  test "choose_port returns the preferred port when free" do
    assert PortPlan.choose_port(ctx(%{}), 2, []) == {:ok, 10_002}
  end

  test "choose_port scans the band when the preferred port is claimed" do
    assert PortPlan.choose_port(ctx(%{}), 2, [10_002]) == {:ok, 10_000}
  end

  test "choose_port scans the band when there is no slot" do
    assert PortPlan.choose_port(ctx(%{slot_index: nil}), 0, [10_000, 10_001]) == {:ok, 10_002}
  end

  test "choose_port scans the band when the offset does not fit the slot" do
    assert PortPlan.choose_port(ctx(%{}), 8, []) == {:ok, 10_000}
  end

  test "choose_port falls back to the pool for auto bands when the band is full" do
    # band fully claimed; auto? true -> scans pool and finds the first pool port
    band_ports = Enum.to_list(10_000..10_255)
    assert PortPlan.choose_port(ctx(%{}), 2, band_ports) == {:ok, 10_256}
  end

  test "choose_port does not leave the band for pinned (non-auto) projects" do
    band_ports = Enum.to_list(10_000..10_255)
    assert PortPlan.choose_port(ctx(%{auto?: false}), 2, band_ports) == {:error, :no_free_port}
  end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `mix test test/symphony_elixir/dev_server/port_plan_test.exs`
Expected: FAIL with `UndefinedFunctionError` for `PortPlan.choose_port/3`.

- [ ] **Step 3: Implement choose_port and helpers**

Add to `lib/symphony_elixir/dev_server/port_plan.ex`. First add the alias and a context type near the top (after `@moduledoc`):

```elixir
  alias SymphonyElixir.DevServer.PortAllocator

  @type allocate_fun :: ([pos_integer()], [pos_integer()] -> {:ok, pos_integer()} | {:error, term()})

  @type context :: %{
          band: {pos_integer(), pos_integer()},
          slot_index: non_neg_integer() | nil,
          ports_per_slot: pos_integer(),
          pool_range: [pos_integer()],
          auto?: boolean(),
          optional(:allocate) => allocate_fun()
        }
```

Then add the functions:

```elixir
  @spec choose_port(context(), non_neg_integer(), [pos_integer()]) ::
          {:ok, pos_integer()} | {:error, :no_free_port}
  def choose_port(%{slot_index: nil} = ctx, _offset, claimed), do: scan(ctx, claimed)

  def choose_port(%{slot_index: slot_index, ports_per_slot: ports_per_slot} = ctx, offset, claimed) do
    {band_start, _band_end} = ctx.band

    case port(band_start, slot_index, offset, ports_per_slot) do
      {:ok, preferred} ->
        if free?(ctx, preferred, claimed), do: {:ok, preferred}, else: scan(ctx, claimed)

      {:error, :offset_out_of_range} ->
        scan(ctx, claimed)
    end
  end

  defp free?(ctx, candidate, claimed) do
    allocate(ctx).([candidate, candidate], claimed) == {:ok, candidate}
  end

  defp scan(ctx, claimed) do
    {band_start, band_end} = ctx.band

    case allocate(ctx).([band_start, band_end], claimed) do
      {:ok, port} -> {:ok, port}
      {:error, _reason} -> pool_scan(ctx, claimed)
    end
  end

  defp pool_scan(%{auto?: true} = ctx, claimed) do
    case allocate(ctx).(ctx.pool_range, claimed) do
      {:ok, port} -> {:ok, port}
      {:error, _reason} -> {:error, :no_free_port}
    end
  end

  defp pool_scan(_ctx, _claimed), do: {:error, :no_free_port}

  defp allocate(ctx), do: Map.get(ctx, :allocate, &PortAllocator.allocate/2)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `mix test test/symphony_elixir/dev_server/port_plan_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/dev_server/port_plan.ex test/symphony_elixir/dev_server/port_plan_test.exs
git commit -m "feat(dev-server): add PortPlan port selection with band/pool fallback"
```

---

## Task 4: Lease schemas + migration

**Files:**
- Create: `lib/symphony_elixir/local_tracker/preview_band.ex`
- Create: `lib/symphony_elixir/local_tracker/preview_issue_slot.ex`
- Create: `priv/repo/migrations/20260615233000_create_preview_port_leases.exs`

- [ ] **Step 1: Write the migration**

Create `priv/repo/migrations/20260615233000_create_preview_port_leases.exs`:

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreatePreviewPortLeases do
  use Ecto.Migration

  def change do
    create table(:local_tracker_preview_bands) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :band_index, :integer, null: false
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:local_tracker_preview_bands, [:project_id])
    create unique_index(:local_tracker_preview_bands, [:band_index])

    create table(:local_tracker_preview_issue_slots) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :issue_identifier, :string, null: false
      add :slot_index, :integer, null: false
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:local_tracker_preview_issue_slots, [:project_id, :issue_identifier])
    create unique_index(:local_tracker_preview_issue_slots, [:project_id, :slot_index])
  end
end
```

- [ ] **Step 2: Create the PreviewBand schema**

Create `lib/symphony_elixir/local_tracker/preview_band.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.PreviewBand do
  @moduledoc "Per-project reservation of one preview port band index."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}

  schema "local_tracker_preview_bands" do
    field(:band_index, :integer)
    belongs_to(:project, Project)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [:project_id, :band_index])
    |> validate_required([:project_id, :band_index])
    |> validate_number(:band_index, greater_than_or_equal_to: 0)
    |> unique_constraint(:project_id)
    |> unique_constraint(:band_index)
  end
end
```

- [ ] **Step 3: Create the PreviewIssueSlot schema**

Create `lib/symphony_elixir/local_tracker/preview_issue_slot.ex`:

```elixir
defmodule SymphonyElixir.LocalTracker.PreviewIssueSlot do
  @moduledoc "Per-issue lease of one slot index inside a project's preview band."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}

  schema "local_tracker_preview_issue_slots" do
    field(:issue_identifier, :string)
    field(:slot_index, :integer)
    belongs_to(:project, Project)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [:project_id, :issue_identifier, :slot_index])
    |> validate_required([:project_id, :issue_identifier, :slot_index])
    |> validate_number(:slot_index, greater_than_or_equal_to: 0)
    |> unique_constraint([:project_id, :issue_identifier])
    |> unique_constraint([:project_id, :slot_index])
  end
end
```

- [ ] **Step 4: Run the migration against the test DB and compile**

Run: `mix ecto.migrate && mix compile --warnings-as-errors`
Expected: migration applies cleanly; no compile warnings.

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/local_tracker/preview_band.ex lib/symphony_elixir/local_tracker/preview_issue_slot.ex priv/repo/migrations/20260615233000_create_preview_port_leases.exs
git commit -m "feat(dev-server): add preview band and issue-slot lease tables"
```

## Task 5: LeaseStore (band + slot leasing policy)

**Files:**
- Create: `lib/symphony_elixir/dev_server/lease_store.ex`
- Test: `test/symphony_elixir/dev_server/lease_store_test.exs`

- [ ] **Step 1: Write the failing tests**

Create `test/symphony_elixir/dev_server/lease_store_test.exs`:

```elixir
defmodule SymphonyElixir.DevServer.LeaseStoreTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.DevServer.LeaseStore
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()

    {:ok, project_a} = create_project("a")
    {:ok, project_b} = create_project("b")

    {:ok, project_a: project_a, project_b: project_b}
  end

  test "ensure_band assigns the lowest free index and is stable", %{project_a: a, project_b: b} do
    assert {:ok, 0} = LeaseStore.ensure_band(a.id, 78)
    assert {:ok, 0} = LeaseStore.ensure_band(a.id, 78)
    assert {:ok, 1} = LeaseStore.ensure_band(b.id, 78)
  end

  test "ensure_band returns no_free_band when the pool is exhausted", %{project_a: a, project_b: b} do
    assert {:ok, 0} = LeaseStore.ensure_band(a.id, 1)
    assert {:error, :no_free_band} = LeaseStore.ensure_band(b.id, 1)
  end

  test "ensure_slot assigns lowest free per project and is stable per issue", %{project_a: a} do
    assert {:ok, 0} = LeaseStore.ensure_slot(a.id, "1", 32)
    assert {:ok, 0} = LeaseStore.ensure_slot(a.id, "1", 32)
    assert {:ok, 1} = LeaseStore.ensure_slot(a.id, "2", 32)
  end

  test "ensure_slot reuses a freed index after release", %{project_a: a} do
    assert {:ok, 0} = LeaseStore.ensure_slot(a.id, "1", 32)
    assert {:ok, 1} = LeaseStore.ensure_slot(a.id, "2", 32)
    assert :ok = LeaseStore.release_slot(a.id, "1")
    assert {:ok, 0} = LeaseStore.ensure_slot(a.id, "3", 32)
  end

  test "ensure_slot returns no_free_slot when the band is full", %{project_a: a} do
    assert {:ok, 0} = LeaseStore.ensure_slot(a.id, "1", 1)
    assert {:error, :no_free_slot} = LeaseStore.ensure_slot(a.id, "2", 1)
  end

  test "ensure_slot returns no_free_slot when zero slots are available", %{project_a: a} do
    assert {:error, :no_free_slot} = LeaseStore.ensure_slot(a.id, "1", 0)
  end

  test "slot_for_issue reflects current lease state", %{project_a: a} do
    assert :error = LeaseStore.slot_for_issue(a.id, "1")
    assert {:ok, 0} = LeaseStore.ensure_slot(a.id, "1", 32)
    assert {:ok, 0} = LeaseStore.slot_for_issue(a.id, "1")
    assert :ok = LeaseStore.release_slot(a.id, "1")
    assert :error = LeaseStore.slot_for_issue(a.id, "1")
  end

  test "leased_issue_slots lists every active lease with project and identifier", %{
    project_a: a,
    project_b: b
  } do
    {:ok, 0} = LeaseStore.ensure_slot(a.id, "1", 32)
    {:ok, 0} = LeaseStore.ensure_slot(b.id, "9", 32)

    pairs =
      LeaseStore.leased_issue_slots()
      |> Enum.map(fn {project_id, identifier, _inserted_at} -> {project_id, identifier} end)
      |> Enum.sort()

    assert pairs == Enum.sort([{a.id, "1"}, {b.id, "9"}])
  end

  defp create_project(slug) do
    Context.create_workspace_project(%{
      "name" => String.upcase(slug),
      "slug" => slug,
      "workflow_statuses" => [
        %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}
      ],
      "repositories" => [],
      "setup" => %{}
    })
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo, do: SymphonyElixir.TestSupport.truncate_tracker!(Repo)
end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `mix test test/symphony_elixir/dev_server/lease_store_test.exs`
Expected: FAIL with `UndefinedFunctionError` for `LeaseStore.ensure_band/2`.

- [ ] **Step 3: Implement LeaseStore**

Create `lib/symphony_elixir/dev_server/lease_store.ex`:

```elixir
defmodule SymphonyElixir.DevServer.LeaseStore do
  @moduledoc """
  DB-backed leasing of preview port bands (per project) and slots (per issue).

  Band leases are permanent once assigned; slot leases are released on stop and
  reclaimed by the reconciler GC. Lowest-free assignment is used for both. The
  caller (`DevServer.Manager`) serializes acquisition under a global lock; the
  unique constraints + a single recompute-and-retry guard against the rare race.
  """

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.{PreviewBand, PreviewIssueSlot}
  alias SymphonyElixir.Repo

  @spec ensure_band(integer(), non_neg_integer()) :: {:ok, non_neg_integer()} | {:error, :no_free_band}
  def ensure_band(project_id, max_bands) when is_integer(project_id) and is_integer(max_bands) do
    case existing_band(project_id) do
      index when is_integer(index) -> {:ok, index}
      nil -> assign_band(project_id, max_bands)
    end
  end

  @spec ensure_slot(integer(), String.t(), non_neg_integer()) ::
          {:ok, non_neg_integer()} | {:error, :no_free_slot}
  def ensure_slot(project_id, identifier, slots)
      when is_integer(project_id) and is_binary(identifier) and is_integer(slots) do
    case existing_slot(project_id, identifier) do
      index when is_integer(index) -> {:ok, index}
      nil -> assign_slot(project_id, identifier, slots)
    end
  end

  @spec release_slot(integer(), String.t()) :: :ok
  def release_slot(project_id, identifier) when is_integer(project_id) and is_binary(identifier) do
    Repo.delete_all(
      from(s in PreviewIssueSlot,
        where: s.project_id == ^project_id and s.issue_identifier == ^identifier
      )
    )

    :ok
  end

  @spec slot_for_issue(integer(), String.t()) :: {:ok, non_neg_integer()} | :error
  def slot_for_issue(project_id, identifier)
      when is_integer(project_id) and is_binary(identifier) do
    case existing_slot(project_id, identifier) do
      index when is_integer(index) -> {:ok, index}
      nil -> :error
    end
  end

  @spec leased_issue_slots() :: [{integer(), String.t(), DateTime.t()}]
  def leased_issue_slots do
    Repo.all(
      from(s in PreviewIssueSlot, select: {s.project_id, s.issue_identifier, s.inserted_at})
    )
  end

  defp existing_band(project_id) do
    Repo.one(from(b in PreviewBand, where: b.project_id == ^project_id, select: b.band_index))
  end

  defp existing_slot(project_id, identifier) do
    Repo.one(
      from(s in PreviewIssueSlot,
        where: s.project_id == ^project_id and s.issue_identifier == ^identifier,
        select: s.slot_index
      )
    )
  end

  defp assign_band(_project_id, max_bands) when max_bands <= 0, do: {:error, :no_free_band}

  defp assign_band(project_id, max_bands) do
    used = MapSet.new(Repo.all(from(b in PreviewBand, select: b.band_index)))

    case Enum.find(0..(max_bands - 1)//1, &(not MapSet.member?(used, &1))) do
      nil ->
        {:error, :no_free_band}

      index ->
        case Repo.insert(PreviewBand.changeset(%PreviewBand{}, %{project_id: project_id, band_index: index})) do
          {:ok, _record} -> {:ok, index}
          {:error, _changeset} -> ensure_band(project_id, max_bands)
        end
    end
  end

  defp assign_slot(_project_id, _identifier, slots) when slots <= 0, do: {:error, :no_free_slot}

  defp assign_slot(project_id, identifier, slots) do
    used =
      MapSet.new(
        Repo.all(from(s in PreviewIssueSlot, where: s.project_id == ^project_id, select: s.slot_index))
      )

    case Enum.find(0..(slots - 1)//1, &(not MapSet.member?(used, &1))) do
      nil ->
        {:error, :no_free_slot}

      index ->
        attrs = %{project_id: project_id, issue_identifier: identifier, slot_index: index}

        case Repo.insert(PreviewIssueSlot.changeset(%PreviewIssueSlot{}, attrs)) do
          {:ok, _record} -> {:ok, index}
          {:error, _changeset} -> ensure_slot(project_id, identifier, slots)
        end
    end
  end
end
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `mix test test/symphony_elixir/dev_server/lease_store_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/dev_server/lease_store.ex test/symphony_elixir/dev_server/lease_store_test.exs
git commit -m "feat(dev-server): add LeaseStore for band and slot leasing"
```

---

## Task 6: Per-project `port_range` becomes an optional pin

Today the per-project `dev_server.port_range` defaults to `[4100, 4199]`, so an omitted value is indistinguishable from an explicit one. Change the default to `nil` so omitting it means "auto-lease from the pool" while an explicit list pins the band. Keep the node-level `Config.dev_server_port_range/0` fallback intact for the `Instance` default allocator path.

**Files:**
- Modify: `lib/symphony_elixir/config.ex`
- Test: `test/symphony_elixir/config_test.exs`

- [ ] **Step 1: Write the failing tests**

Add to `test/symphony_elixir/config_test.exs`:

```elixir
  test "per-project dev_server port_range defaults to nil (auto pool)" do
    opts = Config.validate_front_matter(%{"dev_server" => %{"enabled" => true}})
    assert get_in(opts, [:dev_server, :port_range]) == nil
  end

  test "per-project dev_server port_range keeps an explicit pin" do
    opts =
      Config.validate_front_matter(%{
        "dev_server" => %{"enabled" => true, "port_range" => [4100, 4199]}
      })

    assert get_in(opts, [:dev_server, :port_range]) == [4100, 4199]
  end
```

(If `config_test.exs` does not already alias `Config`, it does via `SymphonyElixir.Config`; use the fully-qualified name if needed.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `mix test test/symphony_elixir/config_test.exs`
Expected: FAIL — the first test gets `[4100, 4199]` (the old default) instead of `nil`.

- [ ] **Step 3: Change the schema default**

In `lib/symphony_elixir/config.ex`, find the dev_server `port_range` key in the NimbleOptions schema (currently `port_range: [type: {:list, :pos_integer}, default: @default_dev_server_port_range]`, ~line 257) and change it to:

```elixir
                                 port_range: [
                                   type: {:or, [{:list, :pos_integer}, nil]},
                                   default: nil
                                 ],
```

- [ ] **Step 4: Keep the node-level fallback non-nil**

In `lib/symphony_elixir/config.ex`, update `dev_server_port_range/0` (~line 832) to coalesce the now-nillable value back to the historical default so the `Instance` default allocator path never receives `nil`:

```elixir
  @spec dev_server_port_range() :: [pos_integer()]
  def dev_server_port_range do
    get_in(validated_workflow_options(), [:dev_server, :port_range]) || @default_dev_server_port_range
  end
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `mix test test/symphony_elixir/config_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/symphony_elixir/config.ex test/symphony_elixir/config_test.exs
git commit -m "feat(dev-server): treat per-project port_range as an optional band pin"
```

## Task 7: Manager — lease + plan port allocation

Rewrite `reserve_ports/4` to build an allocation context (band + slot via `LeaseStore`, pinned vs auto) and compute each step's port via `PortPlan.choose_port/3`. Update the two callers to pass the `project` struct (the lease needs `project.id`).

**Files:**
- Modify: `lib/symphony_elixir/dev_server/manager.ex`
- Test: `test/symphony_elixir/dev_server/manager_test.exs`

- [ ] **Step 1: Write the failing tests**

Add to `test/symphony_elixir/dev_server/manager_test.exs`. These drive the real `start_for_issue` path with crashing serve steps (missing dirs) so no tmux server is needed, and assert the lease side effects. Add an auto-mode enable helper and the tests:

```elixir
  defp enable_project_dev_server_auto!(project) do
    workflow_markdown =
      SymphonyElixir.Workflow.to_markdown(
        %{"dev_server" => %{"enabled" => true, "idle_timeout_ms" => 60_000}},
        ""
      )

    {:ok, _setup} =
      Context.upsert_project_setup(project.slug, %{"workflow_markdown" => workflow_markdown})

    :ok
  end

  defp prepare_workspace!(identifier) do
    workspace = SymphonyElixir.Workspace.path_for_issue(identifier)
    File.rm_rf!(workspace)
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf(workspace) end)
    workspace
  end

  test "auto-mode start leases a band and a per-issue slot", %{project: project} do
    alias SymphonyElixir.DevServer.LeaseStore

    enable_project_dev_server_auto!(project)
    prepare_workspace!("1")
    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Broken", command: "npm run dev", role: "serve", working_dir: "missing"}
      ])

    assert Manager.start_for_issue(project.slug, "#1") == {:error, :crashed}
    assert {:ok, 0} = LeaseStore.ensure_band(project.id, 78)
    assert {:ok, 0} = LeaseStore.slot_for_issue(project.id, "1")
    assert Manager.live_ports() == []
  end

  test "auto-mode gives distinct slots to distinct issues", %{project: project} do
    alias SymphonyElixir.DevServer.LeaseStore

    enable_project_dev_server_auto!(project)
    prepare_workspace!("1")
    prepare_workspace!("2")
    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Broken", command: "npm run dev", role: "serve", working_dir: "missing"}
      ])

    assert Manager.start_for_issue(project.slug, "#1") == {:error, :crashed}
    assert Manager.start_for_issue(project.slug, "#2") == {:error, :crashed}

    assert {:ok, 0} = LeaseStore.slot_for_issue(project.id, "1")
    assert {:ok, 1} = LeaseStore.slot_for_issue(project.id, "2")
  end

  test "pinned port_range still leases a slot inside the pinned band", %{project: project} do
    alias SymphonyElixir.DevServer.LeaseStore

    enable_project_dev_server!(project, port_range: [4100, 4199], max_concurrent: 2)
    prepare_workspace!("1")
    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Broken", command: "npm run dev", role: "serve", working_dir: "missing"}
      ])

    assert Manager.start_for_issue(project.slug, "#1") == {:error, :crashed}
    # pinned projects do not consume an auto band index
    assert [] = SymphonyElixir.Repo.all(SymphonyElixir.LocalTracker.PreviewBand)
    assert {:ok, 0} = LeaseStore.slot_for_issue(project.id, "1")
  end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `mix test test/symphony_elixir/dev_server/manager_test.exs`
Expected: FAIL — slots are never leased yet (`slot_for_issue` returns `:error`).

- [ ] **Step 3: Add aliases**

In `lib/symphony_elixir/dev_server/manager.ex`, extend the alias for `DevServer` modules (currently `alias SymphonyElixir.DevServer.Instance` and `alias SymphonyElixir.DevServer.PortAllocator`):

```elixir
  alias SymphonyElixir.DevServer.Instance
  alias SymphonyElixir.DevServer.LeaseStore
  alias SymphonyElixir.DevServer.PortAllocator
  alias SymphonyElixir.DevServer.PortPlan
```

- [ ] **Step 4: Update the two callers to pass the project struct**

In `do_start_for_issue/3` (~line 207-214), change the `reserve_ports` call:

```elixir
  defp do_start_for_issue(project, identifier, runtime_options) do
    with {:ok, workspace_path} <- issue_workspace_path(identifier),
         {:ok, serve_steps} <- serve_steps(project.slug, identifier),
         {:ok, reserved_steps} <-
           reserve_ports(project, identifier, serve_steps, runtime_options.dev_server_port_range) do
      setup_issue_session(project.slug, identifier, workspace_path)
      start_instances(project, identifier, workspace_path, reserved_steps, runtime_options)
    end
  end
```

In `do_start_instance_for_server/4` (~line 216-237), change the `reserve_ports` call (the rest of the function is unchanged):

```elixir
               {:ok, reserved_steps} <-
                 reserve_ports(project, identifier, [step], runtime_options.dev_server_port_range),
```

- [ ] **Step 5: Replace `reserve_ports/4` and add the allocation helpers**

Replace the existing `reserve_ports/4` (~line 301-321) with:

```elixir
  defp reserve_ports(project, identifier, serve_steps, port_range) do
    ctx = allocation_context(project, identifier, port_range)
    reserve_with_context(project.slug, identifier, serve_steps, ctx)
  end

  defp reserve_with_context(project_slug, identifier, serve_steps, ctx) do
    serve_steps
    |> Enum.with_index()
    |> Enum.reduce_while({:ok, []}, fn {step, offset}, {:ok, reserved_steps} ->
      claimed = live_ports() ++ Enum.map(reserved_steps, fn {_step, port, _key} -> port end)

      case PortPlan.choose_port(ctx, offset, claimed) do
        {:ok, port} ->
          key = {project_slug, identifier, Map.fetch!(step, :slug)}
          reserve_port_for_key(key, port)
          {:cont, {:ok, [{step, port, key} | reserved_steps]}}

        {:error, _reason} ->
          release_reserved_steps(reserved_steps)
          {:halt, {:error, :no_free_port}}
      end
    end)
    |> case do
      {:ok, reserved_steps} -> {:ok, Enum.reverse(reserved_steps)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp allocation_context(project, identifier, port_range) do
    pool = preview_pool_config()

    case pinned_band(port_range, pool.ports_per_slot) do
      {:ok, band_start, band_end, slots} ->
        slot_index = lease_slot(project.id, identifier, slots)

        %{
          band: {band_start, band_end},
          slot_index: slot_index,
          ports_per_slot: pool.ports_per_slot,
          pool_range: pool.pool_range,
          auto?: false
        }

      :auto ->
        auto_context(project, identifier, pool)
    end
  end

  defp auto_context(project, identifier, pool) do
    band_size = PortPlan.band_size(pool.slots_per_project, pool.ports_per_slot)
    max_bands = PortPlan.max_bands(pool.pool_range, band_size)

    case LeaseStore.ensure_band(project.id, max_bands) do
      {:ok, band_index} ->
        band_start = PortPlan.band_start(pool.pool_range, band_index, band_size)
        slot_index = lease_slot(project.id, identifier, pool.slots_per_project)

        %{
          band: {band_start, band_start + band_size - 1},
          slot_index: slot_index,
          ports_per_slot: pool.ports_per_slot,
          pool_range: pool.pool_range,
          auto?: true
        }

      {:error, :no_free_band} ->
        Logger.warning("Dev server preview bands exhausted; scanning pool project=#{project.slug}")
        [pool_min, pool_max] = pool.pool_range

        %{
          band: {pool_min, pool_max},
          slot_index: nil,
          ports_per_slot: pool.ports_per_slot,
          pool_range: pool.pool_range,
          auto?: true
        }
    end
  end

  defp pinned_band(port_range, ports_per_slot) do
    case port_range do
      [a, b] when is_integer(a) and is_integer(b) and a > 0 and b > 0 ->
        band_min = min(a, b)
        band_max = max(a, b)
        slots = div(band_max - band_min + 1, ports_per_slot)
        {:ok, band_min, band_max, slots}

      _auto ->
        :auto
    end
  end

  defp lease_slot(project_id, identifier, slots) do
    case LeaseStore.ensure_slot(project_id, identifier, slots) do
      {:ok, slot_index} ->
        slot_index

      {:error, :no_free_slot} ->
        Logger.warning(
          "Dev server preview slots exhausted; scanning band project_id=#{project_id} issue=#{identifier}"
        )

        nil
    end
  end

  defp preview_pool_config do
    %{
      pool_range: Config.preview_pool_range(),
      slots_per_project: Config.preview_slots_per_project(),
      ports_per_slot: Config.preview_ports_per_slot()
    }
  end
```

- [ ] **Step 6: Run the new + existing manager tests**

Run: `mix test test/symphony_elixir/dev_server/manager_test.exs`
Expected: PASS for the new tests, and the existing crash/rollback tests (which use pinned `[4100, 4101]`) still pass.

- [ ] **Step 7: Verify specs + format**

Run: `mix specs.check && mix format --check-formatted lib/symphony_elixir/dev_server/manager.ex`
Expected: clean (run `mix format lib/symphony_elixir/dev_server/manager.ex` if needed).

- [ ] **Step 8: Commit**

```bash
git add lib/symphony_elixir/dev_server/manager.ex test/symphony_elixir/dev_server/manager_test.exs
git commit -m "feat(dev-server): allocate preview ports via leased bands and slots"
```

## Task 8: Manager — release the slot lease on stop

`stop_for_issue/2` stops all of an issue's instances, so it releases the slot. `stop_instance_for_server` (single server) only releases the slot when no instances remain for the issue. Also add `running_issue_keys/0` for the reconciler GC (Task 9).

**Files:**
- Modify: `lib/symphony_elixir/dev_server/manager.ex`
- Test: `test/symphony_elixir/dev_server/manager_test.exs`

- [ ] **Step 1: Write the failing test**

Add to `test/symphony_elixir/dev_server/manager_test.exs`:

```elixir
  test "stop_for_issue releases the issue slot lease", %{project: project} do
    alias SymphonyElixir.DevServer.LeaseStore

    enable_project_dev_server_auto!(project)
    prepare_workspace!("1")
    ensure_manager_started!()

    {:ok, _steps} =
      DevEnv.save_steps(project.slug, [
        %{description: "Broken", command: "npm run dev", role: "serve", working_dir: "missing"}
      ])

    assert Manager.start_for_issue(project.slug, "#1") == {:error, :crashed}
    assert {:ok, 0} = LeaseStore.slot_for_issue(project.id, "1")

    assert :ok = Manager.stop_for_issue(project.slug, "#1")
    assert :error = LeaseStore.slot_for_issue(project.id, "1")
  end

  test "running_issue_keys is empty with no live instances" do
    ensure_manager_started!()
    assert Manager.running_issue_keys() == MapSet.new()
  end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `mix test test/symphony_elixir/dev_server/manager_test.exs`
Expected: FAIL — `stop_for_issue` does not release the slot yet; `running_issue_keys/0` is undefined.

- [ ] **Step 3: Release the slot in `stop_for_issue/2`**

In `lib/symphony_elixir/dev_server/manager.ex`, update `stop_for_issue/2` (~line 84-96):

```elixir
  def stop_for_issue(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    identifier = canonical_identifier(identifier)

    project_slug
    |> registered_instance_pids(identifier)
    |> Enum.each(&stop_instance/1)

    project_slug
    |> reservation_keys_for_issue(identifier)
    |> release_reservations()

    release_issue_slot(project_slug, identifier)

    :ok
  end
```

- [ ] **Step 4: Conditionally release in `do_stop_instance_for_server/3`**

Update `do_stop_instance_for_server/3` (~line 239-250):

```elixir
  defp do_stop_instance_for_server(project_slug, identifier, slug)
       when is_binary(project_slug) and is_binary(identifier) and is_binary(slug) do
    key = instance_key(project_slug, identifier, slug)

    case Registry.lookup(@registry, key) do
      [{pid, _}] -> stop_instance(pid)
      [] -> :ok
    end

    release_reservations([key])

    if registered_instance_pids(project_slug, identifier) == [] do
      release_issue_slot(project_slug, identifier)
    end

    :ok
  end
```

- [ ] **Step 5: Add the helpers**

Add `release_issue_slot/2` and the public `running_issue_keys/0`. Put `release_issue_slot/2` near the other private helpers, and `running_issue_keys/0` next to `live_ports/0` (~line 192):

```elixir
  @spec running_issue_keys() :: MapSet.t({String.t(), String.t()})
  def running_issue_keys do
    @registry
    |> all_registry_entries()
    |> Enum.map(fn {{project_slug, identifier, _step_slug}, _pid} -> {project_slug, identifier} end)
    |> MapSet.new()
  end
```

```elixir
  defp release_issue_slot(project_slug, identifier) do
    case Context.get_project(project_slug) do
      {:ok, project} -> LeaseStore.release_slot(project.id, identifier)
      {:error, _reason} -> :ok
    end
  end
```

(`Context` is already aliased in the module.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `mix test test/symphony_elixir/dev_server/manager_test.exs`
Expected: PASS (new + existing).

- [ ] **Step 7: Verify specs + format, then commit**

```bash
mix specs.check && mix format lib/symphony_elixir/dev_server/manager.ex
git add lib/symphony_elixir/dev_server/manager.ex test/symphony_elixir/dev_server/manager_test.exs
git commit -m "feat(dev-server): release preview slot lease on stop"
```

---

## Task 9: Reconciler — GC stale slots

A leased slot can outlive its preview when an instance idle-times-out (no `stop_for_issue`). GC reclaims slots whose issue is no longer "alive" (not in the reconciler's fetched wait-state set and has no running instance), after a grace period that protects in-flight startups. The decision is a pure, testable function; the wiring is thin and guarded like the rest of the reconciler.

**Files:**
- Modify: `lib/symphony_elixir/dev_server/reconciler.ex`
- Create: `test/symphony_elixir/dev_server/reconciler_gc_test.exs`

- [ ] **Step 1: Write the failing test for the pure helper**

Create `test/symphony_elixir/dev_server/reconciler_gc_test.exs`:

```elixir
defmodule SymphonyElixir.DevServer.ReconcilerGcTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.Reconciler

  @now ~U[2026-06-15 23:30:00.000000Z]
  @old DateTime.add(@now, -300, :second)
  @fresh DateTime.add(@now, -10, :second)

  test "releases slots not alive and older than the grace period" do
    leased = [{"p", "1", @old}]
    assert Reconciler.slots_to_release(leased, MapSet.new(), @now) == [{"p", "1"}]
  end

  test "keeps slots whose issue is alive" do
    leased = [{"p", "1", @old}]
    alive = MapSet.new([{"p", "1"}])
    assert Reconciler.slots_to_release(leased, alive, @now) == []
  end

  test "keeps slots that are still within the grace period" do
    leased = [{"p", "1", @fresh}]
    assert Reconciler.slots_to_release(leased, MapSet.new(), @now) == []
  end
end
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `mix test test/symphony_elixir/dev_server/reconciler_gc_test.exs`
Expected: FAIL with `UndefinedFunctionError` for `Reconciler.slots_to_release/3`.

- [ ] **Step 3: Implement the pure helper + wiring**

In `lib/symphony_elixir/dev_server/reconciler.ex`, add the alias and module attribute near the top (after `@fallback_poll_interval_ms`):

```elixir
  alias SymphonyElixir.DevServer.LeaseStore

  @slot_gc_grace_seconds 120
```

Add the public pure function (near the other `@doc false` helpers):

```elixir
  @doc false
  @spec slots_to_release([{String.t(), String.t(), DateTime.t()}], MapSet.t(), DateTime.t()) ::
          [{String.t(), String.t()}]
  def slots_to_release(leased, alive, now) when is_list(leased) and is_map(alive) do
    leased
    |> Enum.filter(fn {project_slug, identifier, inserted_at} ->
      not MapSet.member?(alive, {project_slug, identifier}) and
        DateTime.diff(now, inserted_at, :second) >= @slot_gc_grace_seconds
    end)
    |> Enum.map(fn {project_slug, identifier, _inserted_at} -> {project_slug, identifier} end)
  end
```

Hook GC into the tick by extending `run_cycle/0` (~line 115-126) to also sweep slots:

```elixir
  defp run_cycle do
    auto_start_on = configured_auto_start_triggers()

    wait_state_issues = fetch_wait_state_issues()

    if known_trigger_requested?(auto_start_on) do
      issue_index = issue_index(wait_state_issues)

      auto_start_on
      |> reconcile(candidates(auto_start_on, wait_state_issues))
      |> Enum.each(&start_candidate(&1, issue_index))
    end

    gc_preview_slots(wait_state_issues)
  end
```

Add the GC wiring (private). It maps leased `project_id` to slug, builds the alive set from wait-state issues plus running instances, and releases the rest:

```elixir
  defp gc_preview_slots(wait_state_issues) do
    leased = LeaseStore.leased_issue_slots()

    if leased != [] do
      slugs_by_id = Map.new(Context.list_projects(), &{&1.id, &1.slug})

      leased_with_slug =
        Enum.flat_map(leased, fn {project_id, identifier, inserted_at} ->
          case Map.get(slugs_by_id, project_id) do
            nil -> [{nil, project_id, identifier}]
            slug -> [{slug, identifier, inserted_at, project_id}]
          end
        end)

      {orphaned, resolvable} =
        Enum.split_with(leased_with_slug, fn
          {nil, _project_id, _identifier} -> true
          _resolved -> false
        end)

      # Slots whose project no longer exists are always released.
      Enum.each(orphaned, fn {nil, project_id, identifier} ->
        LeaseStore.release_slot(project_id, identifier)
      end)

      alive = alive_issue_keys(wait_state_issues)
      now = DateTime.utc_now()

      ids_by_slug_identifier =
        Map.new(resolvable, fn {slug, identifier, _inserted_at, project_id} ->
          {{slug, identifier}, project_id}
        end)

      resolvable
      |> Enum.map(fn {slug, identifier, inserted_at, _project_id} -> {slug, identifier, inserted_at} end)
      |> slots_to_release(alive, now)
      |> Enum.each(fn {slug, identifier} = key ->
        project_id = Map.fetch!(ids_by_slug_identifier, key)
        LeaseStore.release_slot(project_id, identifier)
      end)
    end
  rescue
    exception -> Logger.debug("Dev server preview slot GC skipped reason=#{inspect(exception)}")
  catch
    kind, reason -> Logger.debug("Dev server preview slot GC skipped reason=#{inspect({kind, reason})}")
  end

  defp alive_issue_keys(wait_state_issues) do
    from_issues =
      Enum.flat_map(wait_state_issues, fn issue ->
        with slug when is_binary(slug) <- project_slug_for(issue),
             identifier when is_binary(identifier) <- issue_identifier(issue) do
          [{slug, identifier}]
        else
          _missing -> []
        end
      end)

    MapSet.union(MapSet.new(from_issues), Manager.running_issue_keys())
  end
```

Note: `Manager`, `Context`, `Logger`, `project_slug_for/1`, and `issue_identifier/1` are already available in this module.

- [ ] **Step 4: Run the GC test to verify it passes**

Run: `mix test test/symphony_elixir/dev_server/reconciler_gc_test.exs`
Expected: PASS.

- [ ] **Step 5: Compile + specs + format**

Run: `mix compile --warnings-as-errors && mix specs.check && mix format lib/symphony_elixir/dev_server/reconciler.ex`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/symphony_elixir/dev_server/reconciler.ex test/symphony_elixir/dev_server/reconciler_gc_test.exs
git commit -m "feat(dev-server): GC stale preview slot leases in the reconciler"
```

## Task 10: Docs + full gate

Per `elixir/AGENTS.md`, config/behavior changes update docs in the same change.

**Files:**
- Modify: `elixir/.env.example`
- Modify: `elixir/README.md`
- Modify: `docs/superpowers/specs/2026-06-15-smart-preview-port-scheme-design.md` (status only)

- [ ] **Step 1: Document the new env vars**

In `elixir/.env.example`, add (near other `SYMPHONY_*` dev-server/editor settings):

```bash
# Preview port pool (node-level). Bands of SLOTS_PER_PROJECT * PORTS_PER_SLOT
# ports are carved from this range; each project leases one band and each
# running issue leases a slot. Keep below the OS ephemeral range (32768+).
SYMPHONY_PREVIEW_POOL=10000-30000
SYMPHONY_PREVIEW_SLOTS_PER_PROJECT=32
SYMPHONY_PREVIEW_PORTS_PER_SLOT=8
```

- [ ] **Step 2: Document the scheme in the Elixir README**

In `elixir/README.md`, in the dev-server / preview section, add a short subsection explaining: the node-level pool and the three env vars; that omitting per-project `dev_server.port_range` auto-leases a band from the pool while setting it pins that exact range (carved into slots); and the migration note that projects which previously relied on the `[4100, 4199]` default will now auto-lease in the `10000-30000` range (preview tunnel hostnames are unchanged; only local `127.0.0.1:<port>` URLs move). Set `dev_server.port_range: [4100, 4199]` explicitly to keep the old neighborhood.

- [ ] **Step 3: Flip the spec status to Accepted**

In `docs/superpowers/specs/2026-06-15-smart-preview-port-scheme-design.md`, change the `Status` line from `Draft (pending spec review)` to `Accepted` (the user approved it before planning).

- [ ] **Step 4: Run the full gate**

Run: `mix all`
Expected: format check, lint (Credo), full test suite, coverage, and Dialyzer all pass. Then:

Run: `mix specs.check`
Expected: no `@spec` violations.

If `make all` is the canonical entrypoint, run `make all` instead from `elixir/`.

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md ../docs/superpowers/specs/2026-06-15-smart-preview-port-scheme-design.md
git commit -m "docs(dev-server): document preview port pool config and migration"
```

---

## Definition of done

- Two projects with auto-leased bands never share ports; a project's issues get distinct slots while running.
- The same project+issue+service resolves to the same local port across stop/start while the issue is running.
- Setting `dev_server.port_range` pins a project to that range (carved into slots); omitting it auto-leases from `10000-30000`.
- Slots are released on `stop_for_issue`, and idle-leaked slots are GC'd after the grace period without disrupting running previews.
- `mix all` (or `make all`) and `mix specs.check` pass; docs and `.env.example` updated.


