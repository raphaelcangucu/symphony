defmodule SymphonyElixir.KnowledgeBase.Frontmatter do
  @moduledoc "Serializes knowledge base frontmatter + body into a Markdown document."

  @spec serialize(map(), String.t()) :: String.t()
  def serialize(frontmatter, body) when is_map(frontmatter) and is_binary(body) do
    if map_size(frontmatter) == 0 do
      body
    else
      {:ok, yaml} = Ymlr.document(frontmatter)
      yaml = yaml |> String.trim_leading() |> strip_leading_doc_marker()
      "---\n" <> String.trim_trailing(yaml) <> "\n---\n" <> body
    end
  end

  @spec merge(map(), map()) :: map()
  def merge(existing, updates) when is_map(existing) and is_map(updates),
    do: Map.merge(existing, updates)

  # Ymlr.document/1 prefixes a YAML document with "---\n"; strip it so we control the fences.
  defp strip_leading_doc_marker("---\n" <> rest), do: rest
  defp strip_leading_doc_marker(other), do: other
end
