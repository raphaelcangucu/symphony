defmodule SymphonyElixir.OrchestratorDispatchGateTest do
  # Mutates the global `:tracker` application env, so it must not run concurrently
  # with other tests that read `Config.tracker_sync_enabled?/0`.
  use ExUnit.Case, async: false

  alias SymphonyElixir.{Config, Orchestrator}

  setup do
    original = Application.get_env(:symphony_elixir, :tracker)

    on_exit(fn ->
      if is_nil(original) do
        Application.delete_env(:symphony_elixir, :tracker)
      else
        Application.put_env(:symphony_elixir, :tracker, original)
      end
    end)

    :ok
  end

  test "global config gate is bypassed when multi-project sync is enabled" do
    # Regression: a misconfigured GLOBAL tracker (e.g. linear without an API key)
    # must NOT block per-project dispatch in the global-less orchestration model.
    # Per-project validity is enforced by the tracker reader + dispatch_decision.
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)

    assert Config.tracker_sync_enabled?()
    assert Orchestrator.global_config_gate_for_test() == :ok
  end

  test "global config gate defers to Config.validate! in legacy single-tracker mode" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: false)

    refute Config.tracker_sync_enabled?()
    assert Orchestrator.global_config_gate_for_test() == Config.validate!()
  end
end
