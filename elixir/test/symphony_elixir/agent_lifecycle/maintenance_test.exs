defmodule SymphonyElixir.AgentLifecycle.MaintenanceTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentLifecycle.Maintenance
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(Setting)
    :ok
  end

  test "updates only an installed provider whose automatic updates are enabled" do
    parent = self()

    current = fn
      "codex" -> {:ok, %{"version" => "1.0.0"}}
      "claude" -> {:error, :not_installed}
    end

    release_source = fn agent, [] ->
      send(parent, {:checked, agent})
      {:ok, %{version: "2.0.0", url: "fixture://#{agent}"}}
    end

    install = fn agent, release, [] ->
      send(parent, {:installed, agent, release.version})
      {:ok, %{status: :activated, version: release.version}}
    end

    assert %{
             "codex" => {:ok, %{status: :activated, version: "2.0.0"}},
             "claude" => :not_installed
           } =
             Maintenance.run_once(
               agents: ~w(codex claude),
               current: current,
               release_source: release_source,
               install: install
             )

    assert_received {:checked, "codex"}
    assert_received {:installed, "codex", "2.0.0"}
    refute_received {:checked, "claude"}
  end

  test "does not check the network when automatic updates are disabled" do
    assert {:ok, _settings} =
             Settings.put("agent_cli", "codex", %{
               "preferred_source" => "managed",
               "auto_update" => false,
               "failover_enabled" => false
             })

    assert %{"codex" => :disabled} =
             Maintenance.run_once(
               agents: ["codex"],
               current: fn _agent -> flunk("current install must not be read") end,
               release_source: fn _agent, _options -> flunk("release must not be checked") end,
               install: fn _agent, _release, _options -> flunk("release must not be installed") end
             )
  end

  test "skips installation when the latest version is already active" do
    assert %{"codex" => :current} =
             Maintenance.run_once(
               agents: ["codex"],
               current: fn "codex" -> {:ok, %{"version" => "2.0.0"}} end,
               release_source: fn "codex", [] ->
                 {:ok, %{version: "2.0.0", url: "fixture://codex"}}
               end,
               install: fn _agent, _release, _options -> flunk("current version must not reinstall") end
             )
  end
end
