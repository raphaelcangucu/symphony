defmodule SymphonyElixir.Daemon.Environment do
  @moduledoc "Renders the controlled systemd EnvironmentFile contract."

  @spec render(map()) :: String.t()
  def render(env) when is_map(env) do
    env
    |> Enum.filter(fn {key, _value} ->
      key in [
        "PATH",
        "HOME",
        "LANG",
        "LC_ALL",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_STATE_HOME"
      ] or
        String.starts_with?(key, "SYMPHONY_")
    end)
    |> Enum.sort_by(&elem(&1, 0))
    |> Enum.map_join("", fn {key, value} ->
      validate_key!(key)
      "#{key}=\"#{escape(to_string(value))}\"\n"
    end)
  end

  @spec read(Path.t()) :: {:ok, map()} | {:error, :missing | :invalid}
  def read(path) do
    with {:ok, body} <- File.read(path),
         {:ok, env} <- parse(body) do
      {:ok, env}
    else
      {:error, :enoent} -> {:error, :missing}
      _ -> {:error, :invalid}
    end
  end

  @spec parse(String.t()) :: {:ok, map()} | {:error, :invalid}
  def parse(body) when is_binary(body) do
    body
    |> String.split("\n", trim: true)
    |> Enum.reduce_while({:ok, %{}}, fn line, {:ok, env} ->
      case Regex.run(~r/\A([A-Z_][A-Z0-9_]*)="((?:\\.|[^"])*)"\z/, line) do
        [_, key, encoded] ->
          case unescape(encoded) do
            {:ok, value} -> {:cont, {:ok, Map.put(env, key, value)}}
            :error -> {:halt, {:error, :invalid}}
          end

        _ ->
          {:halt, {:error, :invalid}}
      end
    end)
  end

  defp unescape(value) do
    value
    |> String.graphemes()
    |> do_unescape([])
  end

  defp do_unescape([], acc), do: {:ok, acc |> Enum.reverse() |> IO.iodata_to_binary()}
  defp do_unescape(["\\", "\\" | rest], acc), do: do_unescape(rest, ["\\" | acc])
  defp do_unescape(["\\", "\"" | rest], acc), do: do_unescape(rest, ["\"" | acc])
  defp do_unescape(["\\" | _rest], _acc), do: :error
  defp do_unescape([char | rest], acc), do: do_unescape(rest, [char | acc])

  defp validate_key!(key) do
    unless Regex.match?(~r/\A[A-Z_][A-Z0-9_]*\z/, key) do
      raise ArgumentError, "unsafe environment key: #{inspect(key)}"
    end
  end

  defp escape(value) do
    if String.contains?(value, ["\n", "\r", "\0"]) do
      raise ArgumentError, "unsafe environment value"
    end

    value
    |> String.replace("\\", "\\\\")
    |> String.replace("\"", "\\\"")
  end
end
