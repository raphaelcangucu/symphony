defmodule SymphonyElixir.Observability.SqlLog do
  @moduledoc """
  Routes Ecto query logs to the dedicated SQL log file.

  The stock Ecto query logger is disabled (`log: false` on the Repo) because its
  debug lines dominated `log/symphony.log` and shrank the rotation window to a
  few minutes, making incident debugging impossible. This handler re-emits the
  same information from the `[:symphony_elixir, :repo, :query]` telemetry event,
  tagged with the `#{inspect([:symphony, :sql])}` logger domain so
  `SymphonyElixir.LogFile` can fan it out to `log/symphony.sql.log` and keep it
  out of the main application log.
  """

  require Logger

  @event [:symphony_elixir, :repo, :query]
  @handler_id "symphony-sql-log"
  @domain [:symphony, :sql]

  @spec domain() :: [atom()]
  def domain, do: @domain

  @doc """
  Domain as seen by `:logger` filters. `Logger` prepends `:elixir` to every
  Elixir-emitted event's domain, so handler filters must match against this
  value, not `domain/0`.
  """
  @spec filter_domain() :: [atom()]
  def filter_domain, do: [:elixir | @domain]

  @doc "Attaches the SQL log handler. Idempotent: a duplicate attach is ignored."
  @spec attach(keyword()) :: :ok
  def attach(opts \\ []) when is_list(opts) do
    case :telemetry.attach(handler_id(opts), @event, &__MODULE__.handle_event/4, %{}) do
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
  def handle_event(_event, measurements, metadata, _config) when is_map(measurements) do
    Logger.debug(fn -> format_entry(measurements, metadata) end, domain: @domain)
    :ok
  end

  def handle_event(_event, _measurements, _metadata, _config), do: :ok

  @doc false
  @spec format_entry(map(), map()) :: String.t()
  def format_entry(measurements, metadata) do
    "QUERY #{query_result(metadata)} source=#{inspect(Map.get(metadata, :source))}" <>
      " db=#{native_to_ms(Map.get(measurements, :query_time))}ms" <>
      " queue=#{native_to_ms(Map.get(measurements, :queue_time))}ms" <>
      " total=#{native_to_ms(Map.get(measurements, :total_time))}ms " <>
      to_string(Map.get(metadata, :query, "")) <>
      " params=#{inspect(Map.get(metadata, :params, []), limit: 50, printable_limit: 500, charlists: :as_lists)}" <>
      caller_suffix(metadata)
  end

  defp query_result(%{result: {:ok, _}}), do: "OK"
  defp query_result(%{result: {:error, _}}), do: "ERROR"
  defp query_result(_metadata), do: "?"

  # First application frame from the Repo `stacktrace: true` metadata, mirroring
  # the "↳ caller" suffix of the stock Ecto logger.
  defp caller_suffix(%{stacktrace: [_ | _] = stacktrace}) do
    case Enum.find(stacktrace, &app_frame?/1) do
      {module, fun, arity, location} ->
        " ↳ #{inspect(module)}.#{fun}/#{arity}#{location_suffix(location)}"

      _no_app_frame ->
        ""
    end
  end

  defp caller_suffix(_metadata), do: ""

  defp app_frame?({module, _fun, _arity, _location}) do
    module |> Atom.to_string() |> String.starts_with?("Elixir.SymphonyElixir")
  end

  defp app_frame?(_frame), do: false

  defp location_suffix(location) when is_list(location) do
    file = Keyword.get(location, :file)
    line = Keyword.get(location, :line)

    if file, do: ", at: #{file}:#{line}", else: ""
  end

  defp location_suffix(_location), do: ""

  defp native_to_ms(native) when is_integer(native) do
    max(System.convert_time_unit(native, :native, :millisecond), 0)
  end

  defp native_to_ms(_native), do: 0

  defp handler_id(opts), do: Keyword.get(opts, :handler_id, @handler_id)
end
