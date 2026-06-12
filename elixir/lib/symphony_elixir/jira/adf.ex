defmodule SymphonyElixir.Jira.Adf do
  @moduledoc """
  Conversion between plain text and Atlassian Document Format (ADF).

  JIRA Cloud REST API v3 represents `description` and comment bodies as an ADF
  JSON tree rather than plain strings. Symphony stores plain text, so writes wrap
  text in a single-paragraph-per-block ADF doc.

  Reads (`to_text/1`) render the tree to **Markdown** so structure survives the
  round trip: headings, bullet/ordered lists (nested), block quotes, fenced code
  blocks, horizontal rules, tables (GitHub-flavored) and the inline marks
  strong/em/code/strike/link. The tracker renders descriptions through a Markdown
  component, so this keeps JIRA descriptions readable instead of collapsing them
  into a single run-on paragraph. Unknown nodes degrade to their text content.
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
  Renders an ADF document to Markdown, joining block-level nodes with blank
  lines. A plain string is returned unchanged; `nil` becomes an empty string.
  """
  @spec to_text(adf() | String.t() | nil) :: String.t()
  def to_text(nil), do: ""
  def to_text(text) when is_binary(text), do: text

  def to_text(%{"content" => content}) when is_list(content), do: blocks(content)

  def to_text(node) when is_map(node), do: block(node)

  defp split_paragraphs(text) do
    text
    |> String.split(~r/\n{2,}/)
    |> Enum.reject(&(&1 == ""))
  end

  defp paragraph_node(paragraph) do
    %{"type" => "paragraph", "content" => [%{"type" => "text", "text" => paragraph}]}
  end

  # ── Block-level rendering ─────────────────────────────────────────────────

  defp blocks(content) when is_list(content) do
    content
    |> Enum.map(&block/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n\n")
  end

  defp block(%{"type" => "paragraph"} = node), do: inline(node)

  defp block(%{"type" => "heading"} = node) do
    level = node |> get_in(["attrs", "level"]) |> heading_level()
    String.duplicate("#", level) <> " " <> inline(node)
  end

  defp block(%{"type" => "bulletList", "content" => items}), do: render_list(items, :bullet, 0)
  defp block(%{"type" => "orderedList", "content" => items}), do: render_list(items, :ordered, 0)

  defp block(%{"type" => type, "content" => content})
       when type in ["blockquote", "panel"] and is_list(content) do
    content |> blocks() |> prefix_lines("> ")
  end

  defp block(%{"type" => "codeBlock"} = node) do
    language = node |> get_in(["attrs", "language"]) |> to_string()
    "```" <> language <> "\n" <> plain_text(node) <> "\n```"
  end

  defp block(%{"type" => "rule"}), do: "---"

  defp block(%{"type" => "table", "content" => rows}) when is_list(rows), do: render_table(rows)

  defp block(%{"type" => type, "content" => content})
       when type in ["mediaSingle", "mediaGroup"] and is_list(content) do
    content
    |> Enum.map(&block/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  defp block(%{"type" => "media"} = node), do: media_text(node)

  defp block(%{"content" => content}) when is_list(content), do: blocks(content)

  defp block(node) when is_map(node), do: inline(node)

  # ── Lists ─────────────────────────────────────────────────────────────────

  defp render_list(items, kind, depth) when is_list(items) do
    items
    |> Enum.with_index(1)
    |> Enum.map(fn {item, index} -> render_list_item(item, kind, index, depth) end)
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  defp render_list_item(%{"content" => content}, kind, index, depth) when is_list(content) do
    {nested, leading} = Enum.split_with(content, &list_node?/1)

    text =
      leading
      |> Enum.map(&block/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.join("\n")

    indent = String.duplicate("  ", depth)
    line = indent <> marker(kind, index) <> " " <> text

    case nested_lists(nested, depth + 1) do
      "" -> line
      rendered -> line <> "\n" <> rendered
    end
  end

  defp render_list_item(_item, _kind, _index, _depth), do: ""

  defp nested_lists(nodes, depth) do
    nodes
    |> Enum.map(fn
      %{"type" => "bulletList", "content" => items} -> render_list(items, :bullet, depth)
      %{"type" => "orderedList", "content" => items} -> render_list(items, :ordered, depth)
      _ -> ""
    end)
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  defp list_node?(%{"type" => type}), do: type in ["bulletList", "orderedList"]
  defp list_node?(_node), do: false

  defp marker(:bullet, _index), do: "-"
  defp marker(:ordered, index), do: "#{index}."

  # ── Tables ──────────────────────────────────────────────────────────────────

  defp render_table(rows) do
    case Enum.map(rows, &row_cells/1) do
      [] ->
        ""

      [header | rest] ->
        separator = Enum.map(header, fn _ -> "---" end)

        [header, separator | rest]
        |> Enum.map_join("\n", fn cells -> "| " <> Enum.join(cells, " | ") <> " |" end)
    end
  end

  defp row_cells(%{"content" => cells}) when is_list(cells), do: Enum.map(cells, &cell_text/1)
  defp row_cells(_row), do: []

  defp cell_text(%{"content" => content}) when is_list(content) do
    content
    |> blocks()
    |> String.replace(~r/\s*\n\s*/, " ")
    |> String.replace("|", "\\|")
    |> String.trim()
  end

  defp cell_text(_cell), do: ""

  # ── Inline rendering ──────────────────────────────────────────────────────

  defp inline(%{"content" => content}) when is_list(content), do: Enum.map_join(content, "", &inline_node/1)
  defp inline(_node), do: ""

  defp inline_node(%{"type" => "text", "text" => text, "marks" => marks}) when is_binary(text),
    do: apply_marks(text, marks)

  defp inline_node(%{"type" => "text", "text" => text}) when is_binary(text), do: text

  defp inline_node(%{"type" => "hardBreak"}), do: "  \n"
  defp inline_node(%{"type" => "mention", "attrs" => %{"text" => text}}) when is_binary(text), do: text
  defp inline_node(%{"type" => "emoji", "attrs" => %{"text" => text}}) when is_binary(text), do: text
  defp inline_node(%{"type" => "emoji", "attrs" => %{"shortName" => name}}) when is_binary(name), do: name
  defp inline_node(%{"type" => "inlineCard", "attrs" => %{"url" => url}}) when is_binary(url), do: url
  defp inline_node(%{"type" => "media"} = node), do: media_text(node)
  defp inline_node(%{"content" => content}) when is_list(content), do: Enum.map_join(content, "", &inline_node/1)
  defp inline_node(_node), do: ""

  defp apply_marks(text, marks) when is_list(marks), do: Enum.reduce(marks, text, &apply_mark/2)
  defp apply_marks(text, _marks), do: text

  defp apply_mark(%{"type" => "code"}, text), do: "`" <> text <> "`"
  defp apply_mark(%{"type" => "strong"}, text), do: "**" <> text <> "**"
  defp apply_mark(%{"type" => "em"}, text), do: "*" <> text <> "*"
  defp apply_mark(%{"type" => "strike"}, text), do: "~~" <> text <> "~~"

  defp apply_mark(%{"type" => "link", "attrs" => %{"href" => href}}, text) when is_binary(href),
    do: "[" <> text <> "](" <> href <> ")"

  defp apply_mark(_mark, text), do: text

  defp media_text(%{"attrs" => %{"alt" => alt}}) when is_binary(alt) and alt != "", do: alt
  defp media_text(_node), do: ""

  # ── Helpers ───────────────────────────────────────────────────────────────

  defp plain_text(%{"content" => content}) when is_list(content), do: Enum.map_join(content, "", &plain_text/1)
  defp plain_text(%{"text" => text}) when is_binary(text), do: text
  defp plain_text(_node), do: ""

  defp prefix_lines(text, prefix) do
    text
    |> String.split("\n")
    |> Enum.map_join("\n", fn line -> prefix <> line end)
  end

  defp heading_level(level) when is_integer(level) and level >= 1 and level <= 6, do: level
  defp heading_level(_level), do: 1

  defp empty_doc, do: %{"type" => "doc", "version" => @doc_version, "content" => []}
end
