defmodule SymphonyElixir.Daemon.Environment do
  @moduledoc "Renders the controlled systemd EnvironmentFile contract."

  @spec render(map()) :: String.t()
  def render(env) when is_map(env) do
    env
    |> Enum.filter(fn {key, _value} ->
      key in ["PATH", "HOME", "LANG", "LC_ALL"] or
        String.starts_with?(key, "SYMPHONY_")
    end)
    |> Enum.sort_by(&elem(&1, 0))
    |> Enum.map_join("", fn {key, value} ->
      validate_key!(key)
      "#{key}=\"#{escape(to_string(value))}\"\n"
    end)
  end

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
