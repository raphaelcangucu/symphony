defmodule SymphonyElixir.AgentLifecycle.CatalogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentLifecycle.Catalog

  test "catalog contains every supported coding agent" do
    assert Catalog.kinds() == ~w(codex claude cursor opencode)

    for kind <- Catalog.kinds() do
      assert {:ok, entry} = Catalog.fetch(kind)
      assert entry.kind == kind
      assert is_binary(entry.executable)
      assert entry.executable != ""
      assert entry.version_args == ["--version"]
      assert is_binary(entry.account_home_env)
      assert entry.release != nil
    end
  end

  test "codex launch command keeps the configured app-server arguments" do
    assert Catalog.launch_command("codex", "/managed/codex") ==
             "/managed/codex --config shell_environment_policy.inherit=all app-server"

    assert Catalog.launch_command("claude", "/managed/claude") == "/managed/claude"
  end

  test "unknown agents are rejected without creating atoms" do
    assert :error = Catalog.fetch("not-real")
  end
end
