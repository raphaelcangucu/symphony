defmodule SymphonyElixir.Tracker.Identity do
  @moduledoc """
  Resolves the "logged-in" operator identity per tracker provider, used both for
  the orchestrator assignee gate and the settings "connected identities" surface.

  Each provider has a single set of credentials (env / WORKFLOW / settings), so
  "me" is whoever that credential authenticates as:

    * GitHub / local — GraphQL `viewer` login (cached by `LocalTracker.Viewer`)
    * Jira — `GET /rest/api/3/myself` `accountId`
    * Linear — GraphQL `viewer` user id

  `match_value/1` is the canonical assignee identifier compared against an
  issue's stored remote assignee id during candidate selection.
  """

  alias SymphonyElixir.GitHub.Config, as: GitHubConfig
  alias SymphonyElixir.Jira.Config, as: JiraConfig
  alias SymphonyElixir.Linear.Config, as: LinearConfig
  alias SymphonyElixir.Jira.Client, as: JiraClient
  alias SymphonyElixir.Linear.Client, as: LinearClient
  alias SymphonyElixir.LocalTracker.Viewer, as: GitHubViewer
  alias SymphonyElixir.Tracker.Identity.Cache

  @type t :: %{
          provider: String.t(),
          match_value: String.t(),
          login: String.t() | nil,
          name: String.t() | nil,
          email: String.t() | nil,
          avatar_url: String.t() | nil
        }

  @providers ["github", "jira", "linear"]

  # Identity changes rarely; cache for a long window to avoid burning rate limits.
  @cache_ttl_ms 6 * 60 * 60 * 1_000

  @spec providers() :: [String.t()]
  def providers, do: @providers

  @doc """
  Resolves the operator identity for a tracker kind.

  Local projects authenticate against GitHub, so `"local"` resolves the GitHub
  viewer. Returns `{:error, :unsupported_provider}` for unknown kinds.
  """
  @spec resolve(String.t(), keyword()) :: {:ok, t()} | {:error, term()}
  def resolve(kind, opts \\ [])

  def resolve(kind, opts) when kind in ["github", "local"], do: resolve_github(opts)
  def resolve("jira", opts), do: cached("jira", fn -> resolve_jira(opts) end)
  def resolve("linear", opts), do: cached("linear", fn -> resolve_linear(opts) end)
  def resolve(_kind, _opts), do: {:error, :unsupported_provider}

  @doc "Canonical assignee match value for a tracker kind, or nil when unresolved."
  @spec match_value(String.t(), keyword()) :: String.t() | nil
  def match_value(kind, opts \\ []) do
    case resolve(kind, opts) do
      {:ok, %{match_value: value}} -> value
      {:error, _reason} -> nil
    end
  end

  @doc """
  Connection status for every supported provider, including ones that are not
  configured. Drives the settings "connected identities" panel.
  """
  @spec statuses(keyword()) :: [map()]
  def statuses(opts \\ []) do
    Enum.map(@providers, fn provider ->
      cond do
        not configured?(provider) ->
          %{provider: provider, configured: false, connected: false, identity: nil, error: nil}

        true ->
          case resolve(provider, opts) do
            {:ok, identity} ->
              %{provider: provider, configured: true, connected: true, identity: identity, error: nil}

            {:error, reason} ->
              %{provider: provider, configured: true, connected: false, identity: nil, error: format_error(reason)}
          end
      end
    end)
  end

  @doc "Whether a provider has the credentials it needs to authenticate."
  @spec configured?(String.t()) :: boolean()
  def configured?("github"), do: is_binary(GitHubConfig.token())
  def configured?("jira"), do: is_binary(JiraConfig.base_url()) and is_binary(JiraConfig.email()) and is_binary(JiraConfig.api_token())
  def configured?("linear"), do: is_binary(LinearConfig.api_key())
  def configured?(_provider), do: false

  @doc "Drops any cached identity so the next resolve re-fetches from the provider."
  @spec invalidate(String.t()) :: :ok
  def invalidate(provider) when provider in @providers do
    Cache.invalidate(cache_key(provider))
    if provider == "github", do: GitHubViewer.invalidate_cache()
    :ok
  end

  def invalidate(_provider), do: :ok

  defp resolve_github(opts) do
    case GitHubViewer.current(opts) do
      {:ok, %{login: login} = viewer} when is_binary(login) and login != "" ->
        {:ok,
         %{
           provider: "github",
           match_value: login,
           login: login,
           name: Map.get(viewer, :name),
           email: nil,
           avatar_url: Map.get(viewer, :avatar_url)
         }}

      {:ok, _viewer} ->
        {:error, :missing_github_viewer_login}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp resolve_jira(opts) do
    case JiraClient.viewer(opts) do
      {:ok, %{account_id: account_id} = viewer} when is_binary(account_id) ->
        {:ok,
         %{
           provider: "jira",
           match_value: account_id,
           login: Map.get(viewer, :display_name),
           name: Map.get(viewer, :display_name),
           email: Map.get(viewer, :email),
           avatar_url: nil
         }}

      {:ok, _viewer} ->
        {:error, :missing_jira_viewer_identity}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp resolve_linear(opts) do
    case LinearClient.viewer(opts) do
      {:ok, %{id: id} = viewer} when is_binary(id) ->
        {:ok,
         %{
           provider: "linear",
           match_value: id,
           login: Map.get(viewer, :display_name),
           name: Map.get(viewer, :name) || Map.get(viewer, :display_name),
           email: Map.get(viewer, :email),
           avatar_url: nil
         }}

      {:ok, _viewer} ->
        {:error, :missing_linear_viewer_identity}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # Cache successful resolutions only; transient errors are retried next time.
  defp cached(provider, resolver) do
    key = cache_key(provider)

    case Cache.fetch(key) do
      {:ok, identity} ->
        {:ok, identity}

      :miss ->
        case resolver.() do
          {:ok, identity} = ok ->
            Cache.put(key, identity, @cache_ttl_ms)
            ok

          {:error, _reason} = error ->
            error
        end
    end
  end

  defp cache_key(provider), do: {:identity, provider}

  defp format_error(reason) when is_atom(reason), do: to_string(reason)
  defp format_error(reason), do: inspect(reason)
end
