defmodule SymphonyElixir.InstanceConfigTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.InstanceConfig

  @keys [
    :poll_interval_ms,
    :max_concurrent_agents,
    :default_max_turns,
    :server_port,
    :server_port_override,
    :editor_enabled,
    :editor_port,
    :default_agent_kind
  ]

  setup do
    saved = Map.new(@keys, fn k -> {k, Application.fetch_env(:symphony_elixir, k)} end)

    on_exit(fn ->
      Enum.each(saved, fn
        {k, {:ok, v}} -> Application.put_env(:symphony_elixir, k, v)
        {k, :error} -> Application.delete_env(:symphony_elixir, k)
      end)
    end)

    Enum.each(@keys, &Application.delete_env(:symphony_elixir, &1))
    :ok
  end

  test "falls back to module defaults when env is unset" do
    assert InstanceConfig.poll_interval_ms() == 5_000
    assert InstanceConfig.max_concurrent_agents() == 10
    assert InstanceConfig.default_max_turns() == 20
    assert InstanceConfig.server_port() == 4_000
    assert InstanceConfig.editor_enabled?() == false
    assert InstanceConfig.editor_port() == 4_002
    assert InstanceConfig.default_agent_kind() == "codex"
  end

  test "reads values from application env" do
    Application.put_env(:symphony_elixir, :poll_interval_ms, 1_234)
    Application.put_env(:symphony_elixir, :max_concurrent_agents, 3)
    Application.put_env(:symphony_elixir, :default_agent_kind, "claude")

    assert InstanceConfig.poll_interval_ms() == 1_234
    assert InstanceConfig.max_concurrent_agents() == 3
    assert InstanceConfig.default_agent_kind() == "claude"
  end

  test "server_port_override wins over configured server_port" do
    Application.put_env(:symphony_elixir, :server_port, 4_000)
    Application.put_env(:symphony_elixir, :server_port_override, 4_999)

    assert InstanceConfig.server_port() == 4_999
  end
end
