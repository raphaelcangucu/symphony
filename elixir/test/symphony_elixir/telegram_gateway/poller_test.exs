defmodule SymphonyElixir.TelegramGateway.PollerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.TelegramGateway.Poller

  test "poll_once fetches updates, routes them, and advances offset" do
    updates = [
      %{
        "update_id" => 100,
        "message" => %{
          "text" => "/help",
          "chat" => %{"id" => 1, "type" => "private"},
          "from" => %{"id" => 1}
        }
      }
    ]

    fetch = fn offset ->
      assert offset == 0
      {:ok, updates}
    end

    {:ok, routed} = Agent.start_link(fn -> [] end)

    route = fn update ->
      Agent.update(routed, &[update | &1])
      {:ok, :command}
    end

    assert {:ok, 101} = Poller.poll_once(0, fetch_updates: fetch, route_update: route)
    assert Agent.get(routed, &length/1) == 1
  end
end
