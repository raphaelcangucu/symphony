defmodule SymphonyElixirWeb.AgentExecutionChannelTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  @endpoint SymphonyElixirWeb.Endpoint
  @topic "agent_executions"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    {:ok, _, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{tracker_token_valid: true})
      |> subscribe_and_join(SymphonyElixirWeb.AgentExecutionChannel, @topic)

    %{socket: socket}
  end

  test "join pushes snapshot on after_join", %{socket: _socket} do
    assert_push("snapshot", %{"data" => data})
    assert is_list(data)
  end

  test "relays PubSub agent execution events", %{socket: _socket} do
    assert_push("snapshot", _)

    Phoenix.PubSub.broadcast(
      SymphonyElixir.PubSub,
      @topic,
      {:agent_execution_event, "snapshot", %{"data" => []}}
    )

    assert_push("snapshot", %{"data" => data}, 1_000)
    assert is_list(data)
  end

  test "rejects join without valid token" do
    assert {:error, %{reason: "unauthorized"}} =
             socket(SymphonyElixirWeb.UserSocket, nil, %{})
             |> subscribe_and_join(SymphonyElixirWeb.AgentExecutionChannel, @topic)
  end
end
