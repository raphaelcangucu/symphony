defmodule SymphonyElixir.Orchestrator.BundleGateWiringTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Issue
  alias SymphonyElixir.Orchestrator
  alias SymphonyElixir.Workpad.ExecutionBundle

  @lab_opts [lab_bundle_child_orchestration: true]

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
      Orchestrator.held_child_issue_ids_for_test(
        candidates,
        Keyword.merge(
          [
            bundle_loader: fn "MAC-1" -> {:ok, bundle()} end,
            done_units: fn _bundle -> MapSet.new() end
          ],
          @lab_opts
        )
      )

    assert MapSet.member?(held, "id-3")
    refute MapSet.member?(held, "id-2")
  end

  test "releases the dependent child once its dependency is done and contract is ready" do
    candidates = [child("id-2", "MAC-2"), child("id-3", "MAC-3")]

    ready_bundle = %{bundle() | shared_contracts: [%{(bundle().shared_contracts |> hd()) | status: :ready}]}

    held =
      Orchestrator.held_child_issue_ids_for_test(
        candidates,
        Keyword.merge(
          [
            bundle_loader: fn "MAC-1" -> {:ok, ready_bundle} end,
            done_units: fn _bundle -> MapSet.new(["api"]) end
          ],
          @lab_opts
        )
      )

    assert MapSet.size(held) == 0
  end

  test "a released predecessor's produced contract counts as ready even if the bundle still records it draft/changing" do
    candidates = [child("id-3", "MAC-3")]

    held =
      Orchestrator.held_child_issue_ids_for_test(
        candidates,
        Keyword.merge(
          [
            bundle_loader: fn "MAC-1" -> {:ok, bundle()} end,
            done_units: fn _bundle -> MapSet.new(["api"]) end
          ],
          @lab_opts
        )
      )

    assert MapSet.size(held) == 0
  end

  test "non-child issues are ignored by the gate" do
    candidates = [%Issue{id: "id-9", identifier: "MAC-9"}]

    held =
      Orchestrator.held_child_issue_ids_for_test(
        candidates,
        Keyword.merge(
          [
            bundle_loader: fn _ -> {:ok, bundle()} end,
            done_units: fn _ -> MapSet.new() end
          ],
          @lab_opts
        )
      )

    assert MapSet.size(held) == 0
  end

  test "an unresolvable parent bundle leaves children un-gated (liveness)" do
    candidates = [child("id-3", "MAC-3")]

    held =
      Orchestrator.held_child_issue_ids_for_test(
        candidates,
        Keyword.merge(
          [
            bundle_loader: fn _ -> :error end,
            done_units: fn _ -> MapSet.new() end
          ],
          @lab_opts
        )
      )

    assert MapSet.size(held) == 0
  end

  describe "released_record_state?/2 (dispatch-gate release cadence)" do
    @wait_states ["Human Review"]

    test "a predecessor whose status NAME is a wait_state releases its dependents (even when the board category is 'started')" do
      assert Orchestrator.released_record_state?(
               %{status: %{is_terminal: false, category: "started", name: "Human Review"}},
               @wait_states
             )
    end

    test "a terminal predecessor releases its dependents regardless of wait_states" do
      assert Orchestrator.released_record_state?(%{status: %{is_terminal: true, name: "Done"}}, @wait_states)
    end

    test "a predecessor still in an active (non-wait, non-terminal) state does NOT release its dependents" do
      refute Orchestrator.released_record_state?(
               %{status: %{is_terminal: false, category: "started", name: "In Progress"}},
               @wait_states
             )
    end

    test "an unresolvable record does not release" do
      refute Orchestrator.released_record_state?(%{}, @wait_states)
      refute Orchestrator.released_record_state?(nil, @wait_states)
    end
  end
end
