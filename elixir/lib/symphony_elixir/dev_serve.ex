defmodule SymphonyElixir.DevServe do
  @moduledoc """
  Pure boot-input resolution for the local `make serve` script (`dev/serve.exs`).

  Global-less orchestration boots with process settings only (per-project config
  is DB-owned), so the only boot input resolved here is the optional HTTP port
  override.
  """

  @port_env "SYMPHONY_TRACKER_PORT"

  @doc """
  Loads `elixir/.env` into the process environment when present.

  By default, existing variables are left untouched so an explicit shell export
  or a partial env prefix (e.g. only `SYMPHONY_TRACKER_PORT`) still wins. This
  mirrors `make serve` / `mix symphony.ctl serve`, which source `.env` before
  booting the detached daemon.
  """
  @spec load_dotenv!(keyword()) :: :ok
  def load_dotenv!(opts \\ []) do
    only_if_missing = Keyword.get(opts, :only_if_missing, true)
    env_path = Keyword.get(opts, :path, Path.join(File.cwd!(), ".env"))

    if File.regular?(env_path) do
      env_path
      |> File.read!()
      |> String.split("\n", trim: false)
      |> Enum.each(&import_env_line(&1, only_if_missing))
    end

    :ok
  end

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

  defp import_env_line(line, only_if_missing) do
    line = String.trim(line)

    cond do
      line == "" or String.starts_with?(line, "#") ->
        :ok

      true ->
        case String.split(line, "=", parts: 2) do
          [key, value] ->
            key = String.trim(key)
            value = String.trim(value)

            if only_if_missing and is_binary(System.get_env(key)) do
              :ok
            else
              System.put_env(key, value)
            end

          _ ->
            :ok
        end
    end
  end
end
