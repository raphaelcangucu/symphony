defmodule SymphonyElixir.Observability.Metrics do
  @moduledoc """
  Thin wrapper around `:telemetry` for Symphony's request-isolation guardrails.

  Emits structured duration, payload-byte, and outcome measurements so a slow or
  oversized request becomes observable without introducing a separate request
  scheduler. All events are published under the `[:symphony | event]` prefix.
  """

  @prefix :symphony

  @typedoc "Event suffix appended to the `:symphony` prefix, e.g. `[:assistant, :history]`."
  @type event :: [atom(), ...]

  @doc """
  Emits a telemetry event with the given measurements and metadata.

  Never raises: telemetry dispatch failures are swallowed so instrumentation can
  never take down the caller.
  """
  @spec emit(event(), map(), map()) :: :ok
  def emit(event, measurements, metadata)
      when is_list(event) and event != [] and is_map(measurements) and is_map(metadata) do
    :telemetry.execute([@prefix | event], measurements, metadata)
    :ok
  rescue
    _ -> :ok
  catch
    _, _ -> :ok
  end

  @doc """
  Times `fun`, emits `duration_ms` merged with any measurements derived from the
  result, and returns the result unchanged.

  `measurements_fun` receives the result and returns extra measurements to merge
  (e.g. `payload_bytes`, `message_count`). It defaults to no extra measurements.
  """
  @spec span(event(), map(), (-> result), (result -> map())) :: result when result: var
  def span(event, metadata, fun, measurements_fun \\ &default_measurements/1)
      when is_list(event) and is_map(metadata) and is_function(fun, 0) and
             is_function(measurements_fun, 1) do
    start = System.monotonic_time()
    result = fun.()
    measurements = Map.put(safe_measurements(measurements_fun, result), :duration_ms, duration_ms(start))
    emit(event, measurements, metadata)
    result
  end

  @doc "Monotonic start reference for manual timing via `duration_ms/1`."
  @spec monotonic_start() :: integer()
  def monotonic_start, do: System.monotonic_time()

  @doc "Elapsed milliseconds since a `monotonic_start/0` reference."
  @spec duration_ms(integer()) :: non_neg_integer()
  def duration_ms(start) when is_integer(start) do
    max(System.convert_time_unit(System.monotonic_time() - start, :native, :millisecond), 0)
  end

  @doc """
  Approximate serialized byte size of `term`, used for payload-size telemetry.

  Uses `:erlang.external_size/1` (a full traversal without allocating a large
  binary) so it stays proportional to on-the-wire size for oversized-payload
  detection. Returns `0` on any failure.
  """
  @spec payload_bytes(term()) :: non_neg_integer()
  def payload_bytes(term) do
    :erlang.external_size(term)
  rescue
    _ -> 0
  catch
    _, _ -> 0
  end

  defp default_measurements(_result), do: %{}

  defp safe_measurements(measurements_fun, result) do
    case measurements_fun.(result) do
      %{} = measurements -> measurements
      _ -> %{}
    end
  rescue
    _ -> %{}
  catch
    _, _ -> %{}
  end
end
