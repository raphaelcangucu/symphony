defmodule SymphonyElixir.Tracker.IssueAdapterRoutingTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Tracker.Sync.LocalFirstAdapter

  setup do
    original = Application.get_env(:symphony_elixir, :tracker)

    on_exit(fn ->
      if original, do: Application.put_env(:symphony_elixir, :tracker, original), else: Application.delete_env(:symphony_elixir, :tracker)
    end)

    :ok
  end

  test "github project routes to LocalFirstAdapter when sync enabled" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    assert IssueAdapter.for(%Project{tracker_kind: "github"}) == LocalFirstAdapter
  end

  test "github project routes to the remote adapter when sync disabled" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: false)
    assert IssueAdapter.for(%Project{tracker_kind: "github"}) == SymphonyElixir.GitHub.IssueAdapter
  end

  test "local project always routes to the local adapter" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    assert IssueAdapter.for(%Project{tracker_kind: "local"}) == SymphonyElixir.LocalTracker.IssueAdapter
  end
end
