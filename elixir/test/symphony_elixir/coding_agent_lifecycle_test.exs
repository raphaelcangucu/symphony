defmodule SymphonyElixir.CodingAgentLifecycleTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentLaunch
  alias SymphonyElixir.AgentLifecycle.{Installer, RuntimeRegistry}
  alias SymphonyElixir.CodingAgent

  setup do
    root = Path.join(System.tmp_dir!(), "coding-agent-lifecycle-#{System.unique_integer([:positive])}")
    workspace = Path.join(root, "project")
    previous_root = Application.get_env(:symphony_elixir, :agent_data_dir)
    Application.put_env(:symphony_elixir, :agent_data_dir, Path.join(root, "agents"))
    File.mkdir_p!(workspace)
    RuntimeRegistry.reset()

    on_exit(fn ->
      RuntimeRegistry.reset()
      File.rm_rf(root)
      restore_app_env(:agent_data_dir, previous_root)
    end)

    {:ok, root: root, workspace: workspace}
  end

  test "root admission attaches immutable launch provenance and releases its runtime lease", %{
    root: root,
    workspace: workspace
  } do
    launch = launch("opencode")
    resolver = fn "opencode", nil, "work" -> {:ok, launch} end

    assert {:ok, session} =
             CodingAgent.start_session(workspace, "opencode",
               workspace_root: root,
               account_id: "work",
               agent_launch_resolver: resolver
             )

    assert session.agent_launch == launch
    assert session.command == "/managed/opencode"
    assert session.agent_env == %{"OPENCODE_CONFIG_DIR" => "/isolated/opencode/work"}
    assert RuntimeRegistry.active?("opencode")

    assert :ok = CodingAgent.stop_session(session)
    refute RuntimeRegistry.active?("opencode")
  end

  test "failed adapter admission releases the acquired lease", %{root: root} do
    resolver = fn "opencode", nil, nil -> {:ok, launch("opencode")} end

    assert {:error, {:invalid_workspace_cwd, :workspace_root, _path}} =
             CodingAgent.start_session(root, "opencode",
               workspace_root: root,
               agent_launch_resolver: resolver
             )

    refute RuntimeRegistry.active?("opencode")
  end

  test "stopping the final session activates a managed update deferred by its lease", %{
    root: root,
    workspace: workspace
  } do
    assert {:ok, %{status: :activated}} = install("opencode", "1.0.0")
    resolver = fn "opencode", nil, nil -> {:ok, launch("opencode")} end

    assert {:ok, session} =
             CodingAgent.start_session(workspace, "opencode",
               workspace_root: root,
               agent_launch_resolver: resolver
             )

    assert {:ok, %{status: :deferred}} = install("opencode", "2.0.0")
    assert {:ok, %{"version" => "1.0.0"}} = Installer.current("opencode")

    assert :ok = CodingAgent.stop_session(session)
    assert {:ok, %{"version" => "2.0.0"}} = Installer.current("opencode")
    assert Installer.pending("opencode") == {:error, :none}
  end

  defp launch(agent) do
    AgentLaunch.new!(
      agent_kind: agent,
      account_id: "work",
      account_home: "/isolated/#{agent}/work",
      preferred_source: :managed,
      effective_source: :managed,
      executable_path: "/managed/#{agent}",
      executable_version: "1.0.0",
      fallback_reason: nil,
      probed_at: 100
    )
  end

  defp install(agent, version) do
    artifact = "#!/bin/sh\nprintf '#{agent} #{version}\\n'\n"
    checksum = :crypto.hash(:sha256, artifact) |> Base.encode16(case: :lower)

    Installer.install(
      agent,
      %{
        version: version,
        url: "fixture://#{agent}/#{version}",
        checksum: checksum,
        format: :raw
      },
      download: fn _url -> {:ok, artifact} end
    )
  end

  defp restore_app_env(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore_app_env(key, value), do: Application.put_env(:symphony_elixir, key, value)
end
