defmodule SymphonyElixirWeb.Tracker.KnowledgeBaseController do
  @moduledoc "Read-only knowledge base endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.KnowledgeBase
  alias SymphonyElixirWeb.TrackerErrors

  @spec project_overview(Conn.t(), map()) :: Conn.t()
  def project_overview(conn, %{"project_slug" => project_slug}) do
    case KnowledgeBase.project_overview(project_slug) do
      {:ok, overview} -> json(conn, %{data: overview})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec repo_tree(Conn.t(), map()) :: Conn.t()
  def repo_tree(conn, %{"project_slug" => project_slug, "repo" => repo_slug}) do
    case KnowledgeBase.repo_tree(project_slug, repo_slug) do
      {:ok, tree} -> json(conn, %{data: tree})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec show_page(Conn.t(), map()) :: Conn.t()
  def show_page(conn, %{"project_slug" => project_slug, "repo" => repo_slug, "path" => path}) do
    case KnowledgeBase.read_page(project_slug, repo_slug, path) do
      {:ok, page} -> json(conn, %{data: page})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec save_page(Conn.t(), map()) :: Conn.t()
  def save_page(conn, %{"project_slug" => slug, "repo" => repo, "path" => path} = params) do
    page = %{
      frontmatter: Map.get(params, "frontmatter", %{}) || %{},
      body: to_string(Map.get(params, "body", ""))
    }

    case KnowledgeBase.write_page(slug, repo, path, page) do
      {:ok, result} -> json(conn, %{data: result})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec delete_page(Conn.t(), map()) :: Conn.t()
  def delete_page(conn, %{"project_slug" => slug, "repo" => repo, "path" => path}) do
    case KnowledgeBase.delete_page(slug, repo, path) do
      {:ok, result} -> json(conn, %{data: result})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec delete_folder(Conn.t(), map()) :: Conn.t()
  def delete_folder(conn, %{"project_slug" => slug, "repo" => repo, "path" => path}) do
    case KnowledgeBase.delete_folder(slug, repo, path) do
      {:ok, result} -> json(conn, %{data: result})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec move_page(Conn.t(), map()) :: Conn.t()
  def move_page(conn, %{"project_slug" => slug, "repo" => repo, "from" => from, "to" => to}) do
    case KnowledgeBase.move_page(slug, repo, String.split(from, "/"), String.split(to, "/")) do
      {:ok, result} -> json(conn, %{data: result})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def move_page(conn, _params), do: TrackerErrors.render(conn, :kb_invalid_path)

  @spec upload_asset(Conn.t(), map()) :: Conn.t()
  def upload_asset(
        conn,
        %{"project_slug" => slug, "repo" => repo, "file" => %Plug.Upload{} = upload} = params
      ) do
    with {:ok, bytes} <- File.read(upload.path),
         {:ok, result} <-
           KnowledgeBase.store_asset(slug, repo, upload.filename || "asset.png", bytes,
             page_path: params["page_path"],
             name: params["name"]
           ) do
      conn |> put_status(:created) |> json(%{data: result})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def upload_asset(conn, _params), do: TrackerErrors.render(conn, :kb_unsupported_asset)

  @spec rename_asset(Conn.t(), map()) :: Conn.t()
  def rename_asset(conn, %{"project_slug" => slug, "repo" => repo, "from" => from, "name" => name})
      when is_binary(from) and is_binary(name) do
    case KnowledgeBase.rename_asset(slug, repo, from, name) do
      {:ok, result} ->
        json(conn, %{data: %{from: result.from, asset_path: result.asset_path, pages: result.pages}})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def rename_asset(conn, _params), do: TrackerErrors.render(conn, :kb_invalid_path)

  @spec delete_asset(Conn.t(), map()) :: Conn.t()
  def delete_asset(conn, %{"project_slug" => slug, "repo" => repo, "path" => path}) do
    case KnowledgeBase.delete_asset(slug, repo, path) do
      {:ok, result} -> json(conn, %{data: result})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec show_asset(Conn.t(), map()) :: Conn.t()
  def show_asset(conn, %{"project_slug" => slug, "repo" => repo, "path" => path}) do
    case KnowledgeBase.read_asset(slug, repo, path) do
      {:ok, bytes, content_type} ->
        conn
        |> put_resp_content_type(content_type, asset_charset(content_type))
        |> put_resp_header("x-content-type-options", "nosniff")
        |> put_resp_header("cache-control", "private, max-age=300")
        |> send_resp(200, bytes)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp asset_charset("text/" <> _), do: "utf-8"
  defp asset_charset(_), do: nil

  @spec search_project(Conn.t(), map()) :: Conn.t()
  def search_project(conn, %{"project_slug" => slug} = params) do
    case KnowledgeBase.search_project(slug, Map.get(params, "q", ""), search_opts(params)) do
      {:ok, results} -> json(conn, %{data: Enum.map(results, &search_payload/1)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec search_general(Conn.t(), map()) :: Conn.t()
  def search_general(conn, params) do
    case KnowledgeBase.search_general(Map.get(params, "q", ""), search_opts(params)) do
      {:ok, results} -> json(conn, %{data: Enum.map(results, &search_payload/1)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp search_opts(params) do
    []
    |> maybe_put(:repo_slug, normalize_repo_filter(params["repo"]))
    |> maybe_put(:limit, parse_limit(params["limit"]))
  end

  # `repo` in the URL is already the per-project repo slug stored in the index
  # (e.g. "web" or "services~api"), so it is used as the filter verbatim.
  defp normalize_repo_filter(repo) when is_binary(repo) and repo != "", do: repo
  defp normalize_repo_filter(_), do: nil

  defp parse_limit(nil), do: nil

  defp parse_limit(value) do
    case Integer.parse(to_string(value)) do
      {n, _} when n > 0 -> n
      _ -> nil
    end
  end

  defp maybe_put(opts, _key, nil), do: opts
  defp maybe_put(opts, key, value), do: Keyword.put(opts, key, value)

  defp search_payload(result) do
    %{
      project_slug: result.project_slug,
      repo_slug: result.repo_slug,
      path: result.path,
      title: result.title,
      snippet: result.snippet,
      rank: result.rank
    }
  end

  @spec general_connect(Conn.t(), map()) :: Conn.t()
  def general_connect(conn, _params) do
    with {:ok, _ws} <- KnowledgeBase.general_connect(),
         {:ok, _home} <- KnowledgeBase.general_ensure_home() do
      json(conn, %{data: %{connected: true}})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec general_overview(Conn.t(), map()) :: Conn.t()
  def general_overview(conn, _params) do
    case KnowledgeBase.general_overview() do
      {:ok, overview} -> json(conn, %{data: overview})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec general_show_page(Conn.t(), map()) :: Conn.t()
  def general_show_page(conn, %{"path" => path}) do
    case KnowledgeBase.general_read_page(join_path(path)) do
      {:ok, page} -> json(conn, %{data: page})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec general_save_page(Conn.t(), map()) :: Conn.t()
  def general_save_page(conn, %{"path" => path} = params) do
    page = %{
      frontmatter: Map.get(params, "frontmatter", %{}) || %{},
      body: to_string(Map.get(params, "body", ""))
    }

    case KnowledgeBase.general_write_page(join_path(path), page) do
      {:ok, result} -> json(conn, %{data: result})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec general_regenerate_home(Conn.t(), map()) :: Conn.t()
  def general_regenerate_home(conn, _params) do
    case KnowledgeBase.general_regenerate_home() do
      {:ok, result} -> json(conn, %{data: result})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp join_path(path) when is_list(path), do: Enum.join(path, "/")
  defp join_path(path) when is_binary(path), do: path

  @spec sync_status(Conn.t(), map()) :: Conn.t()
  def sync_status(conn, %{"project_slug" => slug, "repo" => repo}) do
    case KnowledgeBase.sync_status(slug, repo) do
      {:ok, status} -> json(conn, %{data: status})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec request_sync(Conn.t(), map()) :: Conn.t()
  def request_sync(conn, %{"project_slug" => slug, "repo" => repo}) do
    _ = KnowledgeBase.request_sync(slug, repo)
    conn |> put_status(:accepted) |> json(%{data: %{accepted: true}})
  end
end
