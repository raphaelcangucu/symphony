defmodule SymphonyElixir.DevServer.BroadcasterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.Broadcaster

  test "notify broadcasts a snapshot payload on the issue topic" do
    topic = Broadcaster.topic("gamba", "1878")
    :ok = Phoenix.PubSub.subscribe(SymphonyElixir.PubSub, topic)

    assert :ok = Broadcaster.notify("missing-project", "1878")

    refute_receive {:dev_server_update, _payload}, 50
  end
end
