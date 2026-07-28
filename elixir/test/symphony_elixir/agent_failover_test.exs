defmodule SymphonyElixir.AgentFailoverTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentAccounts
  alias SymphonyElixir.AgentFailover
  alias SymphonyElixir.AgentUsage
  alias SymphonyElixir.AgentUsage.{Snapshot, Window}

  setup do
    root = Path.join(System.tmp_dir!(), "agent-failover-#{System.unique_integer([:positive])}")
    previous = Application.get_env(:symphony_elixir, :agent_data_dir)
    Application.put_env(:symphony_elixir, :agent_data_dir, root)
    AgentUsage.reset()

    on_exit(fn ->
      File.rm_rf(root)
      AgentUsage.reset()

      if previous do
        Application.put_env(:symphony_elixir, :agent_data_dir, previous)
      else
        Application.delete_env(:symphony_elixir, :agent_data_dir)
      end
    end)

    create("codex", "personal", "authenticated")
    create("codex", "work", "authenticated")
    create("codex", "backup", "authenticated")
    :ok
  end

  test "disabled policy keeps the preferred account even when usage is exhausted" do
    exhausted("codex", "personal", 2_000)

    assert {:ok, %{id: "personal"}, %{failed_over: false}} =
             AgentFailover.resolve("codex", nil, "personal", enabled: false, now_seconds: 1_000)
  end

  test "enabled policy picks the first stable eligible fallback" do
    exhausted("codex", "personal", 2_000)

    assert {:ok, %{id: "work"}, %{failed_over: true, preferred_account_id: "personal"}} =
             AgentFailover.resolve("codex", nil, "personal", enabled: true, now_seconds: 1_000)
  end

  test "excludes authentication, fresh rate-limit, and runtime failures" do
    now_ms = System.monotonic_time(:millisecond)
    exhausted("codex", "personal", 2_000)

    assert {:ok, generation} = AgentUsage.begin_refresh("codex", "work", now_ms: now_ms)

    assert :ok =
             AgentUsage.complete_refresh(
               "codex",
               "work",
               generation,
               {:error, {:rate_limited, 30_000}},
               now_ms: now_ms,
               backoff_ms: 30_000
             )

    assert {:error, {:all_accounts_ineligible, summary}} =
             AgentFailover.resolve("codex", nil, "personal",
               enabled: true,
               now_seconds: 1_000,
               now_ms: now_ms + 1,
               runtime_ineligible: %{"backup" => :runtime_unavailable}
             )

    assert summary == [
             %{account_id: "personal", reason: :usage_exhausted},
             %{account_id: "work", reason: :rate_limited},
             %{account_id: "backup", reason: :runtime_unavailable}
           ]

    {:ok, personal} = AgentAccounts.resolve("codex", nil, "personal")
    refute inspect(summary) =~ personal.home
  end

  test "expired reset makes a formerly exhausted account eligible again" do
    exhausted("codex", "personal", 900)

    assert {:ok, %{id: "personal"}, %{failed_over: false}} =
             AgentFailover.resolve("codex", nil, "personal", enabled: true, now_seconds: 1_000)
  end

  test "stale usage without a current rate-limit or auth proof remains eligible" do
    AgentUsage.put("codex", "personal", usage("codex", 100, 2_000))
    assert {:ok, generation} = AgentUsage.begin_refresh("codex", "personal", now_ms: 10)

    assert :ok =
             AgentUsage.complete_refresh(
               "codex",
               "personal",
               generation,
               {:error, :timeout},
               now_ms: 10,
               backoff_ms: 1_000
             )

    assert {:ok, %{id: "personal"}, %{failed_over: false}} =
             AgentFailover.resolve("codex", nil, "personal",
               enabled: true,
               now_seconds: 1_000,
               now_ms: 20
             )
  end

  defp create(agent, id, status) do
    {:ok, _account} =
      AgentAccounts.create(agent, %{
        id: id,
        label: String.capitalize(id),
        authentication_status: status
      })
  end

  defp exhausted(agent, account, resets_at),
    do: AgentUsage.put(agent, account, usage(agent, 100, resets_at))

  defp usage(agent, percent, resets_at) do
    %Snapshot{
      agent_kind: agent,
      windows: [
        %Window{
          kind: :session,
          used_percent: percent,
          resets_at: resets_at,
          window_minutes: nil
        }
      ]
    }
  end
end
