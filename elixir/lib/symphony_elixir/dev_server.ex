defmodule SymphonyElixir.DevServer do
  @moduledoc """
  Builds read-side dev-server views for issue previews.
  """

  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixir.LocalTracker.{Context, DevEnv}
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workspace

  @type view :: %{
          available: boolean(),
          reason: nil | :disabled | :workspace_missing | :no_serve_step,
          servers: [map()]
        }

  @spec issue_targets(String.t(), String.t()) :: {:ok, view()} | {:error, :project_not_found}
  def issue_targets(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    with {:ok, project} <- Context.get_project(project_slug) do
      project = Repo.preload(project, :setup)
      config = ProjectConfig.resolve(project)
      servers = Manager.list_for_issue(project_slug, identifier)

      {:ok, availability_view(project_slug, identifier, config, servers)}
    end
  end

  def issue_targets(_project_slug, _identifier) do
    raise ArgumentError, "project_slug and identifier must be strings"
  end

  defp availability_view(project_slug, identifier, config, servers) do
    cond do
      not ProjectConfig.dev_server_enabled?(config) ->
        unavailable(:disabled, servers)

      not issue_workspace_exists?(project_slug, identifier) ->
        unavailable(:workspace_missing, servers)

      DevEnv.list_serve_steps(project_slug) == [] ->
        unavailable(:no_serve_step, servers)

      true ->
        %{available: true, reason: nil, servers: servers}
    end
  end

  defp unavailable(reason, servers) do
    %{available: false, reason: reason, servers: servers}
  end

  defp issue_workspace_exists?(project_slug, identifier) do
    identifier
    |> String.trim_leading("#")
    |> then(&Workspace.path_for_issue(%{identifier: &1, project_slug: project_slug}))
    |> File.dir?()
  end
end
