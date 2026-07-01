defmodule SymphonyElixir.Orchestrator.SubagentPlan do
  @moduledoc """
  Pure lifecycle planner for a coordinator parent's subagent units.

  Given a parsed execution bundle and the current runtime facts (which sibling
  units have completed, which shared contracts are ready, which units have a live
  agent), it derives a per-unit lifecycle status without performing any I/O:

    * `:done`    — the unit's issue has reached a terminal state.
    * `:live`    — an agent is actively running this unit.
    * `:waiting` — the unit is blocked on an unfinished dependency or a
      not-yet-ready consumed contract. It is parked cheaply (no agent, no tokens)
      and surfaced to the UI as a waiting session under the parent.
    * `:ready`   — nothing blocks the unit; it is eligible to spawn now.

  This is the single source of truth the orchestrator (dispatch gating) and the
  observability layer (waiting-session projection) both consult, so the live
  table and the dispatch decision can never disagree.
  """

  alias SymphonyElixir.Workpad.ExecutionBundle

  @type status :: :done | :live | :waiting | :ready

  @type unit_plan :: %{
          unit_id: String.t(),
          issue: String.t() | nil,
          repo: String.t() | nil,
          depends_on: [String.t()],
          consumes: [String.t()],
          status: status(),
          blocked_by: [String.t()],
          pending_contracts: [String.t()]
        }

  @doc """
  Builds the lifecycle plan for every orchestrated subagent unit in the bundle,
  preserving bundle order.

  Options (all optional, defaulting to empty):

    * `:done_units` — `MapSet` of unit ids whose issue is terminal.
    * `:contract_status` — map of shared-contract id to status atom.
    * `:running_unit_ids` — `MapSet` of unit ids with a live agent.
  """
  @spec plan(ExecutionBundle.t(), keyword()) :: [unit_plan()]
  def plan(%ExecutionBundle{} = bundle, opts) when is_list(opts) do
    done_units = mapset_opt(opts, :done_units)
    running_unit_ids = mapset_opt(opts, :running_unit_ids)
    contract_status = map_opt(opts, :contract_status)

    bundle
    |> ExecutionBundle.dispatchable_units()
    |> Enum.map(&unit_plan(&1, done_units, running_unit_ids, contract_status))
  end

  def plan(_bundle, _opts), do: []

  @doc "The set of unit ids in the plan that are `:waiting`."
  @spec waiting_unit_ids([unit_plan()]) :: MapSet.t()
  def waiting_unit_ids(plan) when is_list(plan), do: ids_with_status(plan, :waiting)

  @doc "The set of unit ids in the plan that are `:ready` to dispatch."
  @spec ready_unit_ids([unit_plan()]) :: MapSet.t()
  def ready_unit_ids(plan) when is_list(plan), do: ids_with_status(plan, :ready)

  defp unit_plan(unit, done_units, running_unit_ids, contract_status) do
    blocked_by = Enum.reject(unit.depends_on, &MapSet.member?(done_units, &1))
    pending_contracts = Enum.reject(unit.consumes, &(Map.get(contract_status, &1) == :ready))

    %{
      unit_id: unit.id,
      issue: unit.issue,
      repo: unit.repo,
      depends_on: unit.depends_on,
      consumes: unit.consumes,
      status: status_for(unit.id, done_units, running_unit_ids, blocked_by, pending_contracts),
      blocked_by: blocked_by,
      pending_contracts: pending_contracts
    }
  end

  defp status_for(unit_id, done_units, running_unit_ids, blocked_by, pending_contracts) do
    cond do
      MapSet.member?(done_units, unit_id) -> :done
      MapSet.member?(running_unit_ids, unit_id) -> :live
      blocked_by != [] or pending_contracts != [] -> :waiting
      true -> :ready
    end
  end

  defp ids_with_status(plan, status) do
    plan
    |> Enum.filter(&(&1.status == status))
    |> MapSet.new(& &1.unit_id)
  end

  defp mapset_opt(opts, key) do
    case Keyword.get(opts, key) do
      %MapSet{} = set -> set
      list when is_list(list) -> MapSet.new(list)
      _ -> MapSet.new()
    end
  end

  defp map_opt(opts, key) do
    case Keyword.get(opts, key) do
      map when is_map(map) -> map
      _ -> %{}
    end
  end
end
