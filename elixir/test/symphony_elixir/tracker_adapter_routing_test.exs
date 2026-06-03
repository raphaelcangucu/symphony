defmodule SymphonyElixir.TrackerAdapterRoutingTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Tracker.Sync.LocalFirstTracker

  setup do
    original = Application.get_env(:symphony_elixir, :tracker)

    on_exit(fn ->
      if original,
        do: Application.put_env(:symphony_elixir, :tracker, original),
        else: Application.delete_env(:symphony_elixir, :tracker)
    end)

    :ok
  end

  test "routes to LocalFirstTracker when sync enabled (default kind github)" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    assert Tracker.adapter() == LocalFirstTracker
  end

  test "routes to LocalFirstTracker when sync enabled even if the global kind is not remote" do
    write_workflow_file!(Workflow.workflow_file_path(), tracker_kind: "memory")
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)

    assert Config.tracker_kind() == "memory"
    assert Tracker.adapter() == LocalFirstTracker
  end

  test "does not route to local-first when sync disabled" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: false)
    refute Tracker.adapter() == LocalFirstTracker
  end
end
