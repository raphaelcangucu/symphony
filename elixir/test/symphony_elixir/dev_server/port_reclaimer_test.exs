defmodule SymphonyElixir.DevServer.PortReclaimerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.PortReclaimer

  # A bindable? probe that returns the next value of a pre-seeded sequence,
  # repeating the last value once the sequence is exhausted.
  defp seq_bindable(values) do
    {:ok, agent} = Agent.start_link(fn -> values end)

    fun = fn _port ->
      Agent.get_and_update(agent, fn
        [last] -> {last, [last]}
        [head | tail] -> {head, tail}
        [] -> {true, []}
      end)
    end

    {fun, agent}
  end

  defp recording_signal(test_pid) do
    fn signal, pid -> send(test_pid, {:signal, signal, pid}) end
  end

  defp no_sleep, do: fn _ms -> :ok end

  test "no-op when the port is already free (no pids inspected, no signals)" do
    test_pid = self()

    assert :ok =
             PortReclaimer.reclaim(4200,
               bindable?: fn _ -> true end,
               list_pids: fn _ -> send(test_pid, :listed); [] end,
               signal: recording_signal(test_pid),
               sleep: no_sleep()
             )

    refute_received :listed
    refute_received {:signal, _, _}
  end

  test "SIGTERM frees the port without escalating to SIGKILL" do
    test_pid = self()
    # bound on first probe, free afterwards
    {bindable_fun, _agent} = seq_bindable([false, true])

    assert :ok =
             PortReclaimer.reclaim(4200,
               bindable?: bindable_fun,
               list_pids: fn _ -> [111, 222] end,
               signal: recording_signal(test_pid),
               sleep: no_sleep()
             )

    assert_received {:signal, "TERM", 111}
    assert_received {:signal, "TERM", 222}
    refute_received {:signal, "KILL", _}
  end

  test "escalates to SIGKILL when SIGTERM does not free the port" do
    test_pid = self()
    # Stay bound through the whole SIGTERM window, then free after SIGKILL.
    {bindable_fun, _agent} =
      seq_bindable(List.duplicate(false, 4) ++ [true])

    assert :ok =
             PortReclaimer.reclaim(4200,
               bindable?: bindable_fun,
               list_pids: fn _ -> [999] end,
               signal: recording_signal(test_pid),
               sleep: no_sleep(),
               term_attempts: 2,
               term_wait_ms: 0,
               kill_attempts: 3,
               kill_wait_ms: 0
             )

    assert_received {:signal, "TERM", 999}
    assert_received {:signal, "KILL", 999}
  end

  test "returns {:error, :still_bound} when nothing frees the port" do
    test_pid = self()

    assert {:error, :still_bound} =
             PortReclaimer.reclaim(4200,
               bindable?: fn _ -> false end,
               list_pids: fn _ -> [42] end,
               signal: recording_signal(test_pid),
               sleep: no_sleep(),
               term_attempts: 1,
               term_wait_ms: 0,
               kill_attempts: 1,
               kill_wait_ms: 0
             )

    assert_received {:signal, "TERM", 42}
    assert_received {:signal, "KILL", 42}
  end

  test "bound with no discoverable pids waits, then reports still bound" do
    test_pid = self()

    assert {:error, :still_bound} =
             PortReclaimer.reclaim(4200,
               bindable?: fn _ -> false end,
               list_pids: fn _ -> [] end,
               signal: recording_signal(test_pid),
               sleep: no_sleep(),
               term_attempts: 2,
               term_wait_ms: 0
             )

    refute_received {:signal, _, _}
  end

  test "bound with no discoverable pids becomes free during the grace window" do
    {bindable_fun, _agent} = seq_bindable([false, false, true])

    assert :ok =
             PortReclaimer.reclaim(4200,
               bindable?: bindable_fun,
               list_pids: fn _ -> [] end,
               sleep: no_sleep(),
               term_attempts: 5,
               term_wait_ms: 0
             )
  end
end
