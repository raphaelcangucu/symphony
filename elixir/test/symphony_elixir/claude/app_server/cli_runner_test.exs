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
    {result, events, workspace}
  end

  test "happy turn captures session id, usage, cost, and emits translated events" do
    {result, events, workspace} = run("happy")

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

    symphony = Path.join(workspace, ".symphony/claude-session.jsonl")
    assert File.exists?(symphony)
    decoded = symphony |> File.read!() |> String.split("\n", trim: true) |> Enum.map(&Jason.decode!/1)

    assert Enum.any?(decoded, fn row ->
             get_in(row, ["message", "content"])
             |> List.wrap()
             |> Enum.any?(fn
               %{"type" => "tool_use", "name" => "mcp__symphony__list_issues"} -> true
               _ -> false
             end)
           end)
  end

  test "error result yields turn/failed and an error tuple" do
    {result, events, _workspace} = run("error")

    assert {:error, {:turn_failed, _details}} = result
    assert Enum.any?(events, &(&1["method"] == "turn/failed"))
  end

  test "timeout kills the process and returns turn_timeout" do
    {result, _events, _workspace} = run("hang", timeout_ms: 300)
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

  test "argv: --effort is included for a valid effort and omitted otherwise" do
    with_effort =
      CliRunner.build_args(%{
        session_uuid: "u-1",
        cli_session_id: nil,
        model: "claude-opus-4-8",
        effort: "xhigh",
        mcp_config_path: nil,
        permission_mode: "bypassPermissions"
      })

    assert with_effort =~ "--effort xhigh"

    without_effort =
      CliRunner.build_args(%{
        session_uuid: "u-1",
        cli_session_id: nil,
        model: "claude-opus-4-8",
        effort: nil,
        mcp_config_path: nil,
        permission_mode: "bypassPermissions"
      })

    refute without_effort =~ "--effort"
  end

  test "argv: --permission-prompt-tool is included when set and validated" do
    args =
      CliRunner.build_args(%{
        session_uuid: "u-1",
        cli_session_id: nil,
        model: nil,
        mcp_config_path: "/tmp/m.json",
        permission_mode: "default",
        permission_prompt_tool: "mcp__symphony__approval_prompt"
      })

    assert args =~ "--permission-prompt-tool mcp__symphony__approval_prompt"
    assert args =~ "--permission-mode default"
  end

  test "argv: --permission-prompt-tool is omitted when absent or unsafe" do
    without =
      CliRunner.build_args(%{
        session_uuid: "u-1",
        cli_session_id: nil,
        model: nil,
        mcp_config_path: nil,
        permission_mode: "bypassPermissions"
      })

    refute without =~ "--permission-prompt-tool"

    unsafe =
      CliRunner.build_args(%{
        session_uuid: "u-1",
        cli_session_id: nil,
        model: nil,
        mcp_config_path: "/tmp/m.json",
        permission_mode: "default",
        permission_prompt_tool: "mcp__symphony__x; rm -rf /"
      })

    refute unsafe =~ "--permission-prompt-tool"
    refute unsafe =~ "rm -rf"
  end

  test "build_args drops unknown/malicious effort values" do
    args =
      CliRunner.build_args(%{
        session_uuid: "u-1",
        cli_session_id: nil,
        model: "claude-opus-4-8",
        effort: "high; rm -rf x",
        mcp_config_path: nil,
        permission_mode: "bypassPermissions"
      })

    refute args =~ "--effort"
    refute args =~ "rm -rf"
  end

  test "build_args rejects malicious session ids and falls back to --session-id" do
    # Malicious cli_session_id must not be embedded; fall back to --session-id
    args =
      CliRunner.build_args(%{
        session_uuid: "safe-uuid-123",
        cli_session_id: "sess; rm -rf x",
        model: nil,
        mcp_config_path: nil,
        permission_mode: "bypassPermissions"
      })

    refute args =~ "rm -rf"
    refute args =~ "--resume"
    assert args =~ "--session-id safe-uuid-123"
  end

  test "multi-partial deltas, usage updates and rate limits" do
    {result, events, _workspace} = run("multi")

    # Final turn result
    assert {:ok, %{cli_session_id: "sess-multi", status: :completed}} = result

    # Partial deltas emitted in order
    progress_events =
      Enum.filter(events, &(&1["method"] == "item/progress"))

    deltas = Enum.map(progress_events, &get_in(&1, ["params", "delta", "text"]))
    assert deltas == ["Hel", "lo wor"]

    # One usage/update event with correct totals
    usage_events = Enum.filter(events, &(&1["method"] == "usage/update"))
    assert length(usage_events) == 1
    assert [%{"params" => %{"usage" => usage}}] = usage_events
    assert usage == %{input_tokens: 7, output_tokens: 3, total_tokens: 10}

    # Rate limit event present
    assert Enum.any?(events, &(&1["method"] == "rate_limit"))

    # Final item/created with full text
    created_texts =
      Enum.flat_map(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "text", "text" => t}}} -> [t]
        _ -> []
      end)

    assert "Hello world" in created_texts
  end

  test "a --resume to a missing session is surfaced as resume_session_not_found" do
    {result, _events, _workspace} = run("resume-aware", cli_session_id: "sess-stale")
    assert {:error, {:resume_session_not_found, "sess-stale"}} = result
  end

  test "resume-aware without a prior session starts fresh and succeeds" do
    {result, events, _workspace} = run("resume-aware")
    assert {:ok, %{cli_session_id: "sess-fresh", status: :completed}} = result

    created_texts =
      Enum.flat_map(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "text", "text" => t}}} -> [t]
        _ -> []
      end)

    assert "fresh session reply" in created_texts
  end
end
