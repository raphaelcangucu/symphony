defmodule SymphonyElixir.Observability.ReporterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Observability.Reporter
  alias SymphonyElixirWeb.ObservabilityPubSub

  setup do
    case Process.whereis(SymphonyElixir.PubSub) do
      nil -> start_supervised!({Phoenix.PubSub, name: SymphonyElixir.PubSub})
      _pid -> :ok
    end

    test_pid = self()

    deliver = fn report ->
      send(test_pid, {:reported, report})
      :ok
    end

    %{deliver: deliver}
  end

  defp opts(deliver, extra \\ []) do
    Keyword.merge(
      [
        name: :"reporter_#{System.unique_integer([:positive])}",
        deliver_fun: deliver,
        snapshot_fun: fn -> %{counts: %{running: 0, retrying: 0}, running: [], retrying: []} end,
        identity_fun: fn -> %{"runtime_id" => "r1", "label" => "proj"} end,
        heartbeat_interval_ms: 30,
        min_report_interval_ms: 5
      ],
      extra
    )
  end

  test "reports on heartbeat", %{deliver: deliver} do
    start_supervised!({Reporter, opts(deliver)})
    assert_receive {:reported, %{"runtime_id" => "r1", "snapshot" => _}}, 500
  end

  test "reports immediately on observability_updated", %{deliver: deliver} do
    start_supervised!({Reporter, opts(deliver, heartbeat_interval_ms: 10_000)})

    receive do
      {:reported, _} -> :ok
    after
      200 -> :ok
    end

    ObservabilityPubSub.broadcast_update()
    assert_receive {:reported, %{"runtime_id" => "r1"}}, 500
  end

  test "coalesces bursts within min_report_interval_ms", %{deliver: deliver} do
    start_supervised!({Reporter, opts(deliver, heartbeat_interval_ms: 10_000, min_report_interval_ms: 200)})

    receive do
      {:reported, _} -> :ok
    after
      200 -> :ok
    end

    for _ <- 1..5, do: ObservabilityPubSub.broadcast_update()

    assert_receive {:reported, _}, 500
    refute_receive {:reported, _}, 100
  end

  test "keeps issuing heartbeats when delivery returns an error" do
    test_pid = self()

    failing_deliver = fn report ->
      send(test_pid, {:reported, report})
      {:error, :boom}
    end

    start_supervised!({Reporter, opts(failing_deliver)})

    assert_receive {:reported, %{"runtime_id" => "r1"}}, 500
    assert_receive {:reported, %{"runtime_id" => "r1"}}, 500
  end

  test "survives a delivery that raises and keeps reporting" do
    test_pid = self()

    raising_deliver = fn report ->
      send(test_pid, {:reported, report})
      raise "kaboom"
    end

    pid = start_supervised!({Reporter, opts(raising_deliver)})

    assert_receive {:reported, %{"runtime_id" => "r1"}}, 500
    assert_receive {:reported, %{"runtime_id" => "r1"}}, 500
    assert Process.alive?(pid)
  end

  test "survives a delivery that exits and keeps reporting" do
    test_pid = self()

    exiting_deliver = fn report ->
      send(test_pid, {:reported, report})
      exit(:noproc)
    end

    pid = start_supervised!({Reporter, opts(exiting_deliver)})

    assert_receive {:reported, %{"runtime_id" => "r1"}}, 500
    assert_receive {:reported, %{"runtime_id" => "r1"}}, 500
    assert Process.alive?(pid)
  end
end
