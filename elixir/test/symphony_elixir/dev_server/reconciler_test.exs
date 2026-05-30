defmodule SymphonyElixir.DevServer.ReconcilerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.Reconciler

  describe "reconcile/2" do
    test "selects human-review issues when configured" do
      candidates = %{
        human_review: ["LOC-1", "LOC-2"],
        pull_request: ["LOC-3"]
      }

      assert Reconciler.reconcile(["human_review"], candidates) == ["LOC-1", "LOC-2"]
    end

    test "unions pull_request and human_review without duplicates" do
      candidates = %{
        human_review: ["LOC-1", "LOC-2"],
        pull_request: ["LOC-2", "LOC-3"]
      }

      assert Reconciler.reconcile(["pull_request", "human_review"], candidates) == [
               "LOC-2",
               "LOC-3",
               "LOC-1"
             ]
    end

    test "returns an empty list when no triggers are configured" do
      candidates = %{
        human_review: ["LOC-1"],
        pull_request: ["LOC-2"]
      }

      assert Reconciler.reconcile([], candidates) == []
    end
  end
end
