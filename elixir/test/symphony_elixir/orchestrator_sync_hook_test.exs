defmodule SymphonyElixir.OrchestratorSyncHookTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.Sync.Engine

  test "request_sync returns :ok immediately (non-blocking contract)" do
    assert Engine.request_sync(force: true) == :ok
  end
end
