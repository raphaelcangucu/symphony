defmodule SymphonyElixir.Observability.SlowQueryLogger do
  @moduledoc """
  Structured logging for slow SQLite queries.

  The `Repo` runs `pool_size: 1` (single writer), so a long queue or query time
  is the clearest signal that one request is starving the others. Rather than
  adding a separate request scheduler, this attaches a handler to the Ecto
  `[:symphony_elixir, :repo, :query]` telemetry event and emits a `Logger.warning`
  whenever `queue_time` or `query_time` crosses a threshold.

  Thresholds default to `SLOW_QUEUE_MS` (50 ms) and `SLOW_QUERY_MS` (100 ms) and
  are overridable per `attach/1` call for tests.
  """

  require Logger

  @event [:symphony_elixir, :repo, :query]
  @handler_id "symphony-slow-query-logger"
  @default_queue_ms 50
  @default_query_ms 100

  @doc """
  Attaches the slow-query handler. Idempotent: a duplicate attach is ignored.

  Options:

    * `:handler_id` — telemetry handler id (defaults to a shared id).
    * `:queue_ms` — queue-time threshold in ms (defaults to `SLOW_QUEUE_MS`/50).
    * `:query_ms` — query-time threshold in ms (defaults to `SLOW_QUERY_MS`/100).
  """
  @spec attach(keyword()) :: :ok
  def attach(opts \\ []) when is_list(opts) do
    config = %{
      queue_ms: Keyword.get(opts, :queue_ms, env_ms("SLOW_QUEUE_MS", @default_queue_ms)),
      query_ms: Keyword.get(opts, :query_ms, env_ms("SLOW_QUERY_MS", @default_query_ms))
    }

    case :telemetry.attach(handler_id(opts), @event, &__MODULE__.handle_event/4, config) do
      :ok -> :ok
      {:error, :already_exists} -> :ok
    end
  end

  @doc "Detaches a previously attached handler. Never raises."
  @spec detach(keyword()) :: :ok
  def detach(opts \\ []) when is_list(opts) do
    _ = :telemetry.detach(handler_id(opts))
    :ok
  end

  @doc false
  @spec handle_event(list(), map(), map(), map()) :: :ok
  def handle_event(_event, measurements, metadata, config) when is_map(measurements) do
    queue_ms = native_to_ms(Map.get(measurements, :queue_time))
    query_ms = native_to_ms(Map.get(measurements, :query_time))
    total_ms = native_to_ms(Map.get(measurements, :total_time))

    if queue_ms > config.queue_ms or query_ms > config.query_ms do
      Logger.warning(fn ->
        "slow_query source=#{inspect(Map.get(metadata, :source))} " <>
          "queue_ms=#{queue_ms} query_ms=#{query_ms} total_ms=#{total_ms} " <>
          "result=#{query_result(metadata)}"
      end)
    end

    :ok
  end

  def handle_event(_event, _measurements, _metadata, _config), do: :ok

  defp query_result(%{result: {:ok, _}}), do: "ok"
  defp query_result(%{result: {:error, _}}), do: "error"
  defp query_result(_metadata), do: "unknown"

  defp native_to_ms(nil), do: 0
  defp native_to_ms(native) when is_integer(native) do
    max(System.convert_time_unit(native, :native, :millisecond), 0)
  end

  defp native_to_ms(_native), do: 0

  defp handler_id(opts), do: Keyword.get(opts, :handler_id, @handler_id)

  defp env_ms(var, default) when is_binary(var) and is_integer(default) do
    case System.get_env(var) do
      value when is_binary(value) ->
        case Integer.parse(String.trim(value)) do
          {parsed, ""} when parsed >= 0 -> parsed
          _ -> default
        end

      _ ->
        default
    end
  end
end
