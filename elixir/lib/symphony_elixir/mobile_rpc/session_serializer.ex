defmodule SymphonyElixir.MobileRpc.SessionSerializer do
  @moduledoc false
  @behaviour Phoenix.Socket.Serializer

  alias Phoenix.Socket.{Broadcast, Message, Reply}

  @impl true
  def encode!(%Message{event: event, payload: payload}),
    do: {:mobile_assistant_push, event, payload}

  def encode!(%Reply{ref: ref, status: status, payload: payload}),
    do: {:mobile_assistant_reply, ref, status, payload}

  @impl true
  def fastlane!(%Broadcast{event: event, payload: payload}),
    do: {:mobile_assistant_push, event, payload}

  @impl true
  def decode!(_iodata, _options), do: raise("mobile RPC session serializer is outbound only")
end
