defmodule SymphonyElixir.DevServe do
  @moduledoc """
  Pure boot-input resolution for the local `make serve` script (`dev/serve.exs`).

  Global-less orchestration boots with process settings only (per-project config
  is DB-owned), so the only boot input resolved here is the optional HTTP port
  override.
  """

  @port_env "SYMPHONY_TRACKER_PORT"

  @doc """
  Parses the optional HTTP port override from the environment.

  Returns `{:ok, nil}` when unset, `{:ok, port}` for a valid non-negative integer,
  or `{:error, message}` for an invalid value.
  """
  @spec resolve_port(%{optional(String.t()) => String.t()}) ::
          {:ok, non_neg_integer() | nil} | {:error, String.t()}
  def resolve_port(env) when is_map(env) do
    case Map.get(env, @port_env) do
      nil ->
        {:ok, nil}

      value when is_binary(value) ->
        case Integer.parse(String.trim(value)) do
          {port, ""} when port >= 0 -> {:ok, port}
          _ -> {:error, "Invalid #{@port_env}: #{inspect(value)}"}
        end
    end
  end
end
