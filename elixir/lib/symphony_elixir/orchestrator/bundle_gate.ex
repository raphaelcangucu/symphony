defmodule SymphonyElixir.Orchestrator.BundleGate do
  @moduledoc """
  Pure gate deciding whether a `child_run` unit must be held back from dispatch
  because a sibling it depends on is not yet done, or a shared contract it
  consumes is not yet ready.

  Liveness-preserving: a dispatching issue the bundle does not recognise as a
  `child_run` unit is never held, so the gate can only ever delay a managed
  child — never deadlock an unrelated issue. The caller resolves the set of
  done sibling unit ids and the contract status map (both derived from live
  tracker/bundle state) and hands them in; this module performs no I/O.
  """

  alias SymphonyElixir.Workpad.ExecutionBundle

  @doc """
  True when the unit whose issue identifier is `issue_identifier` should be held
  back. `done_units` is the set of sibling unit ids whose issue has reached a
  terminal state; `contract_status` maps each shared-contract id to its status
  atom (`:draft | :ready | :changing`).
  """
  @spec held?(ExecutionBundle.t(), String.t(), MapSet.t(), %{optional(String.t()) => atom()}) :: boolean()
  def held?(%ExecutionBundle{} = bundle, issue_identifier, %MapSet{} = done_units, contract_status)
      when is_binary(issue_identifier) and is_map(contract_status) do
    case find_child_unit(bundle, issue_identifier) do
      nil -> false
      unit -> not (deps_done?(unit, done_units) and contracts_ready?(unit, contract_status))
    end
  end

  def held?(_bundle, _issue_identifier, _done_units, _contract_status), do: false

  defp find_child_unit(bundle, issue_identifier) do
    bundle
    |> ExecutionBundle.child_units()
    |> Enum.find(&(&1.issue == issue_identifier))
  end

  defp deps_done?(unit, done_units) do
    Enum.all?(unit.depends_on, &MapSet.member?(done_units, &1))
  end

  defp contracts_ready?(unit, contract_status) do
    Enum.all?(unit.consumes, &(Map.get(contract_status, &1) == :ready))
  end
end
