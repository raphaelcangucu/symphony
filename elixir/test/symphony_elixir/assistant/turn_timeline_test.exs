defmodule SymphonyElixir.Assistant.TurnTimelineTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.TurnTimeline

  test "merges adjacent text including whitespace and ignores only empty deltas" do
    timeline =
      TurnTimeline.new()
      |> TurnTimeline.append_text(" \n")
      |> TurnTimeline.append_text("")
      |> TurnTimeline.append_text("Hello")
      |> TurnTimeline.append_text(" ")
      |> TurnTimeline.append_text("\n")

    assert TurnTimeline.assistant_text(timeline) == " \nHello \n"
    assert TurnTimeline.content_blocks(timeline) == [%{"type" => "text", "text" => " \nHello \n"}]
  end

  test "preserves text tool text order" do
    timeline = TurnTimeline.new() |> TurnTimeline.append_text("Before")

    {timeline, tool_call} =
      TurnTimeline.upsert_tool_call(timeline, %{
        id: "provider-tool-1",
        name: "shell",
        status: "running",
        arguments: %{"command" => "pwd"}
      })

    timeline = TurnTimeline.append_text(timeline, "After")

    assert tool_call.id == "provider-tool-1"

    assert TurnTimeline.content_blocks(timeline) == [
             %{"type" => "text", "text" => "Before"},
             %{"type" => "tool", "tool_call_id" => "provider-tool-1"},
             %{"type" => "text", "text" => "After"}
           ]
  end

  test "preserves provider tool call ids" do
    {timeline, tool_call} =
      TurnTimeline.upsert_tool_call(TurnTimeline.new(), %{
        "id" => "call-from-provider",
        "name" => "list_issues",
        "status" => "running"
      })

    assert tool_call.id == "call-from-provider"
    assert TurnTimeline.tool_calls(timeline) == [tool_call]

    assert TurnTimeline.content_blocks(timeline) == [
             %{"type" => "tool", "tool_call_id" => "call-from-provider"}
           ]
  end

  test "allocates monotonic collector-local fallback ids" do
    {timeline, first} =
      TurnTimeline.upsert_tool_call(TurnTimeline.new(), %{name: "shell", status: "running"})

    {timeline, provider} =
      TurnTimeline.upsert_tool_call(timeline, %{
        id: "provider-tool",
        name: "read_file",
        status: "running"
      })

    {_timeline, second} =
      TurnTimeline.upsert_tool_call(timeline, %{name: "apply_patch", status: "running"})

    assert first.id == "assistant-tool-1"
    assert provider.id == "provider-tool"
    assert second.id == "assistant-tool-2"
  end

  test "fallback allocation skips colliding provider ids monotonically" do
    {timeline, provider_one} =
      TurnTimeline.upsert_tool_call(TurnTimeline.new(), %{
        id: "assistant-tool-1",
        name: "provider_one",
        status: "running"
      })

    {timeline, fallback_two} =
      TurnTimeline.upsert_tool_call(timeline, %{name: "fallback_two", status: "running"})

    {timeline, provider_three} =
      TurnTimeline.upsert_tool_call(timeline, %{
        id: "assistant-tool-3",
        name: "provider_three",
        status: "running"
      })

    {timeline, fallback_four} =
      TurnTimeline.upsert_tool_call(timeline, %{name: "fallback_four", status: "running"})

    assert provider_one.id == "assistant-tool-1"
    assert fallback_two.id == "assistant-tool-2"
    assert provider_three.id == "assistant-tool-3"
    assert fallback_four.id == "assistant-tool-4"

    assert Enum.map(TurnTimeline.tool_calls(timeline), & &1.id) == [
             "assistant-tool-1",
             "assistant-tool-2",
             "assistant-tool-3",
             "assistant-tool-4"
           ]
  end

  test "colliding provider ids receive a stable alias without rekeying exposed generated ids" do
    {timeline, generated} =
      TurnTimeline.upsert_tool_call(TurnTimeline.new(), %{
        name: "generated_call",
        status: "running"
      })

    {timeline, provider_started} =
      TurnTimeline.upsert_tool_call(timeline, %{
        id: "assistant-tool-1",
        name: "provider_call",
        status: "running"
      })

    {timeline, provider_completed} =
      TurnTimeline.upsert_tool_call(timeline, %{
        id: "assistant-tool-1",
        status: "complete",
        output: "done"
      })

    {timeline, next_generated} =
      TurnTimeline.upsert_tool_call(timeline, %{
        name: "next_generated_call",
        status: "running"
      })

    assert generated.id == "assistant-tool-1"
    assert provider_started.id == "assistant-tool-2"
    assert provider_completed.id == provider_started.id
    assert provider_completed.status == "complete"
    assert provider_completed.output == "done"
    assert next_generated.id == "assistant-tool-3"

    assert Enum.map(TurnTimeline.tool_calls(timeline), &{&1.id, &1.name}) == [
             {"assistant-tool-1", "generated_call"},
             {"assistant-tool-2", "provider_call"},
             {"assistant-tool-3", "next_generated_call"}
           ]

    assert Enum.map(TurnTimeline.content_blocks(timeline), & &1["tool_call_id"]) == [
             "assistant-tool-1",
             "assistant-tool-2",
             "assistant-tool-3"
           ]

    assert Enum.count(TurnTimeline.content_blocks(timeline), &(&1["tool_call_id"] == provider_started.id)) == 1
  end

  test "correlates an id-less completion to the most recent running tool with the same meaningful name" do
    {timeline, first} =
      TurnTimeline.upsert_tool_call(TurnTimeline.new(), %{
        name: "shell",
        status: "running",
        arguments: %{"command" => "first"}
      })

    {timeline, second} =
      TurnTimeline.upsert_tool_call(timeline, %{
        name: "shell",
        status: "running",
        arguments: %{"command" => "second"}
      })

    {timeline, completed} =
      TurnTimeline.upsert_tool_call(timeline, %{
        name: "shell",
        status: "complete",
        output: "done"
      })

    assert completed.id == second.id
    assert completed.name == "shell"
    assert completed.arguments == %{"command" => "second"}
    assert completed.output == "done"

    assert Enum.find(TurnTimeline.tool_calls(timeline), &(&1.id == first.id)).status == "running"

    assert Enum.count(
             TurnTimeline.content_blocks(timeline),
             &(&1 == %{"type" => "tool", "tool_call_id" => second.id})
           ) == 1
  end

  test "does not duplicate a tool block when completion is repeated" do
    {timeline, _started} =
      TurnTimeline.upsert_tool_call(TurnTimeline.new(), %{
        id: "stable-id",
        name: "list_issues",
        status: "running",
        arguments: %{"limit" => 1}
      })

    {timeline, first_completion} =
      TurnTimeline.upsert_tool_call(timeline, %{
        id: "stable-id",
        status: "complete",
        output: "first"
      })

    {timeline, repeated_completion} =
      TurnTimeline.upsert_tool_call(timeline, %{
        id: "stable-id",
        status: "complete",
        output: "second"
      })

    assert first_completion.name == "list_issues"
    assert first_completion.arguments == %{"limit" => 1}
    assert repeated_completion.name == "list_issues"
    assert repeated_completion.arguments == %{"limit" => 1}
    assert repeated_completion.output == "second"
    assert length(TurnTimeline.tool_calls(timeline)) == 1

    assert TurnTimeline.content_blocks(timeline) == [
             %{"type" => "tool", "tool_call_id" => "stable-id"}
           ]
  end

  test "accepts only normalized nonempty wire block lists" do
    assert TurnTimeline.valid_content_blocks?([
             %{"type" => "text", "text" => "Before"},
             %{"type" => "tool", "tool_call_id" => "tool-1"},
             %{"type" => "text", "text" => "After"}
           ])

    assert TurnTimeline.valid_content_blocks?([%{"type" => "text", "text" => " \n "}])
    refute TurnTimeline.valid_content_blocks?([])
    refute TurnTimeline.valid_content_blocks?([%{"type" => "text", "text" => "ok", "extra" => true}])

    refute TurnTimeline.valid_content_blocks?([
             %{"type" => "text", "text" => "one"},
             %{"type" => "text", "text" => "two"}
           ])

    refute TurnTimeline.valid_content_blocks?([
             %{"type" => "tool", "tool_call_id" => "duplicate"},
             %{"type" => "tool", "tool_call_id" => "duplicate"}
           ])
  end

  test "validates ordered blocks against exact content and persisted tool calls" do
    blocks = [
      %{"type" => "text", "text" => "Before"},
      %{"type" => "tool", "tool_call_id" => "tool-1"},
      %{"type" => "text", "text" => "After"},
      %{"type" => "tool", "tool_call_id" => "tool-2"}
    ]

    tool_calls = [
      %{"id" => "tool-1", "name" => "first", "status" => "complete"},
      %{id: "tool-2", name: "second", status: "complete"}
    ]

    assert TurnTimeline.valid_content_blocks?(blocks, "BeforeAfter", tool_calls)
    refute TurnTimeline.valid_content_blocks?(blocks, "Different", tool_calls)
    refute TurnTimeline.valid_content_blocks?(blocks, "BeforeAfter", Enum.reverse(tool_calls))
    refute TurnTimeline.valid_content_blocks?(blocks, "BeforeAfter", [List.first(tool_calls)])
  end

  test "fails fast for malformed state, text, and tool inputs" do
    timeline = TurnTimeline.new()

    assert_raise ArgumentError, ~r/invalid turn timeline/, fn ->
      TurnTimeline.append_text(%{}, "text")
    end

    assert_raise ArgumentError, ~r/text delta must be a string/, fn ->
      TurnTimeline.append_text(timeline, 123)
    end

    assert_raise ArgumentError, ~r/tool call must be a map/, fn ->
      TurnTimeline.upsert_tool_call(timeline, "tool")
    end

    assert_raise ArgumentError, ~r/tool call name must be a non-blank string/, fn ->
      TurnTimeline.upsert_tool_call(timeline, %{name: 123, status: "running"})
    end

    assert_raise ArgumentError, ~r/tool call status must be one of/, fn ->
      TurnTimeline.upsert_tool_call(timeline, %{name: "shell", status: "pending"})
    end

    assert_raise ArgumentError, ~r/tool call id must be a non-blank string/, fn ->
      TurnTimeline.upsert_tool_call(timeline, %{id: " ", name: "shell", status: "running"})
    end

    {timeline, _tool_call} =
      TurnTimeline.upsert_tool_call(timeline, %{
        id: "tool-1",
        name: "shell",
        status: "running",
        arguments: %{"command" => "pwd"}
      })

    [stored_tool_call] = TurnTimeline.tool_calls(timeline)
    malformed_timeline = %{timeline | tool_calls: [%{stored_tool_call | arguments: "pwd"}]}

    assert_raise ArgumentError, ~r/invalid turn timeline/, fn ->
      TurnTimeline.append_text(malformed_timeline, "text")
    end
  end
end
