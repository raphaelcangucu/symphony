defmodule SymphonyElixir.Agent.ClientTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Agent.{BackendCapabilities, Client, ConversationRef}

  test "lists the supported executable providers and their contracts" do
    assert Client.providers() == ["codex", "claude", "cursor"]

    assert %BackendCapabilities{provider: "codex", steer: true} =
             Client.capabilities("codex")
  end

  test "executes a provider with a canonical conversation and Symphony execution identity" do
    parent = self()

    runner = fn workspace, prompt, opts ->
      send(parent, {:run, workspace, prompt, opts})

      {:ok,
       %{
         provider: "claude",
         conversation_id: "claude-chat-1",
         run_id: "claude-run-1",
         execution_id: "provider-owned-id",
         assistant_message: "done",
         tool_calls: [],
         status: "completed"
       }}
    end

    assert {:ok, result} =
             Client.execute(
               :run,
               provider: "claude",
               workspace: "/tmp/project",
               prompt: "Implement it",
               conversation_id: "claude-chat-1",
               model: "sonnet",
               effort: "high",
               execution_mode: "build",
               runner: runner,
               execution_id_factory: fn -> "exec-symphony-1" end
             )

    assert_receive {:run, "/tmp/project", "Implement it", opts}

    assert %ConversationRef{provider: "claude", conversation_id: "claude-chat-1"} =
             opts[:conversation_ref]

    assert opts[:agent_kind] == "claude"
    assert opts[:model] == "sonnet"
    assert opts[:effort] == "high"
    assert opts[:execution_mode] == "build"

    assert result.provider == "claude"
    assert result.conversation_id == "claude-chat-1"
    assert result.run_id == "claude-run-1"
    assert result.execution_id == "exec-symphony-1"
    assert result.assistant_message == "done"
  end

  test "returns a stable public error map" do
    runner = fn _workspace, _prompt, _opts -> {:error, :epipe} end

    assert {:error, error} =
             Client.execute(
               :run,
               provider: "cursor",
               workspace: "/tmp/project",
               prompt: "Implement it",
               runner: runner
             )

    assert error["code"] == "provider_disconnected"
    assert error["category"] == "provider"
    assert error["retryable"]
  end

  test "normalizes arbitrary runner error maps instead of trusting parallel schemas" do
    runner = fn _workspace, _prompt, _opts -> {:error, %{message: "native boom"}} end

    assert {:error, error} =
             Client.execute(
               :run,
               provider: "cursor",
               workspace: "/tmp/project",
               prompt: "Implement it",
               runner: runner
             )

    assert Map.keys(error) |> Enum.sort() ==
             ~w(category code details message retryable)

    assert error["code"] == "agent_operation_failed"
    assert error["category"] == "internal"
  end

  test "rejects unsupported providers before invoking the runner" do
    assert {:error, error} =
             Client.execute(
               :run,
               provider: "opencode",
               workspace: "/tmp/project",
               prompt: "Implement it",
               runner: fn _, _, _ -> flunk("runner must not be called") end
             )

    assert error["code"] == "unsupported_provider"
  end

  test "emulates a portable goal through the same execution signature" do
    parent = self()

    runner = fn _workspace, prompt, _opts ->
      send(parent, {:goal_prompt, prompt})

      {:ok,
       %{
         conversation_id: "cursor-goal",
         run_id: "cursor-goal-run",
         assistant_message: "done"
       }}
    end

    assert {:ok, result} =
             Client.execute(
               :goal,
               provider: "cursor",
               workspace: "/tmp/project",
               prompt: "Ship the canonical contract",
               runner: runner,
               execution_id_factory: fn -> "exec-goal" end
             )

    assert_receive {:goal_prompt, prompt}
    assert prompt =~ "Persistent objective:"
    assert prompt =~ "Ship the canonical contract"
    assert result.conversation_id == "cursor-goal"
    assert result.execution_id == "exec-goal"
  end

  test "steer is a resumed continuation and requires the canonical conversation id" do
    assert {:error, error} =
             Client.execute(
               :steer,
               provider: "claude",
               workspace: "/tmp/project",
               prompt: "Focus on tests",
               runner: fn _, _, _ -> flunk("runner must not be called") end
             )

    assert error["code"] == "conversation_id_required"

    parent = self()

    runner = fn _workspace, prompt, opts ->
      send(parent, {:steer, prompt, opts})

      {:ok,
       %{
         conversation_id: "claude-chat",
         run_id: "claude-run-2",
         assistant_message: "redirected"
       }}
    end

    assert {:ok, result} =
             Client.execute(
               :steer,
               provider: "claude",
               workspace: "/tmp/project",
               prompt: "Focus on tests",
               conversation_id: "claude-chat",
               runner: runner
             )

    assert_receive {:steer, "Focus on tests", opts}
    assert %ConversationRef{conversation_id: "claude-chat"} = opts[:conversation_ref]
    assert result.assistant_message == "redirected"
  end

  test "an explicitly blank conversation id is rejected instead of starting fresh" do
    assert {:error, error} =
             Client.execute(
               :run,
               provider: "codex",
               workspace: "/tmp/project",
               prompt: "Continue",
               conversation_id: " ",
               runner: fn _, _, _ -> flunk("runner must not be called") end
             )

    assert error["code"] == "conversation_id_required"
  end
end
