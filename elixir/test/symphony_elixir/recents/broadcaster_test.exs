defmodule SymphonyElixir.Recents.BroadcasterTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Recents.Broadcaster

  @topic "recents"

  test "notify broadcasts a JSON-friendly recents snapshot" do
    assert :ok = Phoenix.PubSub.subscribe(SymphonyElixir.PubSub, @topic)
    assert :ok = Broadcaster.notify()

    assert_receive {:recents_event, "snapshot", %{"data" => data}}, 1_000
    assert is_list(data)
    assert Enum.all?(data, &is_map/1)
    assert Enum.all?(data, &(Map.has_key?(&1, :id) and Map.has_key?(&1, :updated_at)))
  end
end
