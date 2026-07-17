defmodule SymphonyElixir.Notion.Client do
  @moduledoc """
  Thin Notion REST client.

  HTTP is performed with `Req` by default but can be injected via the `:http`
  option for tests: `fn method, url, opts -> {:ok, status, body} | {:error, term}`.
  """

  alias SymphonyElixir.Notion.Config

  @base_url "https://api.notion.com"
  @notion_version "2022-06-28"
  @max_block_pages 50
  @max_database_rows 100
  @request_timeout_ms 30_000

  @type http_fun :: (atom(), String.t(), keyword() -> {:ok, pos_integer(), term()} | {:error, term()})

  @doc """
  Retrieves a Notion page by id.
  """
  @spec retrieve_page(String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def retrieve_page(page_id, opts \\ []) when is_binary(page_id) and is_list(opts) do
    api_get("/v1/pages/#{page_id}", opts)
  end

  @doc """
  Retrieves a Notion database by id.
  """
  @spec retrieve_database(String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def retrieve_database(database_id, opts \\ []) when is_binary(database_id) and is_list(opts) do
    api_get("/v1/databases/#{database_id}", opts)
  end

  @doc """
  Lists all children of a block, paginating via `start_cursor` (max #{@max_block_pages} pages).
  """
  @spec list_block_children(String.t(), keyword()) :: {:ok, [map()]} | {:error, term()}
  def list_block_children(block_id, opts \\ []) when is_binary(block_id) and is_list(opts) do
    with {:ok, api_key} <- resolve_api_key(opts) do
      http = Keyword.get(opts, :http, &default_http/3)
      paginate_block_children(block_id, api_key, http, nil, [], 0)
    end
  end

  @doc """
  Queries a database, paginating until done or #{@max_database_rows} rows.

  Returns `{:ok, %{results: rows, truncated: boolean}}`.
  """
  @spec query_database(String.t(), keyword()) ::
          {:ok, %{results: [map()], truncated: boolean()}} | {:error, term()}
  def query_database(database_id, opts \\ []) when is_binary(database_id) and is_list(opts) do
    with {:ok, api_key} <- resolve_api_key(opts) do
      http = Keyword.get(opts, :http, &default_http/3)
      query_database_pages(database_id, api_key, http, nil, [])
    end
  end

  @doc """
  Downloads an arbitrary asset URL as a binary body.

  Does not send Notion-Version (signed CDN URLs are not Notion API endpoints).
  """
  @spec download(String.t(), keyword()) :: {:ok, binary()} | {:error, term()}
  def download(url, opts \\ []) when is_binary(url) and is_list(opts) do
    with {:ok, api_key} <- resolve_api_key(opts) do
      http = Keyword.get(opts, :http, &default_http/3)
      headers = [{"Authorization", "Bearer #{api_key}"}]

      case http.(:get, url, headers: headers, decode_body: false) do
        {:ok, 200, body} when is_binary(body) -> {:ok, body}
        {:ok, status, body} -> {:error, map_status_error(status, body)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp api_get(path, opts) do
    with {:ok, api_key} <- resolve_api_key(opts) do
      http = Keyword.get(opts, :http, &default_http/3)
      url = @base_url <> path

      case http.(:get, url, headers: api_headers(api_key)) do
        {:ok, 200, body} when is_map(body) -> {:ok, body}
        {:ok, status, body} -> {:error, map_status_error(status, body)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp paginate_block_children(_block_id, _api_key, _http, _cursor, acc, page)
       when page >= @max_block_pages do
    {:ok, acc}
  end

  defp paginate_block_children(block_id, api_key, http, cursor, acc, page) do
    url = block_children_url(block_id, cursor)

    case http.(:get, url, headers: api_headers(api_key)) do
      {:ok, 200, body} when is_map(body) ->
        results = Map.get(body, "results", [])
        next_acc = acc ++ results

        if body["has_more"] == true and is_binary(body["next_cursor"]) do
          paginate_block_children(
            block_id,
            api_key,
            http,
            body["next_cursor"],
            next_acc,
            page + 1
          )
        else
          {:ok, next_acc}
        end

      {:ok, status, body} ->
        {:error, map_status_error(status, body)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp block_children_url(block_id, nil) do
    "#{@base_url}/v1/blocks/#{block_id}/children"
  end

  defp block_children_url(block_id, cursor) when is_binary(cursor) do
    "#{@base_url}/v1/blocks/#{block_id}/children?start_cursor=#{URI.encode_www_form(cursor)}"
  end

  defp query_database_pages(database_id, api_key, http, cursor, acc) do
    url = "#{@base_url}/v1/databases/#{database_id}/query"
    remaining = @max_database_rows - length(acc)
    body = query_body(cursor)

    case http.(:post, url, headers: api_headers(api_key), json: body) do
      {:ok, 200, response} when is_map(response) ->
        page_results = Map.get(response, "results", [])
        taken = Enum.take(page_results, remaining)
        next_acc = acc ++ taken
        has_more = response["has_more"] == true
        next_cursor = response["next_cursor"]
        hit_cap = length(next_acc) >= @max_database_rows
        more_available = has_more or length(page_results) > length(taken)

        cond do
          hit_cap ->
            {:ok, %{results: next_acc, truncated: more_available}}

          has_more and is_binary(next_cursor) ->
            query_database_pages(database_id, api_key, http, next_cursor, next_acc)

          true ->
            {:ok, %{results: next_acc, truncated: false}}
        end

      {:ok, status, response} ->
        {:error, map_status_error(status, response)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp query_body(nil), do: %{}
  defp query_body(cursor) when is_binary(cursor), do: %{"start_cursor" => cursor}

  defp resolve_api_key(opts) do
    case Keyword.fetch(opts, :api_key) do
      {:ok, key} ->
        normalize_api_key(key)

      :error ->
        normalize_api_key(Config.api_key())
    end
  end

  defp normalize_api_key(key) when is_binary(key) do
    case String.trim(key) do
      "" -> {:error, :missing_api_key}
      trimmed -> {:ok, trimmed}
    end
  end

  defp normalize_api_key(_), do: {:error, :missing_api_key}

  defp api_headers(api_key) do
    [
      {"Authorization", "Bearer #{api_key}"},
      {"Notion-Version", @notion_version},
      {"Content-Type", "application/json"}
    ]
  end

  defp map_status_error(401, _body), do: :unauthorized
  defp map_status_error(403, _body), do: :forbidden
  defp map_status_error(404, _body), do: :not_found
  defp map_status_error(status, body), do: {:http_error, status, body}

  defp default_http(method, url, opts) when method in [:get, :post] and is_binary(url) do
    headers = Keyword.get(opts, :headers, [])
    decode_body = Keyword.get(opts, :decode_body, true)

    req_opts =
      [
        method: method,
        url: url,
        headers: headers,
        decode_body: decode_body,
        connect_options: [timeout: @request_timeout_ms]
      ]
      |> maybe_put_json(opts)

    case Req.request(req_opts) do
      {:ok, %Req.Response{status: status, body: body}} ->
        {:ok, status, body}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp maybe_put_json(req_opts, opts) do
    case Keyword.fetch(opts, :json) do
      {:ok, json} -> Keyword.put(req_opts, :json, json)
      :error -> req_opts
    end
  end
end
