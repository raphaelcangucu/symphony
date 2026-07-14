defmodule SymphonyElixir.Cursor.CliRunnerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Cursor.CliRunner

  @fake Path.expand("../../support/fixtures/fake_cursor.sh", __DIR__)

  defp run(env_mode, opts \\ []) do
    workspace = Path.join(System.tmp_dir!(), "cursor-cli-runner-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    {:ok, collector} = Agent.start_link(fn -> [] end)
    on_event = fn event -> Agent.update(collector, &[event | &1]) end

    result =
      CliRunner.run_turn(
        %{
          command: "FAKE_CURSOR_MODE=#{env_mode} #{@fake}",
          workspace: workspace,
          prompt: "do the thing",
          session_uuid: "11111111-1111-1111-1111-111111111111",
          cli_session_id: Keyword.get(opts, :cli_session_id),
          model: Keyword.get(opts, :model),
          mcp_config_path: Keyword.get(opts, :mcp_config_path),
          timeout_ms: Keyword.get(opts, :timeout_ms, 5_000)
        },
        on_event
      )

    events = collector |> Agent.get(&Enum.reverse/1)
    Agent.stop(collector)
    {result, events}
  end

  test "happy turn captures the chat id and emits translated events" do
    {result, events} = run("happy")

    assert {:ok, %{cli_session_id: "chat-123", status: :completed, usage: usage}} = result
    assert usage["inputTokens"] == 1200
    assert usage["outputTokens"] == 340

    methods = Enum.map(events, & &1["method"])
    assert "item/progress" in methods
    assert "item/created" in methods
    assert "turn/completed" in methods

    completed =
      Enum.find(events, fn
        %{"method" => "turn/completed", "params" => %{"usage" => %{"inputTokens" => 1200}}} -> true
        _ -> false
      end)

    assert completed

    tool_item =
      Enum.find_value(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "tool_call"} = item}} -> item
        _ -> nil
      end)

    assert tool_item["name"] == "mcp__symphony__list_issues"
    assert tool_item["input"] == %{"limit" => 1}

    tool_result =
      Enum.find_value(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "tool_result"} = item}} -> item
        _ -> nil
      end)

    assert tool_result["tool_use_id"] == "tc1"
  end

  test "error result yields turn/failed and an error tuple" do
    {result, events} = run("error")

    assert {:error, {:turn_failed, "boom"}} = result
    assert Enum.any?(events, &(&1["method"] == "turn/failed"))
  end

  test "timeout kills the process and returns turn_timeout" do
    {result, _events} = run("hang", timeout_ms: 300)
    assert {:error, :turn_timeout} = result
  end

  test "argv: first turn omits --resume, resumed turn includes it; model and mcp flags included" do
    args = CliRunner.build_args(%{cli_session_id: nil, model: nil, mcp_config_path: nil})
    assert args =~ "--print --output-format stream-json --stream-partial-output"
    refute args =~ "--resume"
    refute args =~ "--model"
    refute args =~ "--approve-mcps"

    args = CliRunner.build_args(%{cli_session_id: "chat-9", model: "composer-1", mcp_config_path: "/tmp/mcp.json"})
    assert args =~ "--resume chat-9"
    assert args =~ "--model composer-1"
    assert args =~ "--approve-mcps"
  end

  test "execution mode maps plan to native cursor plan mode and yolo to force" do
    refute CliRunner.build_args(%{cli_session_id: nil, model: nil, mcp_config_path: nil}) =~ "--force"

    refute CliRunner.build_args(%{cli_session_id: nil, model: nil, mcp_config_path: nil, execution_mode: "build"}) =~
             "--force"

    plan_args = CliRunner.build_args(%{cli_session_id: nil, model: nil, mcp_config_path: nil, execution_mode: "plan"})
    assert plan_args =~ "--mode plan"
    refute plan_args =~ "--force"

    yolo_args = CliRunner.build_args(%{cli_session_id: nil, model: nil, mcp_config_path: nil, execution_mode: "yolo"})
    assert yolo_args =~ "--force"
    refute yolo_args =~ "--mode plan"
  end

  test "argv: model auto delegates to the CLI default (no --model flag)" do
    args = CliRunner.build_args(%{cli_session_id: nil, model: "auto", mcp_config_path: nil})
    refute args =~ "--model"
  end

  test "build_args drops malicious model values" do
    args = CliRunner.build_args(%{cli_session_id: nil, model: "gpt-5; rm -rf x", mcp_config_path: nil})
    refute args =~ "--model"
    refute args =~ "rm -rf"
  end

  test "build_args rejects malicious chat ids and starts fresh" do
    args = CliRunner.build_args(%{cli_session_id: "chat; rm -rf x", model: nil, mcp_config_path: nil})
    refute args =~ "rm -rf"
    refute args =~ "--resume"
  end

  test "multi: partial deltas, buffered flushes, and typed tool calls" do
    {result, events} = run("multi")

    assert {:ok, %{cli_session_id: "chat-multi", status: :completed}} = result

    # Partial deltas (timestamp_ms, no model_call_id) emitted in order
    deltas =
      events
      |> Enum.filter(&(&1["method"] == "item/progress"))
      |> Enum.map(&get_in(&1, ["params", "delta", "text"]))

    assert deltas == ["Hel", "lo wor"]

    # Buffered flush before the tool call + final flush become item/created texts
    created_texts =
      Enum.flat_map(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "text", "text" => t}}} -> [t]
        _ -> []
      end)

    assert created_texts == ["Hello wor", "ld"]

    # Typed tool call (readToolCall) is unwrapped
    tool_item =
      Enum.find_value(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "tool_call"} = item}} -> item
        _ -> nil
      end)

    assert tool_item["name"] == "Read"
    assert tool_item["input"] == %{"path" => "file.txt"}
  end

  test "a later independent flush remains a full text segment" do
    {result, events} = run("ordered-timeline")
    assert {:ok, %{cli_session_id: "chat-ordered", status: :completed}} = result

    created_texts =
      Enum.flat_map(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "text", "text" => text}}} -> [text]
        _other -> []
      end)

    assert created_texts == ["Before", " \n"]
  end

  test "independent repeated segments are not discarded" do
    {result, events} = run("repeat-segments")
    assert {:ok, %{cli_session_id: "chat-repeat", status: :completed}} = result

    created_texts =
      Enum.flat_map(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "text", "text" => text}}} -> [text]
        _other -> []
      end)

    assert created_texts == ["foo", "foo"]
    assert Enum.join(created_texts) == "foofoo"
  end

  test "independent prefix-sharing segments remain complete" do
    {result, events} = run("prefix-segments")
    assert {:ok, %{cli_session_id: "chat-prefix", status: :completed}} = result

    created_texts =
      Enum.flat_map(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "text", "text" => text}}} -> [text]
        _other -> []
      end)

    assert created_texts == ["foo", "foobar"]
    assert Enum.join(created_texts) == "foofoobar"
  end

  test "multiple tool boundaries conserve exact text order and final aggregate" do
    {result, events} = run("multi-tools")
    assert {:ok, %{cli_session_id: "chat-multi-tools", status: :completed}} = result

    ordered_items =
      Enum.flat_map(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "text", "text" => text}}} ->
          [{:text, text}]

        %{
          "method" => "item/created",
          "params" => %{"item" => %{"type" => "tool_call", "tool_use_id" => tool_id}}
        } ->
          [{:tool, tool_id}]

        _other ->
          []
      end)

    assert ordered_items == [
             {:text, "one"},
             {:tool, "tool-1"},
             {:text, " two"},
             {:tool, "tool-2"},
             {:text, " three"}
           ]

    assert ordered_items
           |> Enum.flat_map(fn
             {:text, text} -> [text]
             {:tool, _tool_id} -> []
           end)
           |> Enum.join() == "one two three"
  end

  test "glob error completed event preserves the tool name and error flag" do
    {result, events} = run("glob-error")

    assert {:ok, %{cli_session_id: "chat-glob", status: :completed}} = result

    tool_result =
      Enum.find_value(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "tool_result"} = item}} -> item
        _ -> nil
      end)

    assert tool_result["name"] == "Glob"
    assert tool_result["is_error"] == true
    assert tool_result["content"] =~ "Glob pattern"
  end

  test "a --resume to a missing chat is surfaced as resume_session_not_found" do
    {result, _events} = run("resume-aware", cli_session_id: "chat-stale")
    assert {:error, {:resume_session_not_found, "chat-stale"}} = result
  end

  test "resume-aware without a prior session starts fresh and succeeds" do
    {result, events} = run("resume-aware")
    assert {:ok, %{cli_session_id: "chat-fresh", status: :completed}} = result

    created_texts =
      Enum.flat_map(events, fn
        %{"method" => "item/created", "params" => %{"item" => %{"type" => "text", "text" => t}}} -> [t]
        _ -> []
      end)

    assert "fresh session reply" in created_texts
  end
end
