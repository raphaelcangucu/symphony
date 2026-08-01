defmodule SymphonyElixir.Observability.RegistryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentUsage
  alias SymphonyElixir.Observability.Registry

  setup do
    AgentUsage.reset()
    start_supervised!({Phoenix.PubSub, name: :registry_test_pubsub})

    name = :"registry_#{System.unique_integer([:positive])}"

    pid =
      start_supervised!({Registry, name: name, pubsub: :registry_test_pubsub, stale_after_ms: 50, drop_after_ms: 120, sweep_interval_ms: 20})

    %{registry: pid, name: name}
  end

  defp report(runtime_id, overrides \\ %{}) do
    Map.merge(
      %{
        "runtime_id" => runtime_id,
        "label" => "proj",
        "project_slug" => "proj",
        "tracker_kind" => "local",
        "agent_kind" => "codex",
        "source_url" => "http://localhost:4001",
        "snapshot" => %{
          "generated_at" => "2026-05-30T00:00:00Z",
          "counts" => %{"running" => 1, "retrying" => 0},
          "running" => [],
          "retrying" => [],
          "agent_totals" => %{"input_tokens" => 0, "output_tokens" => 0, "total_tokens" => 0, "seconds_running" => 0},
          "rate_limits" => nil
        }
      },
      overrides
    )
  end

  test "upserts a report and lists it as online", %{name: name} do
    assert :ok = Registry.put_report(name, report("r1"))

    assert [entry] = Registry.list(name)
    assert entry.runtime_id == "r1"
    assert entry.status == :online
    assert entry.counts == %{running: 1, retrying: 0}
    assert is_binary(entry.reported_at)
  end

  test "second report from same runtime upserts in place", %{name: name} do
    Registry.put_report(name, report("r1", %{"label" => "a"}))
    Registry.put_report(name, report("r1", %{"label" => "b"}))

    assert [entry] = Registry.list(name)
    assert entry.label == "b"
  end

  test "rejects a report without runtime_id", %{name: name} do
    assert {:error, :missing_runtime_id} = Registry.put_report(name, report(nil) |> Map.delete("runtime_id"))
    assert Registry.list(name) == []
  end

  test "captures rate_limits + agent_kind into AgentUsage", %{name: name} do
    rate_limits = %{
      "limit_name" => "max",
      "primary" => %{"usedPercent" => 55, "resets_at" => 1_900_000_000}
    }

    snapshot = %{
      "generated_at" => "2026-05-30T00:00:00Z",
      "counts" => %{"running" => 0, "retrying" => 0},
      "running" => [],
      "retrying" => [],
      "agent_totals" => %{},
      "rate_limits" => rate_limits
    }

    assert :ok =
             Registry.put_report(name, report("r1", %{"agent_kind" => "claude", "snapshot" => snapshot}))

    usage = AgentUsage.get("claude")
    assert usage.agent_kind == "claude"
    assert usage.plan == "max"
    assert Enum.find(usage.windows, &(&1.kind == :session)).used_percent == 55.0
  end

  test "attributes passive rate limits to the reported launch account", %{name: name} do
    snapshot = %{
      "generated_at" => "2026-05-30T00:00:00Z",
      "counts" => %{"running" => 0, "retrying" => 0},
      "running" => [],
      "retrying" => [],
      "agent_totals" => %{},
      "rate_limits" => %{
        "limit_name" => "team",
        "primary" => %{"usedPercent" => 42}
      }
    }

    assert :ok =
             Registry.put_report(
               name,
               report("r-account", %{
                 "agent_kind" => "codex",
                 "agent_account_id" => "work",
                 "snapshot" => snapshot
               })
             )

    assert %{snapshot: %{account_id: "work", plan: "team"}} =
             AgentUsage.entry("codex", "work")

    assert AgentUsage.get("codex") == nil
  end

  test "does not capture usage when rate_limits is nil", %{name: name} do
    assert :ok = Registry.put_report(name, report("r2", %{"agent_kind" => "codex"}))
    assert AgentUsage.get("codex") == nil
  end

  test "marks stale then drops after TTL", %{name: name} do
    Registry.put_report(name, report("r1"))
    Process.sleep(80)
    assert [%{status: :stale}] = Registry.list(name)
    Process.sleep(80)
    assert Registry.list(name) == []
  end

  test "tolerates a null snapshot", %{name: name} do
    assert :ok = Registry.put_report(name, %{"runtime_id" => "r1", "snapshot" => nil})
    assert [entry] = Registry.list(name)
    assert entry.counts == %{running: 0, retrying: 0}
    assert entry.running == []
    assert entry.retrying == []
  end

  test "tolerates null counts inside snapshot", %{name: name} do
    assert :ok = Registry.put_report(name, %{"runtime_id" => "r1", "snapshot" => %{"counts" => nil}})
    assert [entry] = Registry.list(name)
    assert entry.counts == %{running: 0, retrying: 0}
  end

  test "extracts snapshot sub-fields from an atom-keyed snapshot (local delivery path)", %{name: name} do
    atom_keyed = %{
      "runtime_id" => "r1",
      "label" => "proj",
      "snapshot" => %{
        generated_at: "2026-05-30T00:00:00Z",
        counts: %{running: 2, retrying: 1},
        running: [%{issue_identifier: "PROJ-1", state: "In Progress"}],
        retrying: [%{issue_identifier: "PROJ-2", attempt: 1}],
        agent_totals: %{input_tokens: 10, output_tokens: 20, total_tokens: 30, seconds_running: 5},
        rate_limits: nil
      }
    }

    assert :ok = Registry.put_report(name, atom_keyed)
    assert [entry] = Registry.list(name)
    assert entry.counts == %{running: 2, retrying: 1}
    assert length(entry.running) == 1
    assert length(entry.retrying) == 1
    assert entry.agent_totals == %{input_tokens: 10, output_tokens: 20, total_tokens: 30, seconds_running: 5}
  end

  test "broadcasts runtime_updated on report and runtime_removed on drop", %{name: name} do
    Phoenix.PubSub.subscribe(:registry_test_pubsub, "observability:global")

    Registry.put_report(name, report("r1"))
    assert_receive {:observability_event, "runtime_updated", %{runtime_id: "r1"}}, 500

    assert_receive {:observability_event, "runtime_removed", %{runtime_id: "r1"}}, 1_000
  end
end
