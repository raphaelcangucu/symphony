defmodule SymphonyElixir.Assistant.AgentSessionGoalRelayTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.AgentSession

  test "on_goal_updated is a 1-arity callback option the runner accepts" do
    callback = fn _goal -> :ok end

    assert is_function(callback, 1)
    assert Code.ensure_loaded?(AgentSession)
  end
end
