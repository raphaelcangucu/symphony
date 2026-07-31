defmodule SymphonyElixir.Recents.BroadcasterTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Recents.Broadcaster

  @topic "recents"
  @name __MODULE__.Broadcaster

  setup do
    {:ok, _pid} = Broadcaster.start_link(name: @name)
    Application.put_env(:symphony_elixir, :recents_snapshot_items_fun, fn -> [] end)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :recents_snapshot_items_fun) end)
    :ok
  end

  test "notify broadcasts a JSON-friendly recents snapshot" do
    assert :ok = Phoenix.PubSub.subscribe(SymphonyElixir.PubSub, @topic)
    assert :ok = Broadcaster.notify(@name)

    assert_receive {:recents_event, "snapshot", %{"data" => data}}, 1_000
    assert is_list(data)
    assert Enum.all?(data, &is_map/1)
    assert Enum.all?(data, &(Map.has_key?(&1, :id) and Map.has_key?(&1, :updated_at)))
  end
end
