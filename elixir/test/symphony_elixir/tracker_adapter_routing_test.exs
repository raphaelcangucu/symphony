defmodule SymphonyElixir.TrackerAdapterRoutingTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Tracker
  alias SymphonyElixir.Tracker.Sync.LocalFirstTracker

  setup do
    original = Application.get_env(:symphony_elixir, :tracker)

    on_exit(fn ->
      if original, do: Application.put_env(:symphony_elixir, :tracker, original), else: Application.delete_env(:symphony_elixir, :tracker)
    end)

    :ok
  end

  test "routes to LocalFirstTracker when sync enabled (default kind github)" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    assert Tracker.adapter() == LocalFirstTracker
  end

  test "does not route to local-first when sync disabled" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: false)
    refute Tracker.adapter() == LocalFirstTracker
  end
end
