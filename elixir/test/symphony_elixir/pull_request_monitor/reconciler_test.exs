defmodule SymphonyElixir.PullRequestMonitor.ReconcilerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.PullRequestMonitor.Reconciler

  test "candidates/3 keeps wait-state issues of enabled projects, skips in-flight" do
    issues = [
      %{identifier: "#1", project_slug: "enabled"},
      %{identifier: "#2", project_slug: "disabled"},
      %{identifier: "#3", project_slug: "enabled"},
      %{identifier: nil, project_slug: "enabled"}
    ]

    result = Reconciler.candidates(issues, MapSet.new(["enabled"]), MapSet.new([{"enabled", "#3"}]))

    assert Enum.map(result, & &1.identifier) == ["#1"]
  end

  test "candidates/3 caps the batch size" do
    issues = for n <- 1..30, do: %{identifier: "##{n}", project_slug: "enabled"}

    result = Reconciler.candidates(issues, MapSet.new(["enabled"]), MapSet.new())

    assert length(result) == 10
  end

  test "handle_info/2 removes in-flight entry on :DOWN" do
    ref = make_ref()

    state = %{
      in_flight: %{
        {"enabled", "#1"} => make_ref(),
        {"enabled", "#2"} => ref
      }
    }

    assert {:noreply, next_state} = Reconciler.handle_info({:DOWN, ref, :process, self(), :normal}, state)
    assert Map.has_key?(next_state.in_flight, {"enabled", "#1"})
    refute Map.has_key?(next_state.in_flight, {"enabled", "#2"})
  end

  test "stats/2 returns an offline heartbeat when the reconciler is not running" do
    stats = Reconciler.stats(:pr_monitor_reconciler_absent, 50)

    assert stats.running == false
    assert stats.in_flight == 0
    assert stats.tick_count == 0
    assert is_integer(stats.interval_ms) and stats.interval_ms > 0
  end

  test "handle_call(:stats) reports the in-flight count and tick metadata" do
    state = %{
      in_flight: %{{"enabled", "#1"} => make_ref()},
      tick_count: 3,
      last_tick_started_at: ~U[2026-06-11 10:00:00.000000Z],
      last_tick_finished_at: ~U[2026-06-11 10:00:01.000000Z],
      last_tick_status: :ok,
      last_error: nil,
      last_evaluated_count: 2
    }

    assert {:reply, stats, ^state} = Reconciler.handle_call(:stats, self(), state)

    assert stats.running == true
    assert stats.in_flight == 1
    assert stats.tick_count == 3
    assert stats.last_tick_status == :ok
    assert stats.last_evaluated_count == 2
  end
end
