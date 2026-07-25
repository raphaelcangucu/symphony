defmodule SymphonyElixir.MobileRpc.Methods.Notifications do
  @moduledoc "Allowlisted host-routed notification operations over encrypted mobile RPC."
  @spec modules() :: [module()]
  def modules, do: [__MODULE__.Request]

  defmodule Request do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.TrackerRequest
    @impl true
    def name, do: "notifications.request"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 30_000
    @impl true
    defdelegate validate(params), to: TrackerRequest
    @impl true
    def call(params, context), do: TrackerRequest.call(:notifications, params, context)
  end
end
