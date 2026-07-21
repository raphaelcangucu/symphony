defmodule SymphonyElixir.DevServer do
  @moduledoc """
  Read-side entry point for issue previews. Delegates to
  `SymphonyElixir.DevServer.Snapshot`, the single authoritative builder that
  every consumer (REST/SSE, Tracker dock, assistant tools, prompt) renders.
  """

  alias SymphonyElixir.DevServer.Snapshot

  @type view :: Snapshot.t()

  @spec issue_targets(String.t(), String.t()) :: {:ok, view()} | {:error, :project_not_found}
  def issue_targets(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    Snapshot.build(project_slug, identifier)
  end

  def issue_targets(_project_slug, _identifier) do
    raise ArgumentError, "project_slug and identifier must be strings"
  end

  @spec workspace_targets(String.t(), Path.t()) ::
          {:ok, view()} | {:error, :project_not_found}
  def workspace_targets(project_slug, workspace_path)
      when is_binary(project_slug) and is_binary(workspace_path) do
    Snapshot.build_for_workspace(project_slug, workspace_path)
  end

  def workspace_targets(_project_slug, _workspace_path) do
    raise ArgumentError, "project_slug and workspace_path must be strings"
  end
end
