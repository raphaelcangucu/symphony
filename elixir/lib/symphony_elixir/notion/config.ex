defmodule SymphonyElixir.Notion.Config do
  @moduledoc false

  alias SymphonyElixir.Settings.Credentials

  @spec api_key() :: String.t() | nil
  def api_key do
    case Credentials.get("notion", "api_key") do
      value when is_binary(value) ->
        normalize(value)

      _ ->
        System.get_env("NOTION_API_KEY") |> normalize()
    end
  end

  defp normalize(nil), do: nil

  defp normalize(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end
end
