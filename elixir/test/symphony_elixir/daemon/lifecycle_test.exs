defmodule SymphonyElixir.Daemon.LifecycleTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Lifecycle

  test "start is idempotent when already healthy" do
    deps = %{
      status: fn -> {:ok, %{state: :healthy}} end,
      systemd_start: fn -> flunk("must not start an already healthy service") end,
      wait_healthy: fn -> flunk("must not wait") end
    }

    assert {:ok, :already_healthy} = Lifecycle.start(deps: deps)
  end

  test "forced restart kills the cgroup and waits for health" do
    test_pid = self()

    deps = %{
      force_restart: fn ->
        send(test_pid, :killed)
        :ok
      end,
      restart: fn -> flunk("ordinary restart must not run") end,
      wait_healthy: fn ->
        send(test_pid, :healthy)
        {:ok, %{state: :healthy}}
      end
    }

    assert {:ok, %{state: :healthy}} = Lifecycle.restart(force: true, deps: deps)
    assert_received :killed
    assert_received :healthy
  end
end
