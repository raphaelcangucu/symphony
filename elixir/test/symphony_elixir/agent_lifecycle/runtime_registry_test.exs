defmodule SymphonyElixir.AgentLifecycle.RuntimeRegistryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentLifecycle.RuntimeRegistry

  setup do
    RuntimeRegistry.reset()
    on_exit(&RuntimeRegistry.reset/0)
    :ok
  end

  test "pins launch provenance until the final lease is released" do
    first = %{effective_source: :managed, executable_path: "/managed/codex", version: "1.0.0"}
    replacement = %{effective_source: :managed, executable_path: "/managed/codex-2", version: "2.0.0"}

    assert {:ok, first_lease, ^first} = RuntimeRegistry.acquire("codex", first)
    assert {:ok, second_lease, ^first} = RuntimeRegistry.acquire("codex", replacement)
    assert RuntimeRegistry.active?("codex")
    assert RuntimeRegistry.pinned("codex") == {:ok, first}

    assert :ok = RuntimeRegistry.release(first_lease)
    assert RuntimeRegistry.active?("codex")
    assert :ok = RuntimeRegistry.release(second_lease)
    refute RuntimeRegistry.active?("codex")
    assert RuntimeRegistry.pinned("codex") == :error
  end
end
