defmodule SymphonyElixir.LocalTracker.Viewer do
  @moduledoc """
  Resolves the GitHub login of the local Symphony operator and caches it in ETS.
  """

  alias SymphonyElixir.GitHub.Client
  alias SymphonyElixir.LocalTracker.Viewer.Server

  require Logger

  @type t :: %{login: String.t(), name: String.t() | nil, avatar_url: String.t() | nil}

  @type viewer_error ::
          :missing_github_token
          | :unauthorized
          | {:rate_limited, %{optional(:reset_at) => DateTime.t() | nil}}
          | {:network_error, term()}
          | {:malformed_response, term()}

  @cache_key :current
  @stale_key :last_known
  # The viewer identity changes rarely, so cache for a long window to avoid
  # burning the GitHub rate limit. A separate, non-expiring "last known good"
  # copy is also kept (and persisted) for graceful fallback when a refresh fails.
  @default_ttl_ms 6 * 60 * 60 * 1_000

  @query """
  query SymphonyViewer {
    viewer {
      login
      name
      avatarUrl
    }
  }
  """

  @spec current(keyword()) :: {:ok, t()} | {:error, viewer_error()}
  def current(opts \\ []) when is_list(opts) do
    case lookup_cache() do
      {:ok, value} ->
        {:ok, value}

      :miss ->
        case resolve(opts) do
          {:ok, value} ->
            put_cached(value)
            {:ok, value}

          {:error, _reason} = error ->
            stale_fallback(error)
        end
    end
  end

  @spec current!(keyword()) :: t()
  def current!(opts \\ []) when is_list(opts) do
    case current(opts) do
      {:ok, value} -> value
      {:error, reason} -> raise "viewer unavailable: #{inspect(reason)}"
    end
  end

  @spec invalidate_cache() :: :ok
  def invalidate_cache do
    if :ets.whereis(Server.table_name()) != :undefined do
      :ets.delete(Server.table_name(), @cache_key)
      :ets.delete(Server.table_name(), @stale_key)
    end

    :ok
  end

  @doc false
  @spec put_cached(t()) :: :ok
  def put_cached(value) when is_map(value) do
    expires_at = System.monotonic_time(:millisecond) + ttl_ms()
    :ets.insert(Server.table_name(), {@cache_key, value, expires_at})
    :ets.insert(Server.table_name(), {@stale_key, value})
    persist(value)
    :ok
  end

  @doc """
  Loads a previously-persisted viewer (if any) into the cache. Called by the
  cache server on boot so the identity survives restarts without a GitHub call.
  """
  @spec hydrate_from_disk() :: :ok
  def hydrate_from_disk do
    case load_persisted() do
      {:ok, value} ->
        expires_at = System.monotonic_time(:millisecond) + ttl_ms()
        :ets.insert(Server.table_name(), {@cache_key, value, expires_at})
        :ets.insert(Server.table_name(), {@stale_key, value})
        :ok

      :error ->
        :ok
    end
  end

  defp stale_fallback(error) do
    case stale_lookup() do
      {:ok, value} -> {:ok, value}
      :miss -> error
    end
  end

  defp stale_lookup do
    case :ets.lookup(Server.table_name(), @stale_key) do
      [{@stale_key, value}] -> {:ok, value}
      _ -> :miss
    end
  rescue
    ArgumentError -> :miss
  end

  defp lookup_cache do
    case :ets.lookup(Server.table_name(), @cache_key) do
      [{@cache_key, value, expires_at}] ->
        if System.monotonic_time(:millisecond) < expires_at, do: {:ok, value}, else: :miss

      _ ->
        :miss
    end
  rescue
    ArgumentError -> :miss
  end

  defp resolve(opts) do
    client = Keyword.get(opts, :client_module, Client)
    request_fun = Keyword.get(opts, :request_fun)

    graphql_opts =
      if request_fun, do: [request_fun: request_fun], else: []

    case client.graphql(@query, %{}, graphql_opts) do
      {:ok, %{"data" => %{"viewer" => viewer}}} -> decode_viewer(viewer)
      {:ok, body} -> {:error, {:malformed_response, body}}
      {:error, reason} -> map_resolve_error(reason)
    end
  end

  defp map_resolve_error(:missing_github_token), do: {:error, :missing_github_token}
  defp map_resolve_error({:github_api_status, 401}), do: {:error, :unauthorized}
  defp map_resolve_error({:rate_limited, _info} = error), do: {:error, error}
  defp map_resolve_error({:github_api_status, status}), do: {:error, {:network_error, {:http_status, status}}}
  defp map_resolve_error({:github_api_request, reason}), do: {:error, {:network_error, reason}}
  defp map_resolve_error(reason), do: {:error, {:network_error, reason}}

  defp decode_viewer(%{"login" => login} = node) when is_binary(login) do
    case String.trim(login) do
      "" ->
        {:error, {:malformed_response, node}}

      trimmed ->
        {:ok,
         %{
           login: trimmed,
           name: trim_or_nil(Map.get(node, "name")),
           avatar_url: trim_or_nil(Map.get(node, "avatarUrl"))
         }}
    end
  end

  defp decode_viewer(node), do: {:error, {:malformed_response, node}}

  defp trim_or_nil(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp trim_or_nil(_), do: nil

  defp ttl_ms do
    case Application.get_env(:symphony_elixir, :viewer_cache_ttl_ms, @default_ttl_ms) do
      ttl when is_integer(ttl) -> ttl
      _ -> @default_ttl_ms
    end
  end

  defp persist(value) do
    with true <- persist_enabled?(),
         path when is_binary(path) <- cache_file() do
      File.mkdir_p!(Path.dirname(path))
      File.write(path, Jason.encode!(stringify(value)))
    end

    :ok
  rescue
    error ->
      Logger.warning("Failed to persist viewer cache: #{inspect(error)}")
      :ok
  end

  defp load_persisted do
    if persist_enabled?(), do: read_persisted(cache_file()), else: :error
  end

  defp read_persisted(path) when is_binary(path) do
    with {:ok, body} <- File.read(path),
         {:ok, %{"login" => login} = decoded} <- Jason.decode(body),
         true <- is_binary(login) and String.trim(login) != "" do
      {:ok, %{login: String.trim(login), name: Map.get(decoded, "name"), avatar_url: Map.get(decoded, "avatar_url")}}
    else
      _ -> :error
    end
  end

  defp read_persisted(_path), do: :error

  defp stringify(%{login: login, name: name, avatar_url: avatar_url}) do
    %{"login" => login, "name" => name, "avatar_url" => avatar_url}
  end

  defp persist_enabled? do
    Application.get_env(:symphony_elixir, :viewer_persist_enabled, true) == true
  end

  # Persist next to the local tracker SQLite DB so the identity survives restarts.
  defp cache_file do
    case Application.get_env(:symphony_elixir, :viewer_cache_file) do
      path when is_binary(path) and path != "" ->
        path

      _ ->
        case get_in(Application.get_env(:symphony_elixir, SymphonyElixir.Repo, []), [:database]) do
          db when is_binary(db) -> Path.join(Path.dirname(db), "viewer.json")
          _ -> nil
        end
    end
  end
end
