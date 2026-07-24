defmodule SymphonyElixir.Agent.ErrorTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Agent.Error

  test "normalizes workspace implementation details to a stable public error" do
    error = Error.normalize({:workspace_symlink_escape, "/bad/worktree", "/allowed/root"})

    assert error.code == "workspace_not_executable"
    assert error.category == "workspace"
    refute error.retryable
    assert error.details["reason"] == "symlink_escape"
    refute error.message =~ "/bad/worktree"
  end

  test "classifies provider disconnection as retryable" do
    error = Error.normalize(:epipe)

    assert error.code == "provider_disconnected"
    assert error.category == "provider"
    assert error.retryable
  end

  test "serializes a stable machine-readable payload" do
    assert Error.to_map({:resume_session_not_found, "native-id"}) == %{
             "code" => "conversation_not_found",
             "category" => "provider",
             "retryable" => false,
             "message" => "The provider conversation no longer exists.",
             "details" => %{"conversation_id" => "native-id"}
           }
  end

  test "requires the canonical conversation id for resumed operations" do
    assert Error.to_map(:conversation_id_required) == %{
             "code" => "conversation_id_required",
             "category" => "validation",
             "retryable" => false,
             "message" => "A conversation_id is required for this operation.",
             "details" => %{}
           }
  end

  test "classifies assistant lifecycle conflicts without a generic reason field" do
    assert Error.to_map(:assistant_busy) == %{
             "code" => "assistant_busy",
             "category" => "lifecycle",
             "retryable" => true,
             "message" => "assistant is busy",
             "details" => %{}
           }
  end

  test "reports cross-provider results as a stable contract violation" do
    assert Error.to_map({:provider_mismatch, "cursor", "claude"}) == %{
             "code" => "provider_mismatch",
             "category" => "validation",
             "retryable" => false,
             "message" => "The agent result belongs to a different provider.",
             "details" => %{"expected_provider" => "cursor", "actual_provider" => "claude"}
           }
  end

  test "accepts only a complete canonical error map" do
    canonical = %{
      "code" => "provider_disconnected",
      "category" => "provider",
      "retryable" => true,
      "message" => "Disconnected.",
      "details" => %{}
    }

    assert Error.to_map(canonical) == canonical
    assert Error.to_map(%{"message" => "native"})["code"] == "agent_operation_failed"
  end
end
