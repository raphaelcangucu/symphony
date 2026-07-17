defmodule SymphonyElixir.Notion.Url do
  @moduledoc false

  @hex32 ~r/([0-9a-fA-F]{32})/

  @spec parse(String.t()) ::
          {:ok, %{id: String.t(), focused_page_id: String.t() | nil}} | {:error, :invalid_notion_url}
  def parse(url) when is_binary(url) do
    uri = URI.parse(String.trim(url))

    with true <- notion_host?(uri.host),
         {:ok, path_id} <- path_id(uri.path) do
      focused =
        case uri.query do
          q when is_binary(q) ->
            q |> URI.decode_query() |> Map.get("p") |> normalize_id()

          _ ->
            nil
        end

      {:ok, %{id: path_id, focused_page_id: focused}}
    else
      _ -> {:error, :invalid_notion_url}
    end
  end

  def parse(_), do: {:error, :invalid_notion_url}

  defp notion_host?(host) when is_binary(host) do
    host in ["notion.so", "www.notion.so"] or String.ends_with?(host, ".notion.site")
  end

  defp notion_host?(_), do: false

  defp path_id(path) when is_binary(path) do
    normalized_path = String.replace(path, "-", "")

    case Regex.scan(@hex32, normalized_path) |> List.last() do
      [_, hex] -> {:ok, to_uuid(hex)}
      _ -> :error
    end
  end

  defp path_id(_), do: :error

  defp normalize_id(nil), do: nil

  defp normalize_id(value) when is_binary(value) do
    hex = value |> String.replace("-", "") |> String.downcase()

    if String.match?(hex, ~r/^[0-9a-f]{32}$/), do: to_uuid(hex), else: nil
  end

  defp to_uuid(<<a::binary-size(8), b::binary-size(4), c::binary-size(4), d::binary-size(4),
                 e::binary-size(12)>>) do
    "#{a}-#{b}-#{c}-#{d}-#{e}" |> String.downcase()
  end
end
