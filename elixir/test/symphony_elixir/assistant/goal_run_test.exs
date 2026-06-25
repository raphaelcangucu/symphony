defmodule SymphonyElixir.Assistant.GoalRunTest do
  # Relies on the always-on registry + PubSub the application boots; unique thread
  # ids per test keep the shared registry contention-free. Serial to avoid races.
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.GoalRun

  describe "active-run tracking" do
    test "an untracked thread is not running" do
      assert GoalRun.running?(900_001) == false
      assert GoalRun.started_at(900_001) == nil
      assert GoalRun.elapsed_seconds(900_001) == nil
    end

    test "tracking a thread marks it running with an elapsed time" do
      # Register from a long-lived helper process so the entry persists for the
      # assertions (mirrors the run Task owning the registry entry).
      {:ok, runner} = start_runner(900_007)

      assert GoalRun.running?(900_007) == true
      assert is_integer(GoalRun.started_at(900_007))
      assert GoalRun.elapsed_seconds(900_007) >= 0

      stop_runner(runner)
    end

    test "a finished/crashed run auto-removes its entry" do
      {:ok, runner} = start_runner(900_008)
      assert GoalRun.running?(900_008) == true

      stop_runner(runner)
      # Registry entries are owned by the registering process, so the entry is
      # gone once that process dies — no manual cleanup required.
      wait_until(fn -> GoalRun.running?(900_008) == false end)
      assert GoalRun.running?(900_008) == false
    end

    test "untrack removes the entry while the process stays alive" do
      parent = self()

      runner =
        spawn(fn ->
          GoalRun.track(900_009)
          send(parent, :tracked)

          receive do
            :untrack ->
              GoalRun.untrack(900_009)
              send(parent, :untracked)
              Process.sleep(:infinity)
          end
        end)

      assert_receive :tracked
      assert GoalRun.running?(900_009) == true

      send(runner, :untrack)
      assert_receive :untracked
      wait_until(fn -> GoalRun.running?(900_009) == false end)
      assert GoalRun.running?(900_009) == false

      Process.exit(runner, :kill)
    end
  end

  describe "pubsub lifecycle fan-out" do
    test "broadcast_from reaches other subscribers but excludes the sender" do
      thread_id = 900_042
      parent = self()
      GoalRun.subscribe(thread_id)

      _other =
        spawn_link(fn ->
          GoalRun.subscribe(thread_id)
          send(parent, :subscribed)

          receive do
            msg -> send(parent, {:other_got, msg})
          end
        end)

      # Handshake so the other subscriber is registered before we broadcast.
      assert_receive :subscribed

      GoalRun.broadcast_from(self(), thread_id, {:goal_run_finished, %{role: "assistant"}})

      assert_receive {:other_got, {:goal_run_finished, %{role: "assistant"}}}
      # The sender is excluded, so we never receive our own broadcast.
      refute_received {:goal_run_finished, _}
    end
  end

  defp start_runner(thread_id) do
    parent = self()

    runner =
      spawn(fn ->
        GoalRun.track(thread_id)
        send(parent, :ready)
        Process.sleep(:infinity)
      end)

    assert_receive :ready
    {:ok, runner}
  end

  defp stop_runner(runner) do
    ref = Process.monitor(runner)
    Process.exit(runner, :kill)
    assert_receive {:DOWN, ^ref, :process, ^runner, _}
  end

  defp wait_until(fun, attempts \\ 50) do
    cond do
      attempts <= 0 ->
        :timeout

      fun.() ->
        :ok

      true ->
        Process.sleep(10)
        wait_until(fun, attempts - 1)
    end
  end
end
