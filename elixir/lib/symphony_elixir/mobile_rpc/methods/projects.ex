defmodule SymphonyElixir.MobileRpc.Methods.Projects do
  @moduledoc "Allowlisted project operations over the encrypted mobile channel."

  @spec modules() :: [module()]
  def modules, do: [__MODULE__.Request]

  defmodule Request do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.TrackerRequest

    @impl true
    def name, do: "projects.request"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 30_000
    @impl true
    defdelegate validate(params), to: TrackerRequest
    @impl true
    def call(params, context), do: TrackerRequest.call(:projects, params, context)
  end
end
