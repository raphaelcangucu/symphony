defmodule SymphonyElixir.Agent.RunResultTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Agent.RunResult

  test "normalizes only the provider-neutral identity contract" do
    assert {:ok, result} =
             RunResult.normalize("codex", %{
               assistant_message: "done",
               conversation_id: "thread-1",
               run_id: "turn-1",
               execution_id: "execution-1",
               tool_calls: []
             })

    assert result.provider == "codex"
    assert result.conversation_id == "thread-1"
    assert result.run_id == "turn-1"
    assert result.execution_id == "execution-1"
    assert result.status == "completed"
  end

  test "preserves canonical timeline fields" do
    assert {:ok, result} =
             RunResult.normalize("claude", %{
               assistant_message: "done",
               conversation_id: "claude-session",
               run_id: "run-3",
               execution_id: "execution-3",
               tool_calls: [%{name: "Read"}],
               content_blocks: [%{type: "text", text: "done"}]
             })

    assert result.run_id == "run-3"
    assert result.execution_id == "execution-3"
    assert result.tool_calls == [%{name: "Read"}]
    assert result.content_blocks == [%{type: "text", text: "done"}]
  end

  test "requires a non-empty assistant message and preserves semantic whitespace" do
    assert {:error, :assistant_message_required} =
             RunResult.normalize("codex", %{
               assistant_message: "",
               conversation_id: "thread-1",
               run_id: "run-1"
             })

    assert {:ok, result} =
             RunResult.normalize("codex", %{
               assistant_message: " \n ",
               conversation_id: "thread-1",
               run_id: "run-1"
             })

    assert result.assistant_message == " \n "
  end

  test "rejects provider-specific identity aliases" do
    assert {:error, :legacy_identity_field} =
             RunResult.normalize("cursor", %{
               assistant_message: "done",
               cli_session_id: "cursor-chat",
               thread_id: "wrapper",
               turn_id: "legacy-run"
             })

    assert {:error, :legacy_identity_field} =
             RunResult.normalize("cursor", %{
               assistant_message: "done",
               conversation_id: "cursor-chat",
               turn_id: "legacy-run"
             })

    assert {:error, :legacy_identity_field} =
             RunResult.normalize("cursor", %{
               assistant_message: "done",
               conversation_id: "cursor-chat",
               run_id: "canonical-run",
               session_id: "legacy-execution"
             })
  end

  test "rejects a provider result attributed to another backend" do
    assert {:error, {:provider_mismatch, "cursor", "claude"}} =
             RunResult.normalize("cursor", %{
               provider: "claude",
               assistant_message: "done",
               conversation_id: "claude-chat",
               run_id: "claude-run"
             })
  end
end
