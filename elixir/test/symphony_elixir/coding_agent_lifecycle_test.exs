defmodule SymphonyElixir.CodingAgentLifecycleTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentLaunch
  alias SymphonyElixir.AgentLifecycle.RuntimeRegistry
  alias SymphonyElixir.CodingAgent

  setup do
    root = Path.join(System.tmp_dir!(), "coding-agent-lifecycle-#{System.unique_integer([:positive])}")
    workspace = Path.join(root, "project")
    File.mkdir_p!(workspace)
    RuntimeRegistry.reset()

    on_exit(fn ->
      RuntimeRegistry.reset()
      File.rm_rf(root)
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
end
