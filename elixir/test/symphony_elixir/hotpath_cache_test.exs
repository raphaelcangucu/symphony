defmodule SymphonyElixir.HotpathCacheTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.HotpathCache

  setup do
    # A long-lived owner keeps the ETS tables alive across the short-lived Task
    # processes the concurrency tests spawn (an unowned table would be deleted
    # when its creating Task exits). The running app usually already owns it.
    unless Process.whereis(SymphonyElixir.HotpathCache.Owner) do
      start_supervised!(SymphonyElixir.HotpathCache.Owner)
    end

    HotpathCache.invalidate_all()
    :ok
  end

  defp unique_key(label), do: {:hotpath_test, label, System.unique_integer([:positive])}

  defp counter, do: :counters.new(1, [:atomics])
  defp bump(ref), do: :counters.add(ref, 1, 1)
  defp count(ref), do: :counters.get(ref, 1)

  defp eventually(fun, attempts \\ 100)
  defp eventually(_fun, 0), do: flunk("condition never became true")

  defp eventually(fun, attempts) do
    case fun.() do
      {:ok, value} -> value
      _ -> Process.sleep(10) && eventually(fun, attempts - 1)
    end
  end

  describe "put/3 and fetch/1" do
    test "returns a fresh value and misses after the TTL elapses" do
      key = unique_key(:ttl)
      assert :ok = HotpathCache.put(key, :cached, 50)
      assert {:ok, :cached} = HotpathCache.fetch(key)

      Process.sleep(70)
      assert :miss = HotpathCache.fetch(key)
    end
  end

  describe "fetch_or_store/4" do
    test "computes and stores on a cold miss" do
      key = unique_key(:cold)
      ref = counter()

      value =
        HotpathCache.fetch_or_store(key, 1_000, fn ->
          bump(ref)
          :built
        end)

      assert value == :built
      assert count(ref) == 1
      assert {:ok, :built} = HotpathCache.fetch(key)
    end

    test "returns the cached value without recomputing on a hit" do
      key = unique_key(:hit)
      ref = counter()

      assert :built =
               HotpathCache.fetch_or_store(key, 1_000, fn ->
                 bump(ref)
                 :built
               end)

      assert :built =
               HotpathCache.fetch_or_store(key, 1_000, fn ->
                 bump(ref)
                 :rebuilt
               end)

      assert count(ref) == 1
    end

    test "runs the compute once for concurrent cold misses (single-flight)" do
      key = unique_key(:single_flight)
      ref = counter()
      test_pid = self()

      tasks =
        for _ <- 1..8 do
          Task.async(fn ->
            HotpathCache.fetch_or_store(key, 1_000, fn ->
              bump(ref)
              send(test_pid, :computed)
              Process.sleep(100)
              :shared
            end)
          end)
        end

      results = Task.await_many(tasks, 5_000)

      assert Enum.all?(results, &(&1 == :shared))
      assert count(ref) == 1
    end

    test "computes directly when the leader exceeds the wait budget" do
      key = unique_key(:slow_leader)
      ref = counter()
      test_pid = self()

      leader =
        Task.async(fn ->
          HotpathCache.fetch_or_store(key, 1_000, fn ->
            bump(ref)
            send(test_pid, :leader_acquired)
            Process.sleep(300)
            :leader
          end)
        end)

      assert_receive :leader_acquired, 1_000

      loser =
        HotpathCache.fetch_or_store(
          key,
          1_000,
          fn ->
            bump(ref)
            :loser
          end,
          wait_ms: 50
        )

      assert loser == :loser
      assert Task.await(leader, 2_000) == :leader
      assert count(ref) == 2
    end

    test "serves a stale value immediately and refreshes it in the background" do
      key = unique_key(:stale)

      assert :old = HotpathCache.fetch_or_store(key, 20, fn -> :old end, stale_ms: 2_000)
      Process.sleep(40)

      assert :old =
               HotpathCache.fetch_or_store(
                 key,
                 500,
                 fn ->
                   Process.sleep(30)
                   :new
                 end,
                 stale_ms: 2_000
               )

      assert :new = eventually(fn -> HotpathCache.fetch(key) end)
    end

    test "coalesces concurrent stale refreshes into one background compute" do
      key = unique_key(:stale_single_flight)
      ref = counter()

      assert :old = HotpathCache.fetch_or_store(key, 20, fn -> :old end, stale_ms: 2_000)
      Process.sleep(40)

      refresh = fn ->
        bump(ref)
        Process.sleep(120)
        :new
      end

      assert :old = HotpathCache.fetch_or_store(key, 500, refresh, stale_ms: 2_000)
      assert :old = HotpathCache.fetch_or_store(key, 500, refresh, stale_ms: 2_000)

      assert :new = eventually(fn -> HotpathCache.fetch(key) end)
      assert count(ref) == 1
    end
  end

  describe "telemetry" do
    setup do
      handler_id = {__MODULE__, :telemetry, System.unique_integer([:positive])}
      test_pid = self()

      :telemetry.attach_many(
        handler_id,
        [
          [:symphony, :hotpath, :fetch],
          [:symphony, :hotpath, :recompute]
        ],
        fn event, measurements, metadata, _config ->
          send(test_pid, {:telemetry, event, measurements, metadata})
        end,
        nil
      )

      on_exit(fn -> :telemetry.detach(handler_id) end)
      :ok
    end

    test "emits a miss fetch and a computed recompute on a cold miss" do
      key = unique_key(:telemetry_miss)

      assert :built = HotpathCache.fetch_or_store(key, 1_000, fn -> :built end)

      assert_receive {:telemetry, [:symphony, :hotpath, :fetch], %{count: 1}, %{hit: :miss}}

      assert_receive {:telemetry, [:symphony, :hotpath, :recompute], %{duration_ms: duration}, %{outcome: :computed}}

      assert is_integer(duration)
    end

    test "emits a fresh fetch and no recompute on a hit" do
      key = unique_key(:telemetry_hit)
      HotpathCache.fetch_or_store(key, 1_000, fn -> :built end)

      assert_receive {:telemetry, [:symphony, :hotpath, :recompute], _, %{outcome: :computed}}

      assert :built = HotpathCache.fetch_or_store(key, 1_000, fn -> :rebuilt end)

      assert_receive {:telemetry, [:symphony, :hotpath, :fetch], %{count: 1}, %{hit: :fresh}}
      refute_receive {:telemetry, [:symphony, :hotpath, :recompute], _, _}
    end
  end

  describe "invalidate/1 and invalidate_all/0" do
    test "invalidate removes a single key" do
      key = unique_key(:inv)
      HotpathCache.put(key, :v, 1_000)
      assert :ok = HotpathCache.invalidate(key)
      assert :miss = HotpathCache.fetch(key)
    end

    test "invalidate_all clears every entry" do
      HotpathCache.put(unique_key(:a), 1, 1_000)
      HotpathCache.put(unique_key(:b), 2, 1_000)
      assert :ok = HotpathCache.invalidate_all()
    end
  end
end
