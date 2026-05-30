defmodule SymphonyElixir.Observability.RegistryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Observability.Registry

  setup do
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

  test "marks stale then drops after TTL", %{name: name} do
    Registry.put_report(name, report("r1"))
    Process.sleep(80)
    assert [%{status: :stale}] = Registry.list(name)
    Process.sleep(80)
    assert Registry.list(name) == []
  end

  test "broadcasts runtime_updated on report and runtime_removed on drop", %{name: name} do
    Phoenix.PubSub.subscribe(:registry_test_pubsub, "observability:global")

    Registry.put_report(name, report("r1"))
    assert_receive {:observability_event, "runtime_updated", %{runtime_id: "r1"}}, 500

    assert_receive {:observability_event, "runtime_removed", %{runtime_id: "r1"}}, 1_000
  end
end
