defmodule SymphonyElixirWeb.Tracker.NotionController do
  @moduledoc """
  Tracker HTTP endpoints for importing Notion pages/databases and reading
  temporary import previews from `/tmp/symphony-notion/<import_id>/`.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Notion.Importer
  alias SymphonyElixirWeb.TrackerErrors

  @spec import(Conn.t(), map()) :: Conn.t()
  def import(conn, %{"url" => url}) when is_binary(url) do
    case Importer.import_url(url) do
      {:ok, data} ->
        json(conn, %{data: stringify_keys(data)})

      {:error, :missing_api_key} ->
        TrackerErrors.validation_msg(
          conn,
          "Notion API key is not configured. Set it in Settings → Providers → Notion, or NOTION_API_KEY."
        )

      {:error, :invalid_notion_url} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: %{code: "invalid_notion_url", message: "Invalid Notion URL"}})

      {:error, :forbidden} ->
        TrackerErrors.validation_msg(
          conn,
          "Notion returned 403 Forbidden. Share the page/database with the Integration and check the token."
        )

      {:error, reason} ->
        TrackerErrors.validation_msg(conn, "Notion import failed: #{inspect(reason)}")
    end
  end

  def import(conn, _params) do
    TrackerErrors.validation_msg(conn, "url is required")
  end

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"import_id" => import_id}) when is_binary(import_id) do
    with :ok <- validate_import_id(import_id),
         {:ok, payload} <- read_import(import_id) do
      json(conn, %{data: payload})
    else
      {:error, :invalid_import_id} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: %{code: "invalid_import_id", message: "Invalid Notion import id"}})

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: %{code: "notion_import_not_found", message: "Notion import not found"}})
    end
  end

  def show(conn, _params) do
    TrackerErrors.validation_msg(conn, "import_id is required")
  end

  defp validate_import_id(import_id) do
    cond do
      String.contains?(import_id, "..") -> {:error, :invalid_import_id}
      String.contains?(import_id, "/") -> {:error, :invalid_import_id}
      String.contains?(import_id, "\\") -> {:error, :invalid_import_id}
      match?({:ok, _}, Ecto.UUID.cast(import_id)) -> :ok
      true -> {:error, :invalid_import_id}
    end
  end

  defp read_import(import_id) do
    root = import_root(import_id)
    meta_path = Path.join(root, "meta.json")
    markdown_path = Path.join(root, "page.md")
    assets_dir = Path.join(root, "assets")

    with true <- File.dir?(root) || {:error, :not_found},
         {:ok, meta_raw} <- File.read(meta_path),
         {:ok, meta} <- Jason.decode(meta_raw),
         {:ok, markdown} <- File.read(markdown_path) do
      assets =
        case File.ls(assets_dir) do
          {:ok, names} -> Enum.sort(names)
          {:error, _} -> []
        end

      {:ok, %{meta: meta, markdown: markdown, assets: assets}}
    else
      {:error, :enoent} -> {:error, :not_found}
      {:error, %Jason.DecodeError{}} -> {:error, :not_found}
      {:error, :not_found} -> {:error, :not_found}
      false -> {:error, :not_found}
      _ -> {:error, :not_found}
    end
  end

  defp import_root(import_id) do
    System.tmp_dir!()
    |> Path.join("symphony-notion")
    |> Path.join(import_id)
  end

  defp stringify_keys(map) when is_map(map) do
    Map.new(map, fn
      {key, value} when is_atom(key) -> {Atom.to_string(key), stringify_keys(value)}
      {key, value} -> {key, stringify_keys(value)}
    end)
  end

  defp stringify_keys(list) when is_list(list), do: Enum.map(list, &stringify_keys/1)
  defp stringify_keys(other), do: other
end
