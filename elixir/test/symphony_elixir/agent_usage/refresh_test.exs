defmodule SymphonyElixir.AgentUsage.RefreshTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentUsage
  alias SymphonyElixir.AgentUsage.Refresh
  alias SymphonyElixir.AgentUsage.Window

  setup do
    AgentUsage.reset()
    :ok
  end

  test "applies Retry-After and serves the stale snapshot during rate limiting" do
    :ok = AgentUsage.put("codex", "work", sample("codex", "team"))

    assert {:error, :rate_limited} =
             Refresh.run(
               "codex",
               "work",
               fn -> {:error, {:rate_limited, 30_000}} end,
               now_ms: 10_000
             )

    assert %{snapshot: %{plan: "team"}, state: :stale, stale_reason: :rate_limited, next_refresh_at: 40_000} =
             AgentUsage.entry("codex", "work")

    assert :skip =
             Refresh.run("codex", "work", fn -> flunk("backoff must skip HTTP") end, now_ms: 39_999)
  end

  test "auth and timeout failures back off without poisoning another account" do
    :ok = AgentUsage.put("claude", "personal", sample("claude", "pro"))
    :ok = AgentUsage.put("claude", "work", sample("claude", "team"))

    assert {:error, :authentication} =
             Refresh.run("claude", "personal", fn -> {:error, :authentication} end,
               now_ms: 1_000,
               auth_backoff_ms: 60_000
             )

    assert {:error, :timeout} =
             Refresh.run("claude", "work", fn -> {:error, :timeout} end,
               now_ms: 1_000,
               base_backoff_ms: 2_000
             )

    assert %{stale_reason: :authentication, next_refresh_at: 61_000} =
             AgentUsage.entry("claude", "personal")

    assert %{stale_reason: :timeout, next_refresh_at: 3_000} =
             AgentUsage.entry("claude", "work")
  end

  test "a delayed fetch remains attributed to the account that initiated it" do
    parent = self()

    task =
      Task.async(fn ->
        Refresh.run("claude", "personal", fn ->
          send(parent, :fetch_started)

          receive do
            :finish -> {:ok, sample("claude", "personal")}
          end
        end)
      end)

    assert_receive :fetch_started
    :ok = AgentUsage.put("claude", "work", sample("claude", "work"))
    send(task.pid, :finish)
    assert :ok = Task.await(task)

    assert %{snapshot: %{plan: "personal"}} = AgentUsage.entry("claude", "personal")
    assert %{snapshot: %{plan: "work"}} = AgentUsage.entry("claude", "work")
  end

  defp sample(agent, plan) do
    agent
    |> Window.normalize(
      %{"limit_name" => plan, "primary" => %{"usedPercent" => 10}},
      0
    )
    |> Map.put(:plan, plan)
  end
end
