defmodule SymphonyElixir.Orchestrator.AgentTotalsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Orchestrator.AgentTotals

  describe "empty/0" do
    test "returns a zeroed totals map" do
      assert AgentTotals.empty() == %{
               input_tokens: 0,
               output_tokens: 0,
               total_tokens: 0,
               seconds_running: 0
             }
    end
  end

  describe "apply_delta/2" do
    test "adds every counter into the running totals" do
      totals = %{input_tokens: 10, output_tokens: 5, total_tokens: 15, seconds_running: 2}
      delta = %{input_tokens: 4, output_tokens: 3, total_tokens: 7, seconds_running: 1}

      assert AgentTotals.apply_delta(totals, delta) == %{
               input_tokens: 14,
               output_tokens: 8,
               total_tokens: 22,
               seconds_running: 3
             }
    end

    test "defaults missing keys to zero" do
      assert AgentTotals.apply_delta(%{}, %{total_tokens: 9}) == %{
               input_tokens: 0,
               output_tokens: 0,
               total_tokens: 9,
               seconds_running: 0
             }
    end

    test "clamps counters at zero when a delta is negative" do
      totals = %{input_tokens: 5, output_tokens: 0, total_tokens: 5, seconds_running: 0}
      delta = %{input_tokens: -10, output_tokens: 0, total_tokens: -10, seconds_running: 0}

      result = AgentTotals.apply_delta(totals, delta)

      assert result.input_tokens == 0
      assert result.total_tokens == 0
    end
  end

  describe "apply_project_delta/3" do
    test "seeds a new project slug from empty totals" do
      delta = %{input_tokens: 2, output_tokens: 1, total_tokens: 3, seconds_running: 0}

      assert AgentTotals.apply_project_delta(%{}, "acme", delta) == %{
               "acme" => %{
                 input_tokens: 2,
                 output_tokens: 1,
                 total_tokens: 3,
                 seconds_running: 0
               }
             }
    end

    test "accumulates into an existing project slug" do
      by_project = %{"acme" => %{input_tokens: 5, output_tokens: 0, total_tokens: 5, seconds_running: 0}}
      delta = %{input_tokens: 5, output_tokens: 0, total_tokens: 5, seconds_running: 0}

      assert AgentTotals.apply_project_delta(by_project, "acme", delta)["acme"].total_tokens == 10
    end

    test "returns the map unchanged for a blank slug" do
      by_project = %{"acme" => AgentTotals.empty()}

      assert AgentTotals.apply_project_delta(by_project, "", %{total_tokens: 5}) == by_project
      assert AgentTotals.apply_project_delta(by_project, nil, %{total_tokens: 5}) == by_project
    end
  end
end
