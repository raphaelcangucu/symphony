defmodule SymphonyElixir.MobileRpc.Methods.Git do
  @moduledoc "Allowlisted Git and diff operations over encrypted mobile RPC."
  def modules, do: [__MODULE__.Request]

  defmodule Request do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.TrackerRequest
    def name, do: "git.request"
    def scope, do: :mobile
    def timeout_ms, do: 60_000
    defdelegate validate(params), to: TrackerRequest
    def call(params, context), do: TrackerRequest.call(:git, params, context)
  end
end
