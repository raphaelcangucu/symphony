defmodule SymphonyElixir.GitHub.Viewer do
  @moduledoc false

  alias SymphonyElixir.GitHub.{Client, ProjectMetadata}

  @viewer_query """
  query SymphonyGitHubViewer {
    viewer { login }
  }
  """

  @spec resolve_login(keyword()) :: {:ok, String.t()} | {:error, term()}
  def resolve_login(opts \\ []) do
    client = client_module(opts)

    case client.graphql(@viewer_query, %{}, graphql_opts(opts)) do
      {:ok, %{"data" => %{"viewer" => %{"login" => login}}}} when is_binary(login) ->
        trimmed = String.trim(login)

        if trimmed == "" do
          {:error, :missing_github_viewer_login}
        else
          {:ok, trimmed}
        end

      {:ok, _body} ->
        {:error, :missing_github_viewer_login}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec ensure_cached(Path.t(), keyword()) :: :ok | {:error, String.t()}
  def ensure_cached(base_dir \\ File.cwd!(), opts \\ []) do
    case ProjectMetadata.read(base_dir) do
      {:ok, metadata} ->
        ensure_viewer_login_cached(base_dir, metadata, opts)

      {:error, :missing_project_metadata} ->
        {:error, "GitHub project metadata missing — run bootstrap before resolving viewer login"}

      {:error, :invalid_project_metadata} ->
        {:error, "Invalid GitHub project metadata at #{ProjectMetadata.cache_path(base_dir)}"}
    end
  end

  @spec cached_login(Path.t()) :: String.t() | nil
  def cached_login(base_dir \\ File.cwd!()) do
    case ProjectMetadata.read(base_dir) do
      {:ok, %{"viewer_login" => login}} when is_binary(login) ->
        case String.trim(login) do
          "" -> nil
          trimmed -> trimmed
        end

      _ ->
        nil
    end
  end

  defp ensure_viewer_login_cached(base_dir, metadata, opts) do
    case Map.get(metadata, "viewer_login") do
      login when is_binary(login) and login != "" ->
        :ok

      _ ->
        cache_resolved_viewer_login(base_dir, metadata, opts)
    end
  end

  defp cache_resolved_viewer_login(base_dir, metadata, opts) do
    with {:ok, login} <- resolve_login(opts),
         updated <- Map.put(metadata, "viewer_login", login) do
      ProjectMetadata.write!(base_dir, updated)
      :ok
    else
      {:error, reason} ->
        {:error, "Failed to resolve GitHub viewer login: #{format_error(reason)}"}
    end
  end

  defp client_module(opts) do
    case Keyword.get(opts, :client_module) do
      nil -> Application.get_env(:symphony_elixir, :github_client_module, Client)
      module when is_atom(module) -> module
    end
  end

  defp graphql_opts(opts), do: Keyword.take(opts, [:request_fun, :operation_name])

  defp format_error(:missing_github_viewer_login),
    do: "GitHub viewer login missing from API response"

  defp format_error(:missing_github_token),
    do: "GITHUB_TOKEN is not set"

  defp format_error(reason) when is_binary(reason), do: reason
  defp format_error(reason), do: inspect(reason)
end
