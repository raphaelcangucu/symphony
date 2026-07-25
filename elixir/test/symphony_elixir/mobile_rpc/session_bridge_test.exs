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

  defmodule OverflowChannel do
    def join("assistant:thread:42", %{}, socket), do: {:ok, %{}, socket}

    def handle_in("sync_history", %{}, socket) do
      Phoenix.Channel.push(socket, "history_synced", %{messages: []})
      {:reply, :ok, socket}
    end
  end

  test "requests an explicit history resync when the preactivation buffer overflows" do
    assert {:ok, bridge} =
             SessionBridge.start_link(
               connection_pid: self(),
               thread_id: 42,
               subscription_id: "sub_bounded",
               channel_module: OverflowChannel,
               max_pending: 2
             )

    send(bridge, {:mobile_assistant_push, "assistant_delta", %{delta: "first"}})
    send(bridge, {:mobile_assistant_push, "assistant_delta", %{delta: "second"}})
    send(bridge, {:mobile_assistant_push, "assistant_delta", %{delta: "third"}})
    SessionBridge.activate(bridge)

    assert_receive {:mobile_rpc_event, "sub_bounded", "sessions.resync_required", %{reason: "preactivation_overflow"}}

    refute_receive {:mobile_rpc_event, "sub_bounded", "sessions.assistant_delta", _}

    assert :ok = SessionBridge.command(bridge, "sync_history", %{})
    assert_receive {:mobile_rpc_event, "sub_bounded", "sessions.history_synced", %{messages: []}}

    assert :ok = GenServer.stop(bridge)
  end
end
