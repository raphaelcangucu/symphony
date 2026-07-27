defmodule SymphonyElixir.MobileComparison.SubscriptionTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileComparison.Subscription

  defmodule FakeService do
    def call("comparisons.get", params, context) do
      snapshot =
        Agent.get(context.snapshot_state, fn state ->
          %{
            "identifier" => params["identifier"],
            "status" => state.status,
            "cells" => state.cells
          }
        end)

      {:ok, snapshot}
    end
  end

  defmodule FakeEventBus do
    def subscribe(topic, context) do
      send(context.comparison_event_bus_test_pid, {:subscribed, topic})
      :ok
    end
  end

  setup do
    state =
      start_supervised!(
        {Agent,
         fn ->
           %{
             status: "running",
             cells: [
               %{
                 "id" => "session-codex",
                 "issue_identifier" => "DEV-2",
                 "thread_id" => 42
               }
             ]
           }
         end}
      )

    context = %{
      comparison_subscription_id: "comparison:DEV-1:1",
      mobile_comparison_service: FakeService,
      comparison_event_bus: FakeEventBus,
      comparison_event_bus_test_pid: self(),
      snapshot_state: state,
      comparison_coalesce_ms: 5
    }

    %{context: context, state: state}
  end

  test "emits an initial snapshot and coalesces relevant host events", %{
    context: context,
    state: state
  } do
    assert {:ok, pid} =
             Subscription.subscribe(
               self(),
               %{"project_slug" => "dev10x", "identifier" => "DEV-1"},
               context
             )

    assert_receive {:subscribed, "project:dev10x"}
    assert_receive {:subscribed, "agent_executions"}
    assert_receive {:subscribed, "mobile_notifications"}
    assert_receive {:subscribed, "assistant_thread:42"}
    assert_receive {:subscribed, "dev_server:dev10x:DEV-2"}

    assert :ok = Subscription.activate(pid)

    assert_receive {:mobile_rpc_event, "comparison:DEV-1:1", "comparisons.snapshot",
                    %{"status" => "running"}}

    Agent.update(state, &%{&1 | status: "completed"})
    send(pid, {:tracker_event, "issue_updated", %{}})
    send(pid, {:agent_execution_event, "snapshot", %{}})
    send(pid, {:mobile_notification, "evidence", %{}})

    assert_receive {:mobile_rpc_event, "comparison:DEV-1:1", "comparisons.snapshot",
                    %{"status" => "completed"}},
                   200

    refute_receive {:mobile_rpc_event, "comparison:DEV-1:1", "comparisons.snapshot", _}, 30
    assert :ok = Subscription.stop(pid)
  end

  test "stops with the authenticated mobile connection", %{context: context} do
    connection = spawn(fn -> Process.sleep(:infinity) end)

    assert {:ok, pid} =
             Subscription.subscribe(
               connection,
               %{"project_slug" => "dev10x", "identifier" => "DEV-1"},
               context
             )

    monitor = Process.monitor(pid)
    Process.exit(connection, :kill)
    assert_receive {:DOWN, ^monitor, :process, ^pid, :connection_closed}
  end
end
