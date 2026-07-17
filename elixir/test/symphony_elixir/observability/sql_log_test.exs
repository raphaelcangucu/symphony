defmodule SymphonyElixir.Observability.SqlLogTest do
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  alias SymphonyElixir.Observability.SqlLog

  @event [:symphony_elixir, :repo, :query]

  test "attach is idempotent and handle_event logs the query line" do
    handler_id = "sql-log-test-#{System.unique_integer([:positive])}"
    assert :ok = SqlLog.attach(handler_id: handler_id)
    assert :ok = SqlLog.attach(handler_id: handler_id)

    log =
      capture_log(fn ->
        :telemetry.execute(
          @event,
          %{query_time: native_ms(3), queue_time: native_ms(1), total_time: native_ms(5)},
          %{
            query: "SELECT id FROM local_tracker_issues WHERE id = ?",
            params: [42],
            source: "local_tracker_issues",
            result: {:ok, %{}}
          }
        )
      end)

    assert log =~ "QUERY OK"
    assert log =~ "source=\"local_tracker_issues\""
    assert log =~ "db=3ms"
    assert log =~ "SELECT id FROM local_tracker_issues"
    assert log =~ "params=[42]"

    assert :ok = SqlLog.detach(handler_id: handler_id)
  end

  test "format_entry marks failed queries and appends the app caller frame" do
    entry =
      SqlLog.format_entry(
        %{query_time: native_ms(2), queue_time: 0, total_time: native_ms(2)},
        %{
          query: "UPDATE x SET y = ?",
          params: ["z"],
          source: "x",
          result: {:error, :boom},
          stacktrace: [
            {Ecto.Adapters.SQL, :query, 4, file: ~c"lib/ecto/adapters/sql.ex", line: 1},
            {SymphonyElixir.DevServer.Manager, :list_for_issue, 2, file: ~c"lib/symphony_elixir/dev_server/manager.ex", line: 230}
          ]
        }
      )

    assert entry =~ "QUERY ERROR"
    assert entry =~ "SymphonyElixir.DevServer.Manager.list_for_issue/2"
    assert entry =~ "manager.ex:230"
  end

  test "format_entry tolerates missing metadata" do
    entry = SqlLog.format_entry(%{}, %{})

    assert entry =~ "QUERY ?"
    assert entry =~ "db=0ms"
  end

  defp native_ms(ms), do: System.convert_time_unit(ms, :millisecond, :native)
end
