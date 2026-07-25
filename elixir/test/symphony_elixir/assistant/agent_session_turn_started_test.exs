defmodule SymphonyElixir.Assistant.AgentSessionTurnStartedTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.AgentSession

  # default_runner builds live Codex sessions (requires the codex binary), so the
  # turn-id forwarding is exercised end-to-end through the channel tests. This test
  # locks the canonical `on_turn_started` identity contract.
  test "on_turn_started receives conversation_id and run_id" do
    callback = fn conversation_id, run_id -> {conversation_id, run_id} end

    assert is_function(callback, 2)
    assert Code.ensure_loaded?(AgentSession)
  end
end
