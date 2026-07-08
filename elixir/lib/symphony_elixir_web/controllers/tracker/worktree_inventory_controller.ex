defmodule SymphonyElixirWeb.Tracker.WorktreeInventoryController do
  @moduledoc """
  Working-tree inventory for the tracker Workspaces page: lists every workspace
  and child worktree a project owns (with per-repo git state and disk usage),
  removes them in batch, and creates named standalone workspaces.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Workspace.Inventory
  alias SymphonyElixir.Workspace.Standalone
  alias SymphonyElixirWeb.{TrackerErrors, TrackerPresenter}

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug}) do
    case Inventory.scan(project_slug) do
      {:ok, scan} ->
        json(conn, %{
          data: Enum.map(scan.workspaces, &workspace_json/1),
          totals: scan.totals
        })

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  @spec remove(Conn.t(), map()) :: Conn.t()
  def remove(conn, %{"project_slug" => project_slug, "paths" => paths}) when is_list(paths) do
    case Inventory.remove(project_slug, paths) do
      {:ok, results} ->
        json(conn, %{data: Enum.map(results, &removal_json/1)})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def remove(conn, _params) do
    TrackerErrors.validation_msg(conn, "paths must be a list of workspace paths")
  end

  @spec create_workspace(Conn.t(), map()) :: Conn.t()
  def create_workspace(conn, %{"project_slug" => project_slug, "name" => name} = params) do
    branches = normalize_branches(Map.get(params, "branches"))

    with {:ok, path} <- Standalone.create(project_slug, name, branches),
         {:ok, thread} <-
           History.create_workspace_session_thread(project_slug, path, %{
             title: session_title(params, name),
             agent_kind: normalize_agent(params["agent_kind"])
           }) do
      conn
      |> put_status(:created)
      |> json(%{
        data: %{
          workspace_path: path,
          thread: TrackerPresenter.assistant_thread(thread)
        }
      })
    else
      {:error, :invalid_workspace_name} ->
        TrackerErrors.validation_msg(conn, "workspace name must contain letters, numbers, dots, dashes, or underscores")

      {:error, :workspace_already_exists} ->
        TrackerErrors.validation_msg(conn, "a workspace with this name already exists")

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def create_workspace(conn, _params) do
    TrackerErrors.validation_msg(conn, "workspace name is required")
  end

  defp workspace_json(entry) do
    %{
      path: entry.path,
      kind: Atom.to_string(entry.kind),
      issue_identifier: entry.issue_identifier,
      name: entry.name,
      classification: Atom.to_string(entry.classification),
      reclaimable: entry.reclaimable,
      work_present: entry.work_present,
      execution_status: entry.execution_status && Atom.to_string(entry.execution_status),
      removable: entry.removable,
      size_bytes: entry.size_bytes,
      repos: entry.repos,
      child_worktrees: entry.child_worktrees
    }
  end

  defp removal_json(result) do
    %{path: result.path, status: Atom.to_string(result.status), reason: result.reason}
  end

  defp normalize_branches(%{} = branches) do
    branches
    |> Enum.filter(fn {key, value} -> is_binary(key) and is_binary(value) and String.trim(value) != "" end)
    |> Map.new(fn {key, value} -> {key, String.trim(value)} end)
  end

  defp normalize_branches(_branches), do: %{}

  defp session_title(params, name) do
    case params["title"] do
      title when is_binary(title) and title != "" -> title
      _ -> "Workspace: " <> name
    end
  end

  defp normalize_agent(agent) when agent in ["codex", "claude", "cursor", "opencode"], do: agent
  defp normalize_agent(_agent), do: nil
end
