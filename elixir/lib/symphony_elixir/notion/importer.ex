defmodule SymphonyElixir.Notion.Importer do
  @moduledoc """
  Imports a Notion page or database URL into a local `/tmp` markdown tree.
  """

  alias SymphonyElixir.Notion.{Client, Config, Markdown, Url}

  @preview_bytes 2048
  @truncated_warning "Database import truncated to 100 rows"

  @spec import_url(String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def import_url(url, opts \\ []) when is_binary(url) and is_list(opts) do
    with {:ok, api_key} <- resolve_api_key(opts),
         {:ok, %{id: path_id, focused_page_id: focused_page_id}} <- Url.parse(url) do
      client_opts = client_opts(api_key, opts)

      case focused_page_id do
        focused when is_binary(focused) ->
          import_page(focused, url, client_opts)

        nil ->
          import_page_or_database(path_id, url, client_opts)
      end
    end
  end

  defp import_page_or_database(id, source_url, client_opts) do
    case Client.retrieve_page(id, client_opts) do
      {:ok, page} ->
        write_page_import(page, id, source_url, client_opts)

      {:error, :not_found} ->
        case Client.retrieve_database(id, client_opts) do
          {:ok, database} ->
            write_database_import(database, id, source_url, client_opts)

          {:error, reason} ->
            {:error, reason}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp import_page(page_id, source_url, client_opts) do
    case Client.retrieve_page(page_id, client_opts) do
      {:ok, page} ->
        write_page_import(page, page_id, source_url, client_opts)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp write_page_import(page, notion_id, source_url, client_opts) do
    title = page_title(page)

    with {:ok, blocks} <- Client.list_block_children(notion_id, client_opts) do
      {markdown, assets} = Markdown.from_blocks(blocks, title)
      warnings = []

      finalize_import(%{
        kind: "page",
        title: title,
        notion_id: notion_id,
        source_url: source_url,
        markdown: markdown,
        assets: assets,
        warnings: warnings,
        client_opts: client_opts
      })
    end
  end

  defp write_database_import(database, notion_id, source_url, client_opts) do
    title = database_title(database)

    with {:ok, %{results: rows, truncated: truncated}} <-
           Client.query_database(notion_id, client_opts) do
      schema = properties_schema(database, rows)
      markdown = Markdown.from_database(title, schema, rows)
      warnings = if truncated, do: [@truncated_warning], else: []

      finalize_import(%{
        kind: "database",
        title: title,
        notion_id: notion_id,
        source_url: source_url,
        markdown: markdown,
        assets: [],
        warnings: warnings,
        client_opts: client_opts
      })
    end
  end

  defp finalize_import(%{
         kind: kind,
         title: title,
         notion_id: notion_id,
         source_url: source_url,
         markdown: markdown,
         assets: assets,
         warnings: warnings,
         client_opts: client_opts
       }) do
    import_id = Ecto.UUID.generate()
    root = import_root(import_id)
    assets_dir = Path.join(root, "assets")
    markdown_path = Path.join(root, "page.md")
    meta_path = Path.join(root, "meta.json")

    with :ok <- File.mkdir_p(assets_dir),
         {:ok, asset_count} <- download_assets(assets, assets_dir, client_opts),
         :ok <- File.write(markdown_path, markdown),
         :ok <-
           write_meta(meta_path, %{
             source_url: source_url,
             notion_id: notion_id,
             kind: kind,
             title: title,
             imported_at: DateTime.utc_now() |> DateTime.to_iso8601(),
             asset_count: asset_count,
             warnings: warnings
           }) do
      {:ok,
       %{
         import_id: import_id,
         title: title,
         kind: kind,
         source_url: source_url,
         markdown_path: markdown_path,
         assets_dir: assets_dir,
         meta_path: meta_path,
         asset_count: asset_count,
         warnings: warnings,
         preview_markdown: String.slice(markdown, 0, @preview_bytes)
       }}
    end
  end

  defp download_assets(assets, assets_dir, client_opts) when is_list(assets) do
    assets_expanded = Path.expand(assets_dir)

    Enum.reduce_while(assets, {:ok, 0}, fn asset, {:ok, count} ->
      case download_one_asset(asset, assets_dir, assets_expanded, client_opts) do
        :ok -> {:cont, {:ok, count + 1}}
        {:error, reason} -> {:halt, {:error, reason}}
        :skip -> {:cont, {:ok, count}}
      end
    end)
  end

  defp download_one_asset(%{url: url, filename: filename}, assets_dir, assets_expanded, client_opts)
       when is_binary(url) and is_binary(filename) do
    dest = Path.expand(filename, assets_dir)

    if safe_under_dir?(dest, assets_expanded) do
      case Client.download(url, client_opts) do
        {:ok, body} -> File.write(dest, body)
        {:error, reason} -> {:error, reason}
      end
    else
      :skip
    end
  end

  defp download_one_asset(_, _, _, _), do: :skip

  defp safe_under_dir?(path, parent) when is_binary(path) and is_binary(parent) do
    parent_prefix = String.trim_trailing(parent, "/") <> "/"
    String.starts_with?(path, parent_prefix)
  end

  defp write_meta(path, meta) when is_binary(path) and is_map(meta) do
    case Jason.encode(meta, pretty: true) do
      {:ok, json} -> File.write(path, json)
      {:error, reason} -> {:error, reason}
    end
  end

  defp import_root(import_id) when is_binary(import_id) do
    System.tmp_dir!()
    |> Path.join("symphony-notion")
    |> Path.join(import_id)
  end

  defp client_opts(api_key, opts) do
    [api_key: api_key]
    |> maybe_put(:http, Keyword.get(opts, :http))
  end

  defp maybe_put(opts, _key, nil), do: opts
  defp maybe_put(opts, key, value), do: Keyword.put(opts, key, value)

  defp resolve_api_key(opts) do
    case Keyword.fetch(opts, :api_key) do
      {:ok, key} -> normalize_api_key(key)
      :error -> normalize_api_key(Config.api_key())
    end
  end

  defp normalize_api_key(key) when is_binary(key) do
    case String.trim(key) do
      "" -> {:error, :missing_api_key}
      trimmed -> {:ok, trimmed}
    end
  end

  defp normalize_api_key(_), do: {:error, :missing_api_key}

  defp page_title(%{"properties" => properties}) when is_map(properties) do
    Enum.find_value(properties, "Untitled", fn {_name, prop} ->
      case prop do
        %{"type" => "title", "title" => items} when is_list(items) ->
          case rich_plain_text(items) do
            "" -> nil
            text -> text
          end

        _ ->
          nil
      end
    end)
  end

  defp page_title(_), do: "Untitled"

  defp database_title(%{"title" => items}) when is_list(items) do
    case rich_plain_text(items) do
      "" -> "Untitled"
      text -> text
    end
  end

  defp database_title(_), do: "Untitled"

  defp rich_plain_text(items) when is_list(items) do
    Enum.map_join(items, "", fn
      %{"plain_text" => text} when is_binary(text) -> text
      _ -> ""
    end)
  end

  defp properties_schema(%{"properties" => props}, _rows) when is_map(props) and map_size(props) > 0 do
    Enum.map(props, fn
      {name, %{"type" => type}} when is_binary(name) and is_binary(type) -> {name, type}
      {name, _} when is_binary(name) -> {name, "rich_text"}
    end)
  end

  defp properties_schema(_database, [first | _]) when is_map(first) do
    props = Map.get(first, "properties") || %{}

    Enum.map(props, fn
      {name, %{"type" => type}} when is_binary(name) and is_binary(type) -> {name, type}
      {name, _} when is_binary(name) -> {name, "rich_text"}
    end)
  end

  defp properties_schema(_, _), do: []
end
