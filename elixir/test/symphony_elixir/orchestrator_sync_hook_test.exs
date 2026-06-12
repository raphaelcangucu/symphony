defmodule SymphonyElixir.OrchestratorSyncHookTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.Sync.Engine

  test "request_sync returns :ok immediately (non-blocking contract)" do
    assert Engine.request_sync(force: true) == :ok
  end

  test "request_sync_project returns :ok immediately (non-blocking contract)" do
    assert Engine.request_sync_project("any-slug", force: true) == :ok
  end
end
