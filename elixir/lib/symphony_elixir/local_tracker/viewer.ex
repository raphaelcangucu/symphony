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
          | {:network_error, term()}
          | {:malformed_response, term()}

  @cache_key :current
  @default_ttl_ms 5 * 60 * 1_000

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
            error
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
    end

    :ok
  end

  @doc false
  @spec put_cached(t()) :: :ok
  def put_cached(value) when is_map(value) do
    expires_at = System.monotonic_time(:millisecond) + ttl_ms()
    :ets.insert(Server.table_name(), {@cache_key, value, expires_at})
    :ok
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
      {:ok, %{"data" => %{"viewer" => viewer}}} ->
        decode_viewer(viewer)

      {:ok, body} ->
        {:error, {:malformed_response, body}}

      {:error, :missing_github_token} ->
        {:error, :missing_github_token}

      {:error, {:github_api_status, 401}} ->
        {:error, :unauthorized}

      {:error, {:github_api_status, status}} ->
        {:error, {:network_error, {:http_status, status}}}

      {:error, {:github_api_request, reason}} ->
        {:error, {:network_error, reason}}

      {:error, reason} ->
        {:error, {:network_error, reason}}
    end
  end

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
    Application.get_env(:symphony_elixir, :viewer_cache_ttl_ms, @default_ttl_ms)
  end
end
