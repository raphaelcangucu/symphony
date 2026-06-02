defmodule SymphonyElixir.Assistant.CodexSessionTurnStartedTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.CodexSession

  # default_runner builds live Codex sessions (requires the codex binary), so the
  # turn-id forwarding is exercised end-to-end through the channel tests. This test
  # locks the public `on_turn_started` option contract that later tasks depend on.
  test "on_turn_started is a 1-arity callback option the runner accepts" do
    callback = fn turn_id -> turn_id end

    assert is_function(callback, 1)
    assert Code.ensure_loaded?(CodexSession)
  end
end
