defmodule SymphonyElixir.MobileRpc.Method do
  @moduledoc "Behaviour for one allowlisted mobile RPC method."

  @callback name() :: String.t()
  @callback scope() :: :mobile
  @callback timeout_ms() :: pos_integer()
  @callback validate(map()) :: {:ok, map()} | {:error, term()}
  @callback call(map(), map()) :: {:ok, term()} | {:error, term()}
end
