defmodule SymphonyElixir.Daemon.ShutdownTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Daemon.Shutdown

  test "begin_drain closes admission immediately" do
    name = Module.concat(__MODULE__, :Gate)
    start_supervised!({Shutdown, name: name})

    assert Shutdown.admitting?(name)
    assert :ok = Shutdown.begin_drain(name)
    refute Shutdown.admitting?(name)
  end

  test "drain waits for active work to reach zero" do
    {:ok, snapshots} =
      Agent.start_link(fn ->
        [%{assistant: [1], issues: ["SYM-1"]}, %{assistant: [], issues: []}]
      end)

    work = fn ->
      Agent.get_and_update(snapshots, fn [head | tail] ->
        {head, if(tail == [], do: [head], else: tail)}
      end)
    end

    assert {:ok, %{assistant: [], issues: []}} =
             Shutdown.drain(100,
               begin_drain: fn -> :ok end,
               work_snapshot: work,
               sleep: fn _ -> :ok end,
               monotonic_ms: monotonic_sequence([0, 10])
             )
  end

  test "drain timeout interrupts assistant work once" do
    test_pid = self()

    assert {:timeout, %{assistant: [7], issues: ["SYM-7"]}} =
             Shutdown.drain(5,
               begin_drain: fn -> :ok end,
               work_snapshot: fn -> %{assistant: [7], issues: ["SYM-7"]} end,
               interrupt_assistants: fn ids, reason ->
                 send(test_pid, {:interrupted, ids, reason})
                 :ok
               end,
               sleep: fn _ -> :ok end,
               monotonic_ms: monotonic_sequence([0, 6])
             )

    assert_received {:interrupted, [7], "daemon_shutdown_timeout"}
  end

  test "application prep_stop drains only installed mode" do
    previous = Application.get_env(:symphony_elixir, :build_info)

    on_exit(fn ->
      if previous do
        Application.put_env(:symphony_elixir, :build_info, previous)
      else
        Application.delete_env(:symphony_elixir, :build_info)
      end

      Shutdown.reset()
    end)

    Application.put_env(:symphony_elixir, :build_info, %{mode: "development"})
    :ok = Shutdown.reset()
    assert :state == SymphonyElixir.Application.prep_stop(:state)
    assert Shutdown.admitting?()

    Application.put_env(:symphony_elixir, :build_info, %{mode: "installed"})
    assert :state == SymphonyElixir.Application.prep_stop(:state)
    refute Shutdown.admitting?()
  end

  defp monotonic_sequence(values) do
    {:ok, agent} = Agent.start_link(fn -> values end)

    fn ->
      Agent.get_and_update(agent, fn
        [value] -> {value, [value]}
        [value | rest] -> {value, rest}
      end)
    end
  end
end
