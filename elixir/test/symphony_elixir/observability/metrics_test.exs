defmodule SymphonyElixir.Observability.MetricsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Observability.Metrics

  setup context do
    handler_id = {__MODULE__, context.test}
    test_pid = self()

    :telemetry.attach(
      handler_id,
      [:symphony, :test, :event],
      fn event, measurements, metadata, _config ->
        send(test_pid, {:telemetry, event, measurements, metadata})
      end,
      nil
    )

    on_exit(fn -> :telemetry.detach(handler_id) end)
    :ok
  end

  describe "emit/3" do
    test "publishes the event under the :symphony prefix" do
      assert :ok = Metrics.emit([:test, :event], %{count: 1}, %{key: "abc"})

      assert_receive {:telemetry, [:symphony, :test, :event], %{count: 1}, %{key: "abc"}}
    end

    test "never raises when the handler crashes" do
      :telemetry.attach(
        {__MODULE__, :crashing},
        [:symphony, :test, :event],
        fn _event, _measurements, _metadata, _config -> raise "boom" end,
        nil
      )

      on_exit(fn -> :telemetry.detach({__MODULE__, :crashing}) end)

      assert :ok = Metrics.emit([:test, :event], %{count: 1}, %{})
    end
  end

  describe "span/4" do
    test "emits duration and returns the result unchanged" do
      assert :computed = Metrics.span([:test, :event], %{key: "k"}, fn -> :computed end)

      assert_receive {:telemetry, [:symphony, :test, :event], measurements, %{key: "k"}}
      assert is_integer(measurements.duration_ms)
      assert measurements.duration_ms >= 0
    end

    test "merges measurements derived from the result" do
      result =
        Metrics.span([:test, :event], %{}, fn -> [1, 2, 3] end, fn list ->
          %{message_count: length(list)}
        end)

      assert result == [1, 2, 3]
      assert_receive {:telemetry, [:symphony, :test, :event], %{message_count: 3, duration_ms: _}, _}
    end

    test "ignores a measurements_fun that does not return a map" do
      assert :ok = Metrics.span([:test, :event], %{}, fn -> :ok end, fn _ -> :not_a_map end)

      assert_receive {:telemetry, [:symphony, :test, :event], measurements, _}
      assert Map.keys(measurements) == [:duration_ms]
    end

    test "ignores a measurements_fun that raises" do
      assert :ok = Metrics.span([:test, :event], %{}, fn -> :ok end, fn _ -> raise "boom" end)

      assert_receive {:telemetry, [:symphony, :test, :event], %{duration_ms: _}, _}
    end
  end

  describe "payload_bytes/1" do
    test "returns a positive size proportional to the term" do
      small = Metrics.payload_bytes(%{a: 1})
      large = Metrics.payload_bytes(%{a: String.duplicate("x", 10_000)})

      assert small > 0
      assert large > small
    end
  end

  describe "duration_ms/1" do
    test "never returns a negative value" do
      assert Metrics.duration_ms(Metrics.monotonic_start()) >= 0
    end
  end
end
