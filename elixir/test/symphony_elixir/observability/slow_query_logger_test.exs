defmodule SymphonyElixir.Observability.SlowQueryLoggerTest do
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  alias SymphonyElixir.Observability.SlowQueryLogger

  @event [:symphony_elixir, :repo, :query]

  setup do
    handler_id = "slow-query-test-#{System.unique_integer([:positive])}"
    SlowQueryLogger.attach(handler_id: handler_id, queue_ms: 50, query_ms: 100)
    on_exit(fn -> SlowQueryLogger.detach(handler_id: handler_id) end)
    :ok
  end

  defp ms(value), do: System.convert_time_unit(value, :millisecond, :native)

  test "logs a warning when queue time exceeds the threshold" do
    log =
      capture_log(fn ->
        :telemetry.execute(@event, %{queue_time: ms(75), query_time: ms(1), total_time: ms(76)}, %{
          source: "assistant_messages",
          result: {:ok, %{}}
        })
      end)

    assert log =~ "slow_query"
    assert log =~ "queue_ms=75"
    assert log =~ "assistant_messages"
  end

  test "logs a warning when query time exceeds the threshold" do
    log =
      capture_log(fn ->
        :telemetry.execute(@event, %{queue_time: ms(1), query_time: ms(150), total_time: ms(151)}, %{
          source: "assistant_messages",
          result: {:ok, %{}}
        })
      end)

    assert log =~ "slow_query"
    assert log =~ "query_ms=150"
  end

  test "stays silent for a fast query" do
    log =
      capture_log(fn ->
        :telemetry.execute(@event, %{queue_time: ms(1), query_time: ms(2), total_time: ms(3)}, %{
          source: "assistant_messages",
          result: {:ok, %{}}
        })
      end)

    refute log =~ "slow_query"
  end

  test "tolerates missing measurements without raising" do
    log =
      capture_log(fn ->
        assert :ok = SlowQueryLogger.handle_event(@event, %{}, %{}, %{queue_ms: 50, query_ms: 100})
      end)

    refute log =~ "slow_query"
  end

  test "attach is idempotent" do
    assert :ok = SlowQueryLogger.attach(handler_id: "slow-query-idempotent")
    assert :ok = SlowQueryLogger.attach(handler_id: "slow-query-idempotent")
    SlowQueryLogger.detach(handler_id: "slow-query-idempotent")
  end
end
