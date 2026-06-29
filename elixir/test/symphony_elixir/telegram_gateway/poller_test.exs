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

  test "route_update_async does not block the poller while a route is running" do
    parent = self()

    route = fn update ->
      send(parent, {:started, update})

      receive do
        :release -> :ok
      end
    end

    assert {:ok, pid} =
             Poller.route_update_async(%{"update_id" => 101},
               route_update: route,
               task_starter: fn fun -> Task.start(fun) end
             )

    assert_receive {:started, %{"update_id" => 101}}
    assert Process.alive?(pid)
    send(pid, :release)
  end
end
