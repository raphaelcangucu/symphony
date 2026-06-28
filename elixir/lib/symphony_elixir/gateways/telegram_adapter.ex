defmodule SymphonyElixir.Gateways.TelegramAdapter do
  @moduledoc "Gateway adapter implementation for Telegram."

  @behaviour SymphonyElixir.Gateways.Adapter

  alias SymphonyElixir.Gateways.InboundMessage
  alias SymphonyElixir.TelegramGateway.{Normalizer, Sender}

  @impl true
  def normalize_update(update), do: Normalizer.normalize_update(update)

  @impl true
  def send_text(%InboundMessage{} = message, text, opts), do: Sender.send_text(message, text, opts)

  @impl true
  def send_typing(%InboundMessage{} = message, opts), do: Sender.send_typing(message, opts)
end
