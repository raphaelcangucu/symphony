defmodule SymphonyElixir.Daemon.Configuration do
  @moduledoc "Resolves and validates the installed daemon network configuration."

  @default_host "127.0.0.1"
  @default_port 4_000

  @spec endpoint(keyword()) ::
          {:ok, %{host: String.t(), port: :inet.port_number()}} | {:error, String.t()}
  def endpoint(opts \\ []) do
    env = Keyword.get(opts, :env, System.get_env())
    host = Keyword.get(opts, :host, env["SYMPHONY_TRACKER_HOST"] || @default_host)
    port = Keyword.get(opts, :port, env["SYMPHONY_TRACKER_PORT"] || @default_port)

    with {:ok, host} <- validate_host(host),
         {:ok, port} <- validate_port(port) do
      {:ok, %{host: host, port: port}}
    end
  end

  defp validate_host(host) when is_binary(host) do
    case String.trim(host) do
      "" -> {:error, "SYMPHONY_TRACKER_HOST must not be empty"}
      value -> {:ok, value}
    end
  end

  defp validate_host(_host), do: {:error, "SYMPHONY_TRACKER_HOST must be a string"}

  defp validate_port(port) when is_integer(port) and port in 1..65_535, do: {:ok, port}

  defp validate_port(port) when is_binary(port) do
    case Integer.parse(port) do
      {value, ""} when value in 1..65_535 -> {:ok, value}
      _ -> {:error, "SYMPHONY_TRACKER_PORT must be an integer from 1 to 65535"}
    end
  end

  defp validate_port(_port),
    do: {:error, "SYMPHONY_TRACKER_PORT must be an integer from 1 to 65535"}
end
