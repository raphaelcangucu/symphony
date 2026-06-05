defmodule SymphonyElixir.Claude.AppServer.CliRunnerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Claude.AppServer.CliRunner

  @fake Path.expand("../../../support/fixtures/fake_claude.sh", __DIR__)

  defp run(env_mode, opts \\ []) do
    workspace = Path.join(System.tmp_dir!(), "cli-runner-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    {:ok, collector} = Agent.start_link(fn -> [] end)
    on_event = fn event -> Agent.update(collector, &[event | &1]) end

    result =
      CliRunner.run_turn(
        %{
          command: "FAKE_CLAUDE_MODE=#{env_mode} #{@fake}",
          workspace: workspace,
          prompt: "do the thing",
          session_uuid: "11111111-1111-1111-1111-111111111111",
          cli_session_id: Keyword.get(opts, :cli_session_id),
          model: Keyword.get(opts, :model),
          mcp_config_path: Keyword.get(opts, :mcp_config_path),
          permission_mode: "bypassPermissions",
          timeout_ms: Keyword.get(opts, :timeout_ms, 5_000)
        },
        on_event
      )

    events = collector |> Agent.get(&Enum.reverse/1)
    Agent.stop(collector)
    {result, events}
  end

  test "happy turn captures session id, usage, cost, and emits translated events" do
    {result, events} = run("happy")

    assert {:ok, %{cli_session_id: "sess-123", status: :completed} = turn} = result
    assert turn.usage == %{input_tokens: 10, output_tokens: 5, total_tokens: 15}
    assert turn.cost_usd == 0.01

    methods = Enum.map(events, & &1["method"])
    assert "item/progress" in methods
    assert "item/created" in methods
    assert "turn/completed" in methods

    tool_item =
      Enum.find_value(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "tool_call"} = item}} -> item
        _ -> nil
      end)

    assert tool_item["name"] == "mcp__symphony__list_issues"
  end

  test "error result yields turn/failed and an error tuple" do
    {result, events} = run("error")

    assert {:error, {:turn_failed, _details}} = result
    assert Enum.any?(events, &(&1["method"] == "turn/failed"))
  end

  test "timeout kills the process and returns turn_timeout" do
    {result, _events} = run("hang", timeout_ms: 300)
    assert {:error, :turn_timeout} = result
  end

  test "argv: first turn uses --session-id, resumed turn uses --resume, model and mcp flags included" do
    args = CliRunner.build_args(%{session_uuid: "u-1", cli_session_id: nil, model: nil, mcp_config_path: nil, permission_mode: "bypassPermissions"})
    assert args =~ "--session-id u-1"
    refute args =~ "--resume"

    args = CliRunner.build_args(%{session_uuid: "u-1", cli_session_id: "sess-9", model: "claude-opus-4-6", mcp_config_path: "/tmp/m.json", permission_mode: "bypassPermissions"})
    assert args =~ "--resume sess-9"
    assert args =~ "--model claude-opus-4-6"
    assert args =~ "--mcp-config /tmp/m.json --strict-mcp-config"
    assert args =~ "--permission-mode bypassPermissions"
  end
end
