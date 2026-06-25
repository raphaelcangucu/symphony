defmodule SymphonyElixir.Orchestrator.BundleDispatchTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Orchestrator.BundleDispatch
  alias SymphonyElixir.Workpad.ExecutionBundle

  defp bundle do
    %ExecutionBundle{
      mode: "bundle",
      units: [
        %{id: "be", type: :child_run, issue: "p/be#1", repo: "p/be", produces: ["api"], consumes: [], depends_on: [], deliverable: "pr"},
        %{id: "fe", type: :child_run, issue: "p/fe#2", repo: "p/fe", produces: [], consumes: ["api"], depends_on: ["be"], deliverable: "pr"},
        %{id: "inline", type: :workpad_task, issue: nil, repo: "p/be", produces: [], consumes: [], depends_on: [], deliverable: nil}
      ],
      shared_contracts: [%{id: "api", owner_unit: "be", consumers: ["fe"], kind: "graphql", artifact: nil, status: :draft}]
    }
  end

  test "dispatchable_children gates the consumer until the contract is ready" do
    ready = BundleDispatch.dispatchable_children(bundle(), %{}, contract_status: %{"api" => :draft})
    assert Enum.map(ready, & &1.id) == ["be"]
  end

  test "dispatchable_children releases the consumer when the contract is ready and producer done" do
    ready =
      BundleDispatch.dispatchable_children(bundle(), %{"be" => :done}, contract_status: %{"api" => :ready})

    assert "fe" in Enum.map(ready, & &1.id)
  end

  test "dispatchable_children excludes running/done children and workpad_task units" do
    ready = BundleDispatch.dispatchable_children(bundle(), %{"be" => :running}, contract_status: %{"api" => :draft})
    assert ready == []
  end
end
