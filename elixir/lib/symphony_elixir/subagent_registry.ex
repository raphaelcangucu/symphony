defmodule SymphonyElixir.SubagentRegistry do
  @moduledoc """
  Derives the *waiting* subagent units of in-flight coordinator parents from the
  orchestrator snapshot plus live tracker state.

  A coordinator parent (e.g. `510`) and its `child_run` units may share a
  board status, but only the dependency-free unit runs a live agent. The
  dependent siblings must be parked cheaply — no agent, no tokens — yet remain
  visible to the operator as *waiting sessions* nested under the parent. This
  module projects exactly those waiting units so the observability feed and the
  per-issue execution badge can render them.

  `:live` units are already represented by real orchestrator run entries and
  `:done`/`:ready` units need no projection here, so only `:waiting` units are
  returned. All tracker reads are injectable so the projection is exercised
  without a database in tests.
  """

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Orchestrator.BundleCoordinator
  alias SymphonyElixir.Orchestrator.SubagentPlan
  alias SymphonyElixir.Settings.Lab, as: LabSettings
  alias SymphonyElixir.Workpad.ExecutionBundle

  @type waiting_record :: %{
          parent_identifier: String.t(),
          project_slug: String.t() | nil,
          unit_id: String.t(),
          issue_identifier: String.t(),
          issue_id: String.t() | nil,
          repo: String.t() | nil,
          status: :waiting,
          blocked_by: [String.t()],
          pending_contracts: [String.t()],
          state: String.t() | nil,
          last_message: String.t()
        }

  @doc "Waiting subagents derived from the default orchestrator snapshot."
  @spec waiting_subagents() :: [waiting_record()]
  def waiting_subagents do
    case SymphonyElixir.Orchestrator.snapshot() do
      %{running: _} = snapshot -> waiting_subagents(snapshot, [])
      _ -> []
    end
  end

  @doc """
  Waiting subagents derived from a given snapshot.

  Options inject tracker reads (each defaulting to a `Context`-backed function):

    * `:bundle_loader` — `(parent_identifier -> {:ok, ExecutionBundle.t()} | :error)`
    * `:slug_resolver` — `(issue_identifier -> String.t() | nil)`
    * `:terminal_resolver` — `(issue_identifier -> boolean())`
    * `:state_resolver` — `(issue_identifier -> String.t() | nil)`
    * `:issue_id_resolver` — `(issue_identifier -> String.t() | nil)`
  """
  @spec waiting_subagents(map(), keyword()) :: [waiting_record()]
  def waiting_subagents(snapshot, opts \\ [])

  def waiting_subagents(%{running: _} = snapshot, opts) do
    if lab_bundle_child_orchestration?(opts) do
      do_waiting_subagents(snapshot, opts)
    else
      []
    end
  end

  def waiting_subagents(_snapshot, _opts), do: []

  @doc """
  Live native subagent rows for unified parent runs (`bundle_role: :parent_unified`).

  These units run inside the parent session (no orchestrator child dispatch). Rows
  are derived from board state for child identifiers listed on the parent entry.
  """
  @spec unified_subagent_rows(map(), keyword()) :: [waiting_record()]
  def unified_subagent_rows(snapshot, opts \\ [])

  def unified_subagent_rows(%{running: running}, opts) when is_list(running) do
    if lab_bundle_child_orchestration?(opts), do: [], else: do_unified_subagent_rows(running, opts)
  end

  def unified_subagent_rows(_snapshot, _opts), do: []

  defp do_unified_subagent_rows(running, opts) do
    ctx = resolvers(opts)

    running
    |> Enum.filter(&(Map.get(&1, :bundle_role) == :parent_unified))
    |> Enum.flat_map(fn parent_entry ->
      parent_id = Map.get(parent_entry, :identifier)
      slug = ctx.slug_resolver.(parent_id)

      parent_entry
      |> Map.get(:child_identifiers, [])
      |> Enum.flat_map(fn child_id ->
        state = resolve(ctx.state_resolver, child_id)

        if unified_subagent_board_state?(state) do
          [
            %{
              parent_identifier: parent_id,
              project_slug: slug,
              unit_id: child_id,
              issue_identifier: child_id,
              issue_id: resolve(ctx.issue_id_resolver, child_id),
              repo: nil,
              status: :waiting,
              blocked_by: [],
              pending_contracts: [],
              state: state,
              last_message: "Native subagent active in parent session"
            }
          ]
        else
          []
        end
      end)
    end)
    |> Enum.uniq_by(& &1.issue_identifier)
  end

  defp unified_subagent_board_state?(state) when is_binary(state) do
    normalized = String.downcase(String.trim(state))
    normalized == "in progress"
  end

  defp unified_subagent_board_state?(_state), do: false

  defp lab_bundle_child_orchestration?(opts) when is_list(opts) do
    Keyword.get(opts, :lab_bundle_child_orchestration, LabSettings.bundle_child_orchestration?())
  end

  defp lab_bundle_child_orchestration?(_opts), do: LabSettings.bundle_child_orchestration?()

  defp do_waiting_subagents(%{running: running}, opts) when is_list(running) do
    ctx = resolvers(opts)

    running
    |> candidate_parents()
    |> Enum.flat_map(&waiting_for_parent(&1, running, ctx))
    |> Enum.uniq_by(& &1.issue_identifier)
  end

  @type unit_status :: %{
          unit_id: String.t(),
          issue: String.t() | nil,
          repo: String.t() | nil,
          type: atom() | nil,
          status: SubagentPlan.status(),
          blocked_by: [String.t()],
          pending_contracts: [String.t()],
          state: String.t() | nil,
          turns: integer() | nil,
          tokens: integer() | nil,
          last_message: String.t() | nil
        }

  @doc """
  Full per-unit status of a coordinator parent's bundle tree (every dispatchable
  unit, not just the waiting ones), enriched with live runtime facts from the
  orchestrator snapshot. Backs the `query_bundle_status` coding-agent tool so a
  parent and its children can see which sibling is done/live/waiting/ready, what
  blocks each, and a short live summary — without re-deriving structure.

  Options mirror `waiting_subagents/2` (`:bundle_loader`, `:state_resolver`,
  `:terminal_resolver`, `:slug_resolver`, `:issue_id_resolver`) plus `:snapshot`
  (defaults to the live orchestrator snapshot).
  """
  @spec unit_statuses(String.t(), keyword()) :: [unit_status()]
  def unit_statuses(parent_identifier, opts \\ []) when is_binary(parent_identifier) do
    ctx = resolvers(opts)
    running = Keyword.get(opts, :snapshot, safe_snapshot()) |> Map.get(:running, [])

    case ctx.bundle_loader.(parent_identifier) do
      {:ok, %ExecutionBundle{} = bundle} ->
        issue_to_unit = issue_to_unit_id(bundle)
        running_by_issue = Map.new(running, fn entry -> {Map.get(entry, :identifier), entry} end)
        unit_types = Map.new(ExecutionBundle.dispatchable_units(bundle), &{&1.id, &1.type})

        bundle
        |> SubagentPlan.plan(
          done_units: done_units(bundle, ctx),
          running_unit_ids: running_unit_ids(running, issue_to_unit),
          contract_status: BundleCoordinator.contract_status(bundle)
        )
        |> Enum.map(&unit_status(&1, running_by_issue, unit_types, ctx))

      _ ->
        []
    end
  end

  defp unit_status(unit_plan, running_by_issue, unit_types, ctx) do
    entry = Map.get(running_by_issue, unit_plan.issue)

    %{
      unit_id: unit_plan.unit_id,
      issue: unit_plan.issue,
      repo: unit_plan.repo,
      type: Map.get(unit_types, unit_plan.unit_id),
      status: unit_plan.status,
      blocked_by: unit_plan.blocked_by,
      pending_contracts: unit_plan.pending_contracts,
      state: resolve(ctx.state_resolver, unit_plan.issue),
      turns: entry && Map.get(entry, :turn_count),
      tokens: entry && entry_tokens(entry),
      last_message: entry && Map.get(entry, :last_message)
    }
  end

  defp entry_tokens(entry) when is_map(entry) do
    Map.get(entry, :total_tokens) || Map.get(entry, :tokens)
  end

  defp safe_snapshot do
    case SymphonyElixir.Orchestrator.snapshot() do
      %{running: _} = snapshot -> snapshot
      _ -> %{running: []}
    end
  rescue
    _ -> %{running: []}
  end

  # Parents worth inspecting: the parent of any in-flight child, plus any running
  # entry that itself owns a coordinator bundle. Bounded by the number of running
  # entries (≤ max concurrent agents), so no full-table scan.
  defp candidate_parents(running) do
    from_children = running |> Enum.map(&Map.get(&1, :parent_identifier)) |> Enum.reject(&blank?/1)
    from_self = running |> Enum.map(&Map.get(&1, :identifier)) |> Enum.reject(&blank?/1)

    (from_children ++ from_self) |> Enum.uniq()
  end

  defp waiting_for_parent(parent_identifier, running, ctx) do
    with {:ok, %ExecutionBundle{} = bundle} <- ctx.bundle_loader.(parent_identifier),
         true <- BundleCoordinator.coordinator?(bundle) do
      slug = ctx.slug_resolver.(parent_identifier)
      issue_to_unit = issue_to_unit_id(bundle)

      bundle
      |> SubagentPlan.plan(
        done_units: done_units(bundle, ctx),
        running_unit_ids: running_unit_ids(running, issue_to_unit),
        contract_status: BundleCoordinator.contract_status(bundle)
      )
      |> Enum.filter(&(&1.status == :waiting))
      |> Enum.map(&waiting_record(&1, parent_identifier, slug, ctx))
    else
      _ -> []
    end
  end

  defp waiting_record(unit_plan, parent_identifier, slug, ctx) do
    %{
      parent_identifier: parent_identifier,
      project_slug: slug,
      unit_id: unit_plan.unit_id,
      issue_identifier: unit_plan.issue,
      issue_id: resolve(ctx.issue_id_resolver, unit_plan.issue),
      repo: unit_plan.repo,
      status: :waiting,
      blocked_by: unit_plan.blocked_by,
      pending_contracts: unit_plan.pending_contracts,
      state: resolve(ctx.state_resolver, unit_plan.issue),
      last_message: waiting_message(unit_plan)
    }
  end

  # Human-readable reason the unit is parked, shown in the sessions table.
  defp waiting_message(%{blocked_by: [_ | _] = deps, pending_contracts: contracts}) do
    base = "Waiting on " <> Enum.join(deps, ", ")
    if contracts == [], do: base, else: base <> " · contract " <> Enum.join(contracts, ", ")
  end

  defp waiting_message(%{pending_contracts: [_ | _] = contracts}),
    do: "Waiting on contract " <> Enum.join(contracts, ", ")

  defp waiting_message(_unit_plan), do: "Waiting on dependencies"

  # Bundle units keyed by their issue identifier -> unit id, so live run entries
  # (keyed by issue identifier) can be mapped back into unit-id space.
  defp issue_to_unit_id(bundle) do
    bundle
    |> ExecutionBundle.dispatchable_units()
    |> Enum.reduce(%{}, fn unit, acc ->
      if blank?(unit.issue), do: acc, else: Map.put(acc, unit.issue, unit.id)
    end)
  end

  defp running_unit_ids(running, issue_to_unit) do
    running
    |> Enum.map(&Map.get(&1, :identifier))
    |> Enum.map(&Map.get(issue_to_unit, &1))
    |> Enum.reject(&is_nil/1)
    |> MapSet.new()
  end

  defp done_units(bundle, ctx) do
    bundle
    |> ExecutionBundle.dispatchable_units()
    |> Enum.reduce(MapSet.new(), fn unit, acc ->
      if not blank?(unit.issue) and ctx.terminal_resolver.(unit.issue),
        do: MapSet.put(acc, unit.id),
        else: acc
    end)
  end

  defp resolvers(opts) do
    %{
      bundle_loader: Keyword.get(opts, :bundle_loader, &load_parent_bundle/1),
      slug_resolver: Keyword.get(opts, :slug_resolver, &Context.find_project_slug/1),
      terminal_resolver: Keyword.get(opts, :terminal_resolver, &issue_terminal?/1),
      state_resolver: Keyword.get(opts, :state_resolver, &issue_state/1),
      issue_id_resolver: Keyword.get(opts, :issue_id_resolver, &issue_id/1)
    }
  end

  defp resolve(fun, value) when is_function(fun, 1), do: fun.(value)

  # --- Default Context-backed resolvers -------------------------------------

  # Uses the canonical newest-workpad lookup so a stale older workpad comment can
  # never shadow the current bundle (order-independent, matches the rest of the
  # system's `latest_workpad/2` semantics).
  defp load_parent_bundle(parent_identifier) when is_binary(parent_identifier) do
    with slug when is_binary(slug) <- Context.find_project_slug(parent_identifier),
         {:ok, %{body: body}} when is_binary(body) <- Context.latest_workpad(slug, parent_identifier),
         {:ok, %ExecutionBundle{} = bundle} <- ExecutionBundle.parse(body) do
      {:ok, bundle}
    else
      _ -> :error
    end
  end

  defp load_parent_bundle(_parent_identifier), do: :error

  defp issue_terminal?(identifier) when is_binary(identifier) do
    with slug when is_binary(slug) <- Context.find_project_slug(identifier),
         {:ok, record} <- Context.get_issue(slug, identifier) do
      match?(%{status: %{is_terminal: true}}, record)
    else
      _ -> false
    end
  end

  defp issue_terminal?(_identifier), do: false

  defp issue_state(identifier) when is_binary(identifier) do
    with slug when is_binary(slug) <- Context.find_project_slug(identifier),
         {:ok, %{status: %{name: name}}} <- Context.get_issue(slug, identifier) do
      name
    else
      _ -> nil
    end
  end

  defp issue_state(_identifier), do: nil

  defp issue_id(identifier) when is_binary(identifier) do
    with slug when is_binary(slug) <- Context.find_project_slug(identifier),
         {:ok, %{id: id}} <- Context.get_issue(slug, identifier) do
      to_string(id)
    else
      _ -> nil
    end
  end

  defp issue_id(_identifier), do: nil

  defp blank?(nil), do: true
  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(_value), do: false
end
