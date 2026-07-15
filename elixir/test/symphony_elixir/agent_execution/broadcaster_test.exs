defmodule SymphonyElixir.AgentExecution.BroadcasterTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.AgentExecution.Broadcaster

  @topic "agent_executions"

  test "notify broadcasts an agent execution snapshot" do
    assert :ok = Phoenix.PubSub.subscribe(SymphonyElixir.PubSub, @topic)
    assert :ok = Broadcaster.notify()

    assert_receive {:agent_execution_event, "snapshot", %{"data" => data}}, 1_000
    assert is_list(data)
  end
end
