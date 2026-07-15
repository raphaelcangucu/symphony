defmodule SymphonyElixirWeb.RecentsChannelTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias SymphonyElixir.Recents.Broadcaster

  @endpoint SymphonyElixirWeb.Endpoint
  @topic "recents"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    {:ok, _, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{tracker_token_valid: true})
      |> subscribe_and_join(SymphonyElixirWeb.RecentsChannel, @topic)

    %{socket: socket}
  end

  test "join pushes a JSON-friendly snapshot on after_join", %{socket: _socket} do
    assert_push("snapshot", %{"data" => data})
    assert is_list(data)
    assert Enum.all?(data, &is_map/1)
  end

  test "relays PubSub recents events", %{socket: _socket} do
    assert_push("snapshot", _)

    assert :ok = Broadcaster.notify()

    assert_push("snapshot", %{"data" => data}, 1_000)
    assert is_list(data)
  end

  test "rejects join without valid token" do
    assert {:error, %{reason: "unauthorized"}} =
             socket(SymphonyElixirWeb.UserSocket, nil, %{})
             |> subscribe_and_join(SymphonyElixirWeb.RecentsChannel, @topic)
  end
end
