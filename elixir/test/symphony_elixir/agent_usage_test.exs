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

  test "stores and retains independent snapshots for active and inactive accounts" do
    :ok = AgentUsage.put("codex", "personal", %{sample("codex") | plan: "personal"})
    :ok = AgentUsage.put("codex", "work", %{sample("codex") | plan: "team"})

    assert %Snapshot{account_id: "personal", plan: "personal"} =
             AgentUsage.get("codex", "personal")

    assert %Snapshot{account_id: "work", plan: "team"} = AgentUsage.get("codex", "work")
    assert Enum.sort(AgentUsage.account_ids("codex")) == ["personal", "work"]
  end

  test "a stale generation cannot overwrite a newer response" do
    assert {:ok, generation_one} = AgentUsage.begin_refresh("claude", "work", now_ms: 100)
    assert {:ok, generation_two} = AgentUsage.begin_refresh("claude", "work", now_ms: 200, force: true)

    assert :ignored =
             AgentUsage.complete_refresh(
               "claude",
               "work",
               generation_one,
               {:ok, %{sample("claude") | plan: "late"}},
               now_ms: 300
             )

    assert :ok =
             AgentUsage.complete_refresh(
               "claude",
               "work",
               generation_two,
               {:ok, %{sample("claude") | plan: "current"}},
               now_ms: 400
             )

    assert %Snapshot{plan: "current"} = AgentUsage.get("claude", "work")
  end

  test "failed refresh keeps the prior snapshot and isolates other accounts" do
    :ok = AgentUsage.put("claude", "personal", %{sample("claude") | plan: "personal"})
    :ok = AgentUsage.put("claude", "work", %{sample("claude") | plan: "work"})
    assert {:ok, generation} = AgentUsage.begin_refresh("claude", "work", now_ms: 1_000)

    assert :ok =
             AgentUsage.complete_refresh(
               "claude",
               "work",
               generation,
               {:error, :timeout},
               now_ms: 1_100,
               backoff_ms: 2_000
             )

    assert %{snapshot: %Snapshot{plan: "work"}, state: :stale, stale_reason: :timeout, next_refresh_at: 3_100} =
             AgentUsage.entry("claude", "work")

    assert %{snapshot: %Snapshot{plan: "personal"}, state: :fresh} =
             AgentUsage.entry("claude", "personal")
  end
end
