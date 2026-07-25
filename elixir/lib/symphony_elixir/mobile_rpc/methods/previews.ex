defmodule SymphonyElixir.MobileRpc.Methods.Previews do
  @moduledoc "Allowlisted preview runtime operations over encrypted mobile RPC."
  def modules, do: [__MODULE__.Request]

  defmodule Request do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.TrackerRequest
    def name, do: "previews.request"
    def scope, do: :mobile
    def timeout_ms, do: 60_000
    defdelegate validate(params), to: TrackerRequest
    def call(params, context), do: TrackerRequest.call(:previews, params, context)
  end
end
