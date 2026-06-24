defmodule SymphonyElixir.Orchestrator.BundleCoordinator do
  @moduledoc """
  Turns a parsed parent execution bundle plus the current child-run state into
  concrete dispatch instructions for the orchestrator: which `child_run` units
  are eligible to spawn now (gated by dependencies and shared-contract
  readiness), and the run opts each child needs (worktree isolation, unit id,
  branch, parent back-link, and the contracts it touches).

  Pure: the live orchestrator consults it; this module performs no I/O. The
  caller resolves each unit's `repo` (owner/name) to a local checkout path and
  injects it as `:worktree_repo` before handing the opts to `AgentRunner.run/3`.
  """

  alias SymphonyElixir.Orchestrator.BundleDispatch
  alias SymphonyElixir.Workpad.ExecutionBundle

  @type dispatch_spec :: %{
          unit_id: String.t(),
          issue: String.t() | nil,
          repo: String.t() | nil,
          run_opts: keyword()
        }

  @doc """
  True when the bundle is a coordinator bundle: it is in `bundle` mode and owns
  at least one `child_run` unit (a `workpad_task`-only bundle runs entirely
  inline and needs no child dispatch).
  """
  @spec coordinator?(ExecutionBundle.t() | term()) :: boolean()
  def coordinator?(%ExecutionBundle{mode: "bundle", units: units}) when is_list(units) do
    Enum.any?(units, &(&1.type == :child_run))
  end

  def coordinator?(_bundle), do: false

  @doc """
  Dispatch specs for the `child_run` units eligible to start now.
  """
  @spec child_dispatch_specs(ExecutionBundle.t(), BundleDispatch.child_states(), keyword()) :: [dispatch_spec()]
  def child_dispatch_specs(%ExecutionBundle{} = bundle, child_states, opts \\ []) do
    parent_identifier = Keyword.get(opts, :parent_identifier)

    bundle
    |> BundleDispatch.dispatchable_children(child_states, contract_status: contract_status(bundle))
    |> Enum.map(fn unit ->
      %{
        unit_id: unit.id,
        issue: unit.issue,
        repo: unit.repo,
        run_opts: [
          worktree: true,
          unit_id: unit.id,
          worktree_branch: "feat/#{unit.id}",
          parent_identifier: parent_identifier,
          bundle_unit: unit,
          shared_contracts: bundle.shared_contracts
        ]
      }
    end)
  end

  @doc """
  Maps each shared contract id to its current status atom.
  """
  @spec contract_status(ExecutionBundle.t()) :: %{optional(String.t()) => atom()}
  def contract_status(%ExecutionBundle{shared_contracts: contracts}) when is_list(contracts) do
    Map.new(contracts, &{&1.id, &1.status})
  end

  def contract_status(_bundle), do: %{}

  @doc """
  True when every `child_run` unit has reached the `:done` state. The parent's
  own `workpad_task` units are gated separately by the execution contract.
  """
  @spec children_complete?(ExecutionBundle.t(), BundleDispatch.child_states()) :: boolean()
  def children_complete?(%ExecutionBundle{} = bundle, child_states) do
    bundle
    |> ExecutionBundle.child_units()
    |> Enum.all?(&(Map.get(child_states, &1.id) == :done))
  end
end
