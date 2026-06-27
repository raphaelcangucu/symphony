defmodule SymphonyElixir.AgentUsageTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentUsage
  alias SymphonyElixir.AgentUsage.Snapshot
  alias SymphonyElixir.AgentUsage.Window

  setup do
    AgentUsage.reset()
    :ok
  end

  defp sample(agent_kind) do
    Window.normalize(
      agent_kind,
      %{"limit_name" => "max", "primary" => %{"usedPercent" => 30, "resets_at" => 1_900_000_000}},
      0
    )
  end

  test "put/2 then get/1 returns the snapshot stamped with fetched_at" do
    assert AgentUsage.get("claude") == nil
    :ok = AgentUsage.put("claude", sample("claude"))

    got = AgentUsage.get("claude")
    assert %Snapshot{agent_kind: "claude"} = got
    assert is_integer(got.fetched_at)
  end

  test "snapshot/0 returns an entry per known agent; missing agents are nil + stale" do
    :ok = AgentUsage.put("codex", sample("codex"))
    snap = AgentUsage.snapshot()

    assert %{snapshot: %Snapshot{agent_kind: "codex"}, stale: false} = snap.codex
    assert %{snapshot: nil, stale: true} = snap.claude
    assert %{snapshot: nil, stale: true} = snap.cursor
  end

  test "entries older than the TTL are reported stale but still returned" do
    :ok = AgentUsage.put("claude", sample("claude"))
    refute AgentUsage.stale?("claude")

    future = System.monotonic_time(:millisecond) + 10_000_000
    assert AgentUsage.stale?("claude", future)
    assert %Snapshot{} = AgentUsage.get("claude")
    assert %{snapshot: %Snapshot{}, stale: true} = AgentUsage.snapshot(future).claude
  end
end
