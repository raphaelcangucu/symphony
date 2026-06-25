defmodule SymphonyElixir.Orchestrator.BundleGateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Orchestrator.BundleGate
  alias SymphonyElixir.Workpad.ExecutionBundle

  defp bundle do
    %ExecutionBundle{
      version: 1,
      mode: "bundle",
      parent: "MAC-1",
      units: [
        %{id: "api", type: :child_run, issue: "MAC-2", repo: "macro/be", produces: ["schema"], consumes: [], depends_on: [], deliverable: nil},
        %{id: "ui", type: :child_run, issue: "MAC-3", repo: "macro/fe", produces: [], consumes: ["schema"], depends_on: ["api"], deliverable: nil}
      ],
      shared_contracts: [
        %{id: "schema", kind: "openapi", owner_unit: "api", consumers: ["ui"], artifact: "openapi.yaml", status: :draft}
      ]
    }
  end

  test "a unit with no deps and no consumed contracts is never held" do
    refute BundleGate.held?(bundle(), "MAC-2", MapSet.new(), %{})
  end

  test "a consumer is held while its dependency is not done" do
    contract_status = %{"schema" => :ready}
    assert BundleGate.held?(bundle(), "MAC-3", MapSet.new(), contract_status)
  end

  test "a consumer is held while its consumed contract is not ready, even if deps are done" do
    done = MapSet.new(["api"])
    assert BundleGate.held?(bundle(), "MAC-3", done, %{"schema" => :draft})
  end

  test "a consumer is released once its dependency is done and its contract is ready" do
    done = MapSet.new(["api"])
    refute BundleGate.held?(bundle(), "MAC-3", done, %{"schema" => :ready})
  end

  test "an issue identifier not present in the bundle is never held (liveness)" do
    refute BundleGate.held?(bundle(), "MAC-999", MapSet.new(), %{})
  end
end
