defmodule SymphonyElixir.AgentUsage.Snapshot do
  @moduledoc """
  Normalized plan-usage snapshot for a single agent.

  Produced by `SymphonyElixir.AgentUsage.Window.normalize/3` from a raw
  agent rate-limit payload and stored (TTL'd) by `SymphonyElixir.AgentUsage`.
  `fetched_at` is stamped by the store on `put/2`, not by the normalizer.
  """

  alias SymphonyElixir.AgentUsage.Window

  @enforce_keys [:agent_kind]
  defstruct agent_kind: nil,
            account_id: nil,
            plan: nil,
            credits_remaining: nil,
            credits_unlimited: false,
            windows: [],
            model_limits: [],
            fetched_at: nil,
            state: :fresh,
            stale_reason: nil,
            next_refresh_at: nil,
            error: nil

  @type t :: %__MODULE__{
          agent_kind: String.t(),
          account_id: String.t() | nil,
          plan: String.t() | nil,
          credits_remaining: number() | nil,
          credits_unlimited: boolean(),
          windows: [Window.t()],
          model_limits: [Window.t()],
          fetched_at: integer() | nil,
          state: :fresh | :refreshing | :stale,
          stale_reason: atom() | nil,
          next_refresh_at: integer() | nil,
          error: term() | nil
        }
end
