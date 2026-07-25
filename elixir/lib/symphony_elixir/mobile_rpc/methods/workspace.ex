defmodule SymphonyElixir.MobileRpc.Methods.Workspace do
  @moduledoc "Allowlisted workspace file operations over encrypted mobile RPC."
  def modules, do: [__MODULE__.Request]

  defmodule Request do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.TrackerRequest
    def name, do: "workspace.request"
    def scope, do: :mobile
    def timeout_ms, do: 30_000
    defdelegate validate(params), to: TrackerRequest
    def call(params, context), do: TrackerRequest.call(:workspace, params, context)
  end
end
