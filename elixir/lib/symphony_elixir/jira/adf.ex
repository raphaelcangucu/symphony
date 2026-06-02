defmodule SymphonyElixir.Jira.Adf do
  @moduledoc """
  Minimal conversion between plain text and Atlassian Document Format (ADF).

  JIRA Cloud REST API v3 represents `description` and comment bodies as an ADF
  JSON tree rather than plain strings. Symphony issues/comments are plain text,
  so writes wrap text in a single-paragraph-per-block ADF doc and reads flatten
  the tree back to text. Only `doc`/`paragraph`/`text` nodes are modeled; richer
  nodes (tables, mentions, panels) degrade to their concatenated text content.
  """

  @doc_version 1

  @type adf :: %{required(String.t()) => term()}

  @doc """
  Wraps plain text in an ADF document. Blank lines split the text into separate
  paragraphs. `nil` or empty input yields a doc with no content.
  """
  @spec from_text(String.t() | nil) :: adf()
  def from_text(nil), do: empty_doc()

  def from_text(text) when is_binary(text) do
    content =
      text
      |> split_paragraphs()
      |> Enum.map(&paragraph_node/1)

    %{"type" => "doc", "version" => @doc_version, "content" => content}
  end

  @doc """
  Flattens an ADF document back to plain text, joining block-level nodes with
  blank lines. A plain string is returned unchanged; `nil` becomes an empty
  string.
  """
  @spec to_text(adf() | String.t() | nil) :: String.t()
  def to_text(nil), do: ""
  def to_text(text) when is_binary(text), do: text

  def to_text(%{"content" => content}) when is_list(content) do
    Enum.map_join(content, "\n\n", &node_text/1)
  end

  def to_text(node) when is_map(node), do: node_text(node)

  defp split_paragraphs(text) do
    text
    |> String.split(~r/\n{2,}/)
    |> Enum.reject(&(&1 == ""))
  end

  defp paragraph_node(paragraph) do
    %{"type" => "paragraph", "content" => [%{"type" => "text", "text" => paragraph}]}
  end

  defp node_text(%{"type" => "text", "text" => text}) when is_binary(text), do: text
  defp node_text(%{"content" => content}) when is_list(content), do: Enum.map_join(content, "", &node_text/1)
  defp node_text(_node), do: ""

  defp empty_doc, do: %{"type" => "doc", "version" => @doc_version, "content" => []}
end
