defmodule SymphonyElixir.Gateways.Adapter do
  @moduledoc "Behaviour for external chat gateway adapters."

  alias SymphonyElixir.Gateways.InboundMessage

  @callback normalize_update(term()) :: {:ok, InboundMessage.t()} | {:ignore, term()} | {:error, term()}
  @callback send_text(InboundMessage.t(), String.t(), keyword()) :: :ok | {:error, term()}
  @callback send_typing(InboundMessage.t(), keyword()) :: :ok | {:error, term()}
end
