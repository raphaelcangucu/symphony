defmodule SymphonyElixir.MobileRpc.Methods.Tasks do
  @moduledoc "Allowlisted task operations over the encrypted mobile channel."

  def modules, do: [__MODULE__.Request]

  defmodule Request do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.TrackerRequest

    def name, do: "tasks.request"
    def scope, do: :mobile
    def timeout_ms, do: 30_000
    defdelegate validate(params), to: TrackerRequest
    def call(params, context), do: TrackerRequest.call(:tasks, params, context)
  end
end
