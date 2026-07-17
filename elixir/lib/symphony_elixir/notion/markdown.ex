defmodule SymphonyElixir.Notion.Markdown do
  @moduledoc false

  @spec from_blocks([map()], String.t()) :: {String.t(), [map()]}
  def from_blocks(blocks, title) when is_list(blocks) and is_binary(title) do
    {body_parts, assets} =
      Enum.reduce(blocks, {[], []}, fn block, {parts_acc, assets_acc} ->
        {part, new_assets} = render_block(block)
        {[part | parts_acc], assets_acc ++ new_assets}
      end)

    body =
      body_parts
      |> Enum.reverse()
      |> Enum.reject(&(&1 == ""))
      |> Enum.join("\n\n")

    md =
      case body do
        "" -> "# #{title}\n"
        content -> "# #{title}\n\n#{content}\n"
      end

    {md, assets}
  end

  def from_blocks(_, _), do: raise(ArgumentError, "from_blocks/2 expects a list of blocks and a title string")

  @spec from_database(String.t(), [{String.t(), String.t()}], [map()]) :: String.t()
  def from_database(title, properties_schema, rows)
      when is_binary(title) and is_list(properties_schema) and is_list(rows) do
    headers = Enum.map(properties_schema, fn {name, _type} -> name end)
    header_row = table_row(headers)
    separator_row = table_row(Enum.map(headers, fn _ -> "---" end))

    data_rows =
      Enum.map(rows, fn row ->
        props = Map.get(row, "properties") || %{}

        cells =
          Enum.map(properties_schema, fn {name, _type} ->
            props
            |> Map.get(name)
            |> stringify_property()
            |> escape_table_cell()
          end)

        table_row(cells)
      end)

    ([header_row, separator_row] ++ data_rows)
    |> then(fn lines -> "# #{title}\n\n" <> Enum.join(lines, "\n") <> "\n" end)
  end

  def from_database(_, _, _),
    do: raise(ArgumentError, "from_database/3 expects title, property schema list, and rows list")

  defp render_block(%{"type" => type} = block) when is_binary(type) do
    payload = Map.get(block, type) || %{}
    block_id = Map.get(block, "id")

    case type do
      "heading_1" ->
        {"# #{rich_text(payload)}", []}

      "heading_2" ->
        {"## #{rich_text(payload)}", []}

      "heading_3" ->
        {"### #{rich_text(payload)}", []}

      "paragraph" ->
        {rich_text(payload), []}

      "bulleted_list_item" ->
        {"- #{rich_text(payload)}", []}

      "numbered_list_item" ->
        {"1. #{rich_text(payload)}", []}

      "to_do" ->
        checked = Map.get(payload, "checked") == true
        marker = if checked, do: "- [x]", else: "- [ ]"
        {"#{marker} #{rich_text(payload)}", []}

      "quote" ->
        text = rich_text(payload)

        quoted =
          text
          |> String.split("\n")
          |> Enum.map_join("\n", &("> " <> &1))

        {quoted, []}

      "divider" ->
        {"---", []}

      "code" ->
        language = payload |> Map.get("language") |> normalize_language()
        content = plain_text(Map.get(payload, "rich_text") || [])
        {"```#{language}\n#{content}\n```", []}

      "image" ->
        render_media(payload, block_id, :image)

      "file" ->
        render_media(payload, block_id, :file)

      "bookmark" ->
        url = Map.get(payload, "url") || ""
        caption = rich_text(%{"rich_text" => Map.get(payload, "caption") || []})
        label = if caption == "", do: url, else: caption
        {"[#{label}](#{url})", []}

      "child_page" ->
        child_title = Map.get(payload, "title") || "Untitled"
        {"[#{child_title}](notion://child_page)", []}

      "child_database" ->
        child_title = Map.get(payload, "title") || "Untitled"
        {"[#{child_title}](notion://child_database)", []}

      "link_to_page" ->
        {"[Linked page](notion://link_to_page)", []}

      _ ->
        {"<!-- unsupported notion block: #{type} -->", []}
    end
  end

  defp render_block(_), do: {"<!-- unsupported notion block: unknown -->", []}

  defp render_media(payload, block_id, kind) when is_map(payload) do
    case media_url(payload) do
      nil ->
        {"<!-- unsupported notion block: #{kind} -->", []}

      url ->
        filename = asset_filename(url, block_id, kind)
        asset = %{url: url, filename: filename, block_id: block_id}

        md =
          case kind do
            :image -> "![](./assets/#{filename})"
            :file -> "[#{filename}](./assets/#{filename})"
          end

        {md, [asset]}
    end
  end

  defp media_url(%{"type" => "external", "external" => %{"url" => url}}) when is_binary(url), do: url
  defp media_url(%{"type" => "file", "file" => %{"url" => url}}) when is_binary(url), do: url
  defp media_url(%{"external" => %{"url" => url}}) when is_binary(url), do: url
  defp media_url(%{"file" => %{"url" => url}}) when is_binary(url), do: url
  defp media_url(_), do: nil

  defp asset_filename(url, block_id, kind) when is_binary(url) do
    path =
      case URI.parse(url) do
        %URI{path: path} when is_binary(path) and path != "" -> path
        _ -> ""
      end

    basename =
      path
      |> Path.basename()
      |> String.split("?")
      |> List.first()
      |> sanitize_filename()

    case basename do
      name when is_binary(name) and name != "" and name != "." ->
        name

      _ ->
        ext = default_ext(kind, path)
        id = if is_binary(block_id) and block_id != "", do: block_id, else: "unknown"
        sanitize_filename("block-#{id}#{ext}")
    end
  end

  defp default_ext(:image, path) do
    case Path.extname(path) do
      "" -> ".png"
      ext -> ext
    end
  end

  defp default_ext(:file, path) do
    case Path.extname(path) do
      "" -> ".bin"
      ext -> ext
    end
  end

  defp sanitize_filename(name) when is_binary(name) do
    name
    |> String.replace(~r/[^A-Za-z0-9._-]+/, "-")
    |> String.trim("-")
    |> case do
      "" -> "asset"
      cleaned -> cleaned
    end
  end

  defp sanitize_filename(_), do: "asset"

  defp rich_text(%{"rich_text" => items}) when is_list(items), do: render_rich_text(items)
  defp rich_text(_), do: ""

  defp render_rich_text(items) do
    Enum.map_join(items, "", &render_rich_text_item/1)
  end

  defp render_rich_text_item(%{"plain_text" => text} = item) when is_binary(text) do
    annotations = Map.get(item, "annotations") || %{}
    href = Map.get(item, "href")
    code? = Map.get(annotations, "code") == true

    formatted =
      if code? do
        "`#{text}`"
      else
        text
        |> maybe_wrap(Map.get(annotations, "bold") == true, "**", "**")
        |> maybe_wrap(Map.get(annotations, "italic") == true, "*", "*")
        |> maybe_wrap(Map.get(annotations, "strikethrough") == true, "~~", "~~")
      end

    if is_binary(href) and href != "" do
      "[#{formatted}](#{href})"
    else
      formatted
    end
  end

  defp render_rich_text_item(_), do: ""

  defp maybe_wrap(text, true, left, right), do: left <> text <> right
  defp maybe_wrap(text, _, _, _), do: text

  defp plain_text(items) when is_list(items) do
    Enum.map_join(items, "", fn
      %{"plain_text" => text} when is_binary(text) -> text
      _ -> ""
    end)
  end

  defp plain_text(_), do: ""

  defp normalize_language(lang) when is_binary(lang) and lang != "", do: lang
  defp normalize_language(_), do: ""

  defp table_row(cells) when is_list(cells) do
    "| " <> Enum.join(cells, " | ") <> " |"
  end

  defp escape_table_cell(value) when is_binary(value), do: String.replace(value, "|", "\\|")
  defp escape_table_cell(_), do: ""

  defp stringify_property(nil), do: ""

  defp stringify_property(%{"type" => type} = prop) when is_binary(type) do
    case type do
      "title" ->
        plain_text(Map.get(prop, "title") || [])

      "rich_text" ->
        plain_text(Map.get(prop, "rich_text") || [])

      "select" ->
        case Map.get(prop, "select") do
          %{"name" => name} when is_binary(name) -> name
          _ -> ""
        end

      "status" ->
        case Map.get(prop, "status") do
          %{"name" => name} when is_binary(name) -> name
          _ -> ""
        end

      "multi_select" ->
        (Map.get(prop, "multi_select") || [])
        |> Enum.map(fn
          %{"name" => name} when is_binary(name) -> name
          _ -> nil
        end)
        |> Enum.reject(&is_nil/1)
        |> Enum.join(", ")

      "number" ->
        case Map.get(prop, "number") do
          n when is_number(n) -> to_string(n)
          _ -> ""
        end

      "checkbox" ->
        if Map.get(prop, "checkbox") == true, do: "true", else: "false"

      "url" ->
        Map.get(prop, "url") || ""

      "email" ->
        Map.get(prop, "email") || ""

      "phone_number" ->
        Map.get(prop, "phone_number") || ""

      "date" ->
        stringify_date(Map.get(prop, "date"))

      "people" ->
        (Map.get(prop, "people") || [])
        |> Enum.map(&person_name/1)
        |> Enum.reject(&(&1 == ""))
        |> Enum.join(", ")

      "files" ->
        (Map.get(prop, "files") || [])
        |> Enum.map(&file_label/1)
        |> Enum.reject(&(&1 == ""))
        |> Enum.join(", ")

      "relation" ->
        (Map.get(prop, "relation") || [])
        |> Enum.map(fn
          %{"id" => id} when is_binary(id) -> id
          _ -> nil
        end)
        |> Enum.reject(&is_nil/1)
        |> Enum.join(", ")

      "formula" ->
        stringify_formula(Map.get(prop, "formula"))

      "created_time" ->
        Map.get(prop, "created_time") || ""

      "last_edited_time" ->
        Map.get(prop, "last_edited_time") || ""

      "created_by" ->
        person_name(Map.get(prop, "created_by"))

      "last_edited_by" ->
        person_name(Map.get(prop, "last_edited_by"))

      "unique_id" ->
        case Map.get(prop, "unique_id") do
          %{"prefix" => prefix, "number" => number}
          when is_binary(prefix) and not is_nil(number) ->
            "#{prefix}-#{number}"

          %{"number" => number} when not is_nil(number) ->
            to_string(number)

          _ ->
            ""
        end

      _ ->
        ""
    end
  end

  defp stringify_property(_), do: ""

  defp stringify_date(nil), do: ""

  defp stringify_date(%{"start" => start, "end" => finish})
       when is_binary(start) and is_binary(finish),
       do: "#{start} → #{finish}"

  defp stringify_date(%{"start" => start}) when is_binary(start), do: start
  defp stringify_date(_), do: ""

  defp stringify_formula(nil), do: ""

  defp stringify_formula(%{"type" => "string", "string" => value}) when is_binary(value), do: value
  defp stringify_formula(%{"type" => "number", "number" => value}) when is_number(value), do: to_string(value)
  defp stringify_formula(%{"type" => "boolean", "boolean" => value}) when is_boolean(value), do: to_string(value)
  defp stringify_formula(%{"type" => "date", "date" => date}), do: stringify_date(date)
  defp stringify_formula(%{"string" => value}) when is_binary(value), do: value
  defp stringify_formula(%{"number" => value}) when is_number(value), do: to_string(value)
  defp stringify_formula(%{"boolean" => value}) when is_boolean(value), do: to_string(value)
  defp stringify_formula(_), do: ""

  defp person_name(%{"name" => name}) when is_binary(name), do: name
  defp person_name(%{"id" => id}) when is_binary(id), do: id
  defp person_name(_), do: ""

  defp file_label(%{"name" => name}) when is_binary(name) and name != "", do: name

  defp file_label(%{"type" => "external", "external" => %{"url" => url}}) when is_binary(url), do: url
  defp file_label(%{"type" => "file", "file" => %{"url" => url}}) when is_binary(url), do: url
  defp file_label(%{"external" => %{"url" => url}}) when is_binary(url), do: url
  defp file_label(%{"file" => %{"url" => url}}) when is_binary(url), do: url
  defp file_label(_), do: ""
end
