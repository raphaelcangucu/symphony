defmodule SymphonyElixir.Orchestrator.BundleDispatch do
  @moduledoc """
  Pure helpers deciding which child_run units of a parent bundle are eligible to
  dispatch given completed-child state and shared-contract readiness.
  """

  alias SymphonyElixir.Workpad.ExecutionBundle

  @type child_states :: %{optional(String.t()) => :pending | :running | :done}

  @spec dispatchable_children(ExecutionBundle.t(), child_states(), keyword()) :: [map()]
  def dispatchable_children(%ExecutionBundle{} = bundle, child_states, opts) do
    contract_status = Keyword.get(opts, :contract_status, %{})

    bundle
    |> ExecutionBundle.child_units()
    |> Enum.reject(&(Map.get(child_states, &1.id) in [:running, :done]))
    |> Enum.filter(&deps_satisfied?(&1, child_states))
    |> Enum.filter(&contracts_ready?(&1, contract_status))
  end

  defp deps_satisfied?(unit, child_states) do
    Enum.all?(unit.depends_on, &(Map.get(child_states, &1) == :done))
  end

  defp contracts_ready?(unit, contract_status) do
    Enum.all?(unit.consumes, &(Map.get(contract_status, &1) == :ready))
  end
end
