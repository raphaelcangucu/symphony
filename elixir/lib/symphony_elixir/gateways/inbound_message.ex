defmodule SymphonyElixir.Gateways.InboundMessage do
  @moduledoc "Provider-neutral inbound gateway message."

  @enforce_keys [:provider, :account_id, :conversation_kind, :conversation_id, :sender_id, :raw_text]
  defstruct [
    :provider,
    :account_id,
    :conversation_kind,
    :conversation_id,
    :parent_conversation_id,
    :thread_id,
    :sender_id,
    :sender_name,
    :message_id,
    :reply_to_message_id,
    :raw_text,
    metadata: %{}
  ]

  @type t :: %__MODULE__{
          provider: String.t(),
          account_id: String.t(),
          conversation_kind: String.t(),
          conversation_id: String.t(),
          parent_conversation_id: String.t() | nil,
          thread_id: String.t() | nil,
          sender_id: String.t(),
          sender_name: String.t() | nil,
          message_id: String.t() | nil,
          reply_to_message_id: String.t() | nil,
          raw_text: String.t(),
          metadata: map()
        }
end
