defmodule SymphonyElixir.GitHub.ReadCacheTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.GitHub.ReadCache

  setup do
    unless Process.whereis(SymphonyElixir.TaskSupervisor) do
      start_supervised!({Task.Supervisor, name: SymphonyElixir.TaskSupervisor})
    end

    unless Process.whereis(ReadCache) do
      start_supervised!(ReadCache)
    end

    ReadCache.invalidate_all()
    on_exit(fn -> ReadCache.invalidate_all() end)
    :ok
  end

  test "returns the fetched value and caches it for the TTL" do
    counter = :counters.new(1, [])

    fun = fn ->
      :counters.add(counter, 1, 1)
      {:ok, :counters.get(counter, 1)}
    end

    assert {:ok, 1} = ReadCache.fetch({:k, 1}, fun, 60_000)
    assert {:ok, 1} = ReadCache.fetch({:k, 1}, fun, 60_000)
    assert :counters.get(counter, 1) == 1
  end

  test "does not cache error results" do
    counter = :counters.new(1, [])

    fun = fn ->
      :counters.add(counter, 1, 1)
      {:error, :boom}
    end

    assert {:error, :boom} = ReadCache.fetch({:k, :err}, fun, 60_000)
    assert {:error, :boom} = ReadCache.fetch({:k, :err}, fun, 60_000)
    assert :counters.get(counter, 1) == 2
  end

  test "coalesces concurrent misses into a single underlying fetch" do
    counter = :counters.new(1, [])

    # The in-flight fetch is slow, so callers arriving during the window pile up as
    # waiters on the same key instead of each triggering their own fetch.
    fun = fn ->
      :counters.add(counter, 1, 1)
      Process.sleep(100)
      {:ok, :value}
    end

    tasks =
      for _ <- 1..5 do
        Task.async(fn -> ReadCache.fetch({:k, :concurrent}, fun, 60_000) end)
      end

    results = Task.await_many(tasks, 5_000)

    assert Enum.all?(results, &(&1 == {:ok, :value}))
    assert :counters.get(counter, 1) == 1
  end

  test "expired entries trigger a re-fetch" do
    counter = :counters.new(1, [])

    fun = fn ->
      :counters.add(counter, 1, 1)
      {:ok, :counters.get(counter, 1)}
    end

    assert {:ok, 1} = ReadCache.fetch({:k, :ttl}, fun, 1)
    Process.sleep(5)
    assert {:ok, 2} = ReadCache.fetch({:k, :ttl}, fun, 1)
  end

  test "invalidate forces a re-fetch" do
    counter = :counters.new(1, [])

    fun = fn ->
      :counters.add(counter, 1, 1)
      {:ok, :counters.get(counter, 1)}
    end

    assert {:ok, 1} = ReadCache.fetch({:k, :inv}, fun, 60_000)
    ReadCache.invalidate({:k, :inv})
    assert {:ok, 2} = ReadCache.fetch({:k, :inv}, fun, 60_000)
  end

  test "a raised exception in the fetch fun does not wedge the key" do
    crash = fn -> raise "boom" end

    assert {:error, {:read_cache_exception, %RuntimeError{}}} =
             ReadCache.fetch({:k, :crash}, crash, 60_000)

    # Key is not wedged: a subsequent successful fetch resolves.
    assert {:ok, :recovered} = ReadCache.fetch({:k, :crash}, fn -> {:ok, :recovered} end, 60_000)
  end
end
