defmodule SymphonyElixir.MobileRpc.Methods.PullRequests do
  @moduledoc "Allowlisted pull-request operations over encrypted mobile RPC."
  def modules, do: [__MODULE__.Request]

  defmodule Request do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.TrackerRequest
    def name, do: "pull_requests.request"
    def scope, do: :mobile
    def timeout_ms, do: 60_000
    defdelegate validate(params), to: TrackerRequest
    def call(params, context), do: TrackerRequest.call(:pull_requests, params, context)
  end
end
