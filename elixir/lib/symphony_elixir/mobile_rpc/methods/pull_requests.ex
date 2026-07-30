defmodule SymphonyElixir.MobileRpc.Methods.PullRequests do
  @moduledoc "Allowlisted pull-request operations over encrypted mobile RPC."
  @spec modules() :: [module()]
  def modules, do: [__MODULE__.Request]

  defmodule Request do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.TrackerRequest
    @impl true
    def name, do: "pull_requests.request"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 60_000
    @impl true
    defdelegate validate(params), to: TrackerRequest
    @impl true
    def call(params, context), do: TrackerRequest.call(:pull_requests, params, context)
  end
end
