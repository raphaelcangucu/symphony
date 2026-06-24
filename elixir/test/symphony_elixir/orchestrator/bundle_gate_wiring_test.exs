defmodule SymphonyElixir.Orchestrator.BundleGateWiringTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Issue
  alias SymphonyElixir.Orchestrator
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

  defp child(id, identifier), do: %Issue{id: id, identifier: identifier, parent_identifier: "MAC-1"}

  test "holds the dependent child while its dependency is not done and contract is draft" do
    candidates = [child("id-2", "MAC-2"), child("id-3", "MAC-3")]

    held =
      Orchestrator.held_child_issue_ids_for_test(candidates,
        bundle_loader: fn "MAC-1" -> {:ok, bundle()} end,
        done_units: fn _bundle -> MapSet.new() end
      )

    assert MapSet.member?(held, "id-3")
    refute MapSet.member?(held, "id-2")
  end

  test "releases the dependent child once its dependency is done and contract is ready" do
    candidates = [child("id-2", "MAC-2"), child("id-3", "MAC-3")]

    ready_bundle = %{bundle() | shared_contracts: [%{bundle().shared_contracts |> hd() | status: :ready}]}

    held =
      Orchestrator.held_child_issue_ids_for_test(candidates,
        bundle_loader: fn "MAC-1" -> {:ok, ready_bundle} end,
        done_units: fn _bundle -> MapSet.new(["api"]) end
      )

    assert MapSet.size(held) == 0
  end

  test "non-child issues are ignored by the gate" do
    candidates = [%Issue{id: "id-9", identifier: "MAC-9"}]

    held =
      Orchestrator.held_child_issue_ids_for_test(candidates,
        bundle_loader: fn _ -> {:ok, bundle()} end,
        done_units: fn _ -> MapSet.new() end
      )

    assert MapSet.size(held) == 0
  end

  test "an unresolvable parent bundle leaves children un-gated (liveness)" do
    candidates = [child("id-3", "MAC-3")]

    held =
      Orchestrator.held_child_issue_ids_for_test(candidates,
        bundle_loader: fn _ -> :error end,
        done_units: fn _ -> MapSet.new() end
      )

    assert MapSet.size(held) == 0
  end
end
