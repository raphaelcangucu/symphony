defmodule SymphonyElixir.AgentLifecycle.PathsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentLifecycle.Paths

  setup do
    previous = Application.get_env(:symphony_elixir, :agent_data_dir)
    xdg = System.get_env("XDG_DATA_HOME")

    on_exit(fn ->
      restore_app_env(:agent_data_dir, previous)
      restore_system_env("XDG_DATA_HOME", xdg)
    end)

    :ok
  end

  test "explicit application data dir wins over XDG" do
    Application.put_env(:symphony_elixir, :agent_data_dir, "/explicit/agents")
    System.put_env("XDG_DATA_HOME", "/xdg")

    assert Paths.root() == "/explicit/agents"
  end

  test "XDG data home owns the default managed root" do
    Application.delete_env(:symphony_elixir, :agent_data_dir)
    System.put_env("XDG_DATA_HOME", "/xdg")

    assert Paths.root() == "/xdg/symphony/agents"
    assert Paths.agent_root("codex") == "/xdg/symphony/agents/codex"

    assert Paths.account_home("codex", "acct-1") ==
             "/xdg/symphony/agents/codex/accounts/acct-1/home"
  end

  defp restore_app_env(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore_app_env(key, value), do: Application.put_env(:symphony_elixir, key, value)
  defp restore_system_env(key, nil), do: System.delete_env(key)
  defp restore_system_env(key, value), do: System.put_env(key, value)
end
