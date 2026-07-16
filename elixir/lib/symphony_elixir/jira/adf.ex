defmodule SymphonyElixir.Jira.Adf do
  @moduledoc """
  Conversion between Markdown/plain text and Atlassian Document Format (ADF).

  JIRA Cloud REST API v3 represents `description` and comment bodies as an ADF
  JSON tree rather than plain strings. Symphony stores Markdown, so writes parse
  Markdown into structured ADF nodes (headings, lists, code blocks, marks, etc.).

  Reads (`to_text/1`) render the tree back to **Markdown** so structure survives the
  round trip: headings, bullet/ordered lists (nested), block quotes, fenced code
  blocks, horizontal rules, tables (GitHub-flavored) and the inline marks
  strong/em/code/strike/link. The tracker renders descriptions through a Markdown
  component, so this keeps JIRA descriptions readable instead of collapsing them
  into a single run-on paragraph. Unknown nodes degrade to their text content.
  """

  @doc_version 1

  @type adf :: %{required(String.t()) => term()}

  @doc """
  Parses Markdown (or plain text) into an ADF document. Blank lines separate
  blocks. `nil` or empty input yields a doc with no content.
  """
  @spec from_text(String.t() | nil) :: adf()
  def from_text(nil), do: empty_doc()

  def from_text(text) when is_binary(text) do
    content =
      text
      |> String.replace("\r\n", "\n")
      |> String.replace("\r", "\n")
      |> String.split("\n")
      |> parse_blocks([])
      |> Enum.reverse()

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

  # ── Markdown → ADF (blocks) ───────────────────────────────────────────────

  defp parse_blocks([], acc), do: acc

  defp parse_blocks([line | rest], acc) do
    cond do
      String.trim(line) == "" ->
        parse_blocks(rest, acc)

      rule?(line) ->
        parse_blocks(rest, [%{"type" => "rule"} | acc])

      match = Regex.run(~r/^```([\w-]*)\s*$/, line) ->
        language = Enum.at(match, 1) || ""
        {code_lines, remaining} = take_until_fence(rest, [])
        code = code_lines |> Enum.reverse() |> Enum.join("\n")

        node = %{
          "type" => "codeBlock",
          "attrs" => %{"language" => language},
          "content" => if(code == "", do: [], else: [%{"type" => "text", "text" => code}])
        }

        parse_blocks(remaining, [node | acc])

      heading = heading_line(line) ->
        {level, text} = heading
        node = %{"type" => "heading", "attrs" => %{"level" => level}, "content" => parse_inline(text)}
        parse_blocks(rest, [node | acc])

      quote_line?(line) ->
        {quote_lines, remaining} = take_while_quote([line | rest], [])
        inner =
          quote_lines
          |> Enum.map(&strip_quote_prefix/1)
          |> parse_blocks([])
          |> Enum.reverse()

        parse_blocks(remaining, [%{"type" => "blockquote", "content" => inner} | acc])

      table_start?(line, rest) ->
        {rows, remaining} = take_table_rows([line | rest], [])
        cells_rows = Enum.map(rows, &table_row_cells/1)
        # Drop separator row (second physical row when present as --- cells)
        data_rows =
          case cells_rows do
            [header, _separator | body] -> [header | body]
            other -> other
          end

        table_rows =
          Enum.map(data_rows, fn cells ->
            %{
              "type" => "tableRow",
              "content" =>
                Enum.map(cells, fn cell ->
                  %{
                    "type" => "tableCell",
                    "content" => [%{"type" => "paragraph", "content" => parse_inline(cell)}]
                  }
                end)
            }
          end)

        parse_blocks(remaining, [%{"type" => "table", "content" => table_rows} | acc])

      list_line?(line) ->
        {items, remaining, kind} = take_list([line | rest], [])
        list_type = if kind == :ordered, do: "orderedList", else: "bulletList"
        parse_blocks(remaining, [%{"type" => list_type, "content" => build_list_items(items)} | acc])

      true ->
        {para_lines, remaining} = take_paragraph([line | rest], [])
        text = join_paragraph_lines(Enum.reverse(para_lines))
        parse_blocks(remaining, [%{"type" => "paragraph", "content" => parse_inline(text)} | acc])
    end
  end

  defp rule?(line), do: String.trim(line) == "---"

  defp heading_line(line) do
    case Regex.run(~r/^([#]{1,6})\s+(.+)$/, line) do
      [_, hashes, text] -> {String.length(hashes), String.trim(text)}
      _ -> nil
    end
  end

  defp quote_line?(line), do: String.match?(line, ~r/^>\s?/)

  defp strip_quote_prefix(line) do
    case Regex.run(~r/^>\s?(.*)$/, line) do
      [_, rest] -> rest
      _ -> line
    end
  end

  defp take_while_quote([], acc), do: {Enum.reverse(acc), []}

  defp take_while_quote([line | rest], acc) do
    if quote_line?(line) do
      take_while_quote(rest, [line | acc])
    else
      {Enum.reverse(acc), [line | rest]}
    end
  end

  defp take_until_fence([], acc), do: {acc, []}

  defp take_until_fence([line | rest], acc) do
    if String.trim(line) == "```" do
      {acc, rest}
    else
      take_until_fence(rest, [line | acc])
    end
  end

  defp table_row?(line), do: String.match?(String.trim(line), ~r/^\|.*\|$/)

  defp table_start?(line, [separator | _rest]), do: table_row?(line) and table_separator?(separator)
  defp table_start?(_line, _rest), do: false

  defp table_separator?(line) do
    trimmed = String.trim(line)
    String.match?(trimmed, ~r/^\|[\s:\-|]+\|$/) and String.contains?(trimmed, "-")
  end

  defp take_table_rows([], acc), do: {Enum.reverse(acc), []}

  defp take_table_rows([line | rest], acc) do
    if table_row?(line) do
      take_table_rows(rest, [line | acc])
    else
      {Enum.reverse(acc), [line | rest]}
    end
  end

  defp table_row_cells(line) do
    line
    |> String.trim()
    |> String.trim_leading("|")
    |> String.trim_trailing("|")
    |> String.split("|")
    |> Enum.map(&String.trim/1)
  end

  defp list_line?(line) do
    case list_match(line) do
      nil -> false
      _ -> true
    end
  end

  defp list_match(line) do
    cond do
      match = Regex.run(~r/^(\s*)[-*]\s+(.*)$/, line) ->
        [_, indent, text] = match
        {div(String.length(indent), 2), :bullet, text}

      match = Regex.run(~r/^(\s*)\d+\.\s+(.*)$/, line) ->
        [_, indent, text] = match
        {div(String.length(indent), 2), :ordered, text}

      true ->
        nil
    end
  end

  defp take_list([], acc), do: finish_list(acc, [])

  defp take_list([line | rest], acc) do
    case list_match(line) do
      {depth, kind, text} ->
        take_list(rest, [{depth, kind, text} | acc])

      nil ->
        finish_list(acc, [line | rest])
    end
  end

  defp finish_list(acc, remaining) do
    items = Enum.reverse(acc)
    kind = items |> List.first() |> elem(1)
    {items, remaining, kind}
  end

  # Build nested listItem trees from flat {depth, kind, text} tuples.
  defp build_list_items(items) do
    items
    |> nest_list_items(0)
    |> elem(0)
  end

  defp nest_list_items([], _depth), do: {[], []}

  defp nest_list_items([{item_depth, kind, text} | rest] = all, depth) do
    cond do
      item_depth < depth ->
        {[], all}

      item_depth > depth ->
        # Caller should have consumed nested items; skip orphan deeper items by promoting.
        nest_list_items(all, item_depth)

      true ->
        {children, after_children} = take_nested_children(rest, depth, kind)

        content =
          case children do
            [] ->
              [%{"type" => "paragraph", "content" => parse_inline(text)}]

            nested ->
              [
                %{"type" => "paragraph", "content" => parse_inline(text)}
                | nested
              ]
          end

        item = %{"type" => "listItem", "content" => content}
        {siblings, remaining} = nest_list_items(after_children, depth)
        {[item | siblings], remaining}
    end
  end

  defp take_nested_children(rest, parent_depth, _parent_kind) do
    case rest do
      [{child_depth, child_kind, _} | _] when child_depth > parent_depth ->
        {nested_items, remaining} = nest_list_items(rest, child_depth)
        list_type = if child_kind == :ordered, do: "orderedList", else: "bulletList"
        {[%{"type" => list_type, "content" => nested_items}], remaining}

      _ ->
        {[], rest}
    end
  end

  defp take_paragraph([], acc), do: {acc, []}

  defp take_paragraph([line | rest], acc) do
    cond do
      String.trim(line) == "" ->
        {acc, rest}

      rule?(line) or heading_line(line) != nil or quote_line?(line) or list_line?(line) or
          String.match?(line, ~r/^```/) or table_start?(line, rest) ->
        {acc, [line | rest]}

      true ->
        take_paragraph(rest, [line | acc])
    end
  end

  defp join_paragraph_lines([]), do: ""

  defp join_paragraph_lines([first | rest]) do
    Enum.reduce(rest, first, fn line, acc ->
      if String.ends_with?(acc, "  ") do
        String.trim_trailing(acc, " ") <> "  \n" <> line
      else
        # Soft wrap: preserve a newline so "line one  \\nline two" round-trips
        # when the source was split on "\\n" before joining.
        acc <> "\n" <> line
      end
    end)
  end

  # ── Markdown → ADF (inline) ───────────────────────────────────────────────

  defp parse_inline(text) when is_binary(text) do
    text
    |> split_hard_breaks()
    |> Enum.flat_map(fn
      :hard_break -> [%{"type" => "hardBreak"}]
      segment when is_binary(segment) -> parse_inline_segment(segment, [])
    end)
  end

  defp split_hard_breaks(text) do
    text
    |> String.split("  \n")
    |> Enum.intersperse(:hard_break)
    |> Enum.reject(&(&1 == ""))
  end

  defp parse_inline_segment("", acc), do: Enum.reverse(acc)

  defp parse_inline_segment(text, acc) do
    patterns = [
      {~r/^`([^`]+)`/, fn [_, code] -> text_node(code, [%{"type" => "code"}]) end},
      {~r/^\[([^\]]+)\]\(([^)]+)\)/,
       fn [_, label, href] -> text_node(label, [%{"type" => "link", "attrs" => %{"href" => href}}]) end},
      {~r/^\*\*(.+?)\*\*/, fn [_, inner] -> text_node(inner, [%{"type" => "strong"}]) end},
      {~r/^~~(.+?)~~/, fn [_, inner] -> text_node(inner, [%{"type" => "strike"}]) end},
      {~r/^\*(.+?)\*/, fn [_, inner] -> text_node(inner, [%{"type" => "em"}]) end}
    ]

    case first_match(text, patterns) do
      {node, rest} ->
        parse_inline_segment(rest, [node | acc])

      nil ->
        {plain, rest} = take_plain(text)
        parse_inline_segment(rest, [text_node(plain, []) | acc])
    end
  end

  defp first_match(text, patterns) do
    Enum.find_value(patterns, fn {regex, builder} ->
      case Regex.run(regex, text) do
        nil ->
          nil

        match ->
          full = hd(match)
          {builder.(match), String.slice(text, String.length(full)..-1//1)}
      end
    end)
  end

  defp take_plain(text) do
    case Regex.run(~r/^(.[^`*~\[]*)/, text) do
      [_, plain] ->
        # Ensure we always consume at least one character to avoid infinite loops
        # on special characters that failed to match a mark pattern.
        if plain == "" do
          {String.slice(text, 0, 1), String.slice(text, 1..-1//1)}
        else
          {plain, String.slice(text, String.length(plain)..-1//1)}
        end

      nil ->
        {String.slice(text, 0, 1), String.slice(text, 1..-1//1)}
    end
  end

  defp text_node(text, []), do: %{"type" => "text", "text" => text}
  defp text_node(text, marks), do: %{"type" => "text", "text" => text, "marks" => marks}

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
