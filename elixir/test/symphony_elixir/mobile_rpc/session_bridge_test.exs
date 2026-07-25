defmodule SymphonyElixir.MobileRpc.SessionBridgeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileRpc.SessionBridge

  defmodule FakeChannel do
    def join("assistant:thread:42", %{}, socket) do
      send(self(), :history)
      {:ok, %{}, socket}
    end

    def handle_in("send_message", %{"message" => message}, socket) do
      Phoenix.Channel.push(socket, "message_created", %{
        message: %{id: "message-1", role: "user", content: message}
      })

      {:reply, :ok, socket}
    end

    def handle_info(:history, socket) do
      Phoenix.Channel.push(socket, "history_loaded", %{messages: []})
      {:noreply, socket}
    end
  end

  test "owns assistant channel state and forwards pushes only after activation" do
    assert {:ok, bridge} =
             SessionBridge.start_link(
               connection_pid: self(),
               thread_id: 42,
               subscription_id: "sub_42",
               channel_module: FakeChannel
             )

    refute_receive {:mobile_rpc_event, "sub_42", _, _}
    SessionBridge.activate(bridge)

    assert_receive {:mobile_rpc_event, "sub_42", "sessions.history_loaded", %{messages: []}}
    assert :ok = SessionBridge.command(bridge, "send_message", %{"message" => "Continue"})

    assert_receive {:mobile_rpc_event, "sub_42", "sessions.message_created", %{message: %{content: "Continue"}}}

    assert :ok = GenServer.stop(bridge)
  end
end
