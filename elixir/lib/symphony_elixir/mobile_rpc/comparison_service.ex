defmodule SymphonyElixir.MobileRpc.ComparisonService do
  @moduledoc "Routes comparison RPC calls into the selected host coordinator."

  alias SymphonyElixir.MobileComparison.Service

  @spec call(String.t(), map(), map()) :: {:ok, map()} | {:error, term()}
  def call("comparisons.start", params, context), do: Service.start(params, context)
  def call("comparisons.get", params, context), do: Service.get(params, context)
  def call("comparisons.retry_cell", params, context), do: Service.retry_cell(params, context)
  def call(_method, _params, _context), do: {:error, :unsupported_comparison_method}
end
