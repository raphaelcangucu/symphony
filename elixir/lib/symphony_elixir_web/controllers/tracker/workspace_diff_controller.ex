defmodule SymphonyElixirWeb.Tracker.WorkspaceDiffController do
  @moduledoc "Exposes issue workspace branch/uncommitted git patches for the tracker UI."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Evidence.WorkspaceCommit
  alias SymphonyElixir.Evidence.WorkspaceDiff
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Workspace
  alias SymphonyElixirWeb.TrackerErrors

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    with {:ok, type} <- diff_type(Map.get(params, "type", "branch")),
         {:ok, workspace} <- issue_workspace(project_slug, identifier),
         {:ok, repos} <- WorkspaceDiff.changes(workspace, type) do
      json(conn, %{data: repos, workspace: workspace_brief(workspace)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec commit(Conn.t(), map()) :: Conn.t()
  def commit(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    with {:ok, message} <- commit_message(params),
         {:ok, workspace} <- issue_workspace(project_slug, identifier),
         {:ok, commits} <- WorkspaceCommit.commit(workspace, message) do
      json(conn, %{data: commits, workspace: workspace_brief(workspace)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec commit_thread(Conn.t(), map()) :: Conn.t()
  def commit_thread(conn, %{"thread_id" => raw_id} = params) do
    with {:ok, id} <- parse_thread_id(raw_id),
         {:ok, message} <- commit_message(params),
         {:ok, thread} <- History.get_thread(id),
         workspace when is_binary(workspace) <- Map.get(thread, :workspace_path),
         {:ok, commits} <- WorkspaceCommit.commit(workspace, message) do
      json(conn, %{data: commits, workspace: workspace_brief(workspace)})
    else
      {:error, reason} ->
        TrackerErrors.render(conn, reason)

      _ ->
        json(conn, %{data: [], workspace: workspace_brief(nil)})
    end
  end

  @spec thread(Conn.t(), map()) :: Conn.t()
  def thread(conn, %{"thread_id" => raw_id} = params) do
    with {:ok, id} <- parse_thread_id(raw_id),
         {:ok, type} <- diff_type(Map.get(params, "type", "branch")),
         {:ok, thread} <- History.get_thread(id),
         workspace when is_binary(workspace) <- Map.get(thread, :workspace_path),
         {:ok, repos} <- WorkspaceDiff.changes(workspace, type) do
      json(conn, %{data: repos, workspace: workspace_brief(workspace)})
    else
      {:error, reason} ->
        TrackerErrors.render(conn, reason)

      _ ->
        json(conn, %{data: [], workspace: workspace_brief(nil)})
    end
  end

  defp diff_type("branch"), do: {:ok, :branch}
  defp diff_type("uncommitted"), do: {:ok, :uncommitted}
  defp diff_type(_), do: {:error, :invalid_diff_type}

  defp commit_message(%{"message" => message}) when is_binary(message) do
    case String.trim(message) do
      "" -> {:error, :invalid_commit_message}
      trimmed -> {:ok, trimmed}
    end
  end

  defp commit_message(_params), do: {:error, :invalid_commit_message}

  defp issue_workspace(project_slug, identifier) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, _issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      issue = %Issue{identifier: identifier, project_slug: project_slug}
      {:ok, resolved_issue_workspace(project_slug, identifier, issue)}
    end
  end

  defp resolved_issue_workspace(project_slug, identifier, issue) do
    case History.issue_workspace_context(identifier) do
      %{project_slug: ^project_slug, workspace_path: path} when is_binary(path) and path != "" ->
        Path.expand(path)

      %{project_slug: nil, workspace_path: path} when is_binary(path) and path != "" ->
        Path.expand(path)

      _ ->
        Workspace.path_for_issue(issue)
    end
  end

  defp workspace_brief(workspace) when is_binary(workspace) do
    %{path: workspace, available: File.dir?(workspace)}
  end

  defp workspace_brief(_), do: %{path: "", available: false}

  defp parse_thread_id(id) when is_integer(id) and id > 0, do: {:ok, id}

  defp parse_thread_id(id) when is_binary(id) do
    case Integer.parse(String.trim(id)) do
      {parsed, ""} when parsed > 0 -> {:ok, parsed}
      _ -> {:error, :invalid_thread_id}
    end
  end

  defp parse_thread_id(_), do: {:error, :invalid_thread_id}
end
