defmodule SymphonyElixirWeb.Tracker.WorkspaceDiffController do
  @moduledoc "Exposes issue workspace branch/uncommitted git patches for the tracker UI."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Evidence.CommitMessageGenerator
  alias SymphonyElixir.Evidence.WorkspaceCommit
  alias SymphonyElixir.Evidence.WorkspaceDiff
  alias SymphonyElixir.Evidence.WorkspacePush
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Workspace
  alias SymphonyElixirWeb.TrackerErrors

  @max_commit_diff_summary_bytes 20_000

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

  @spec stats(Conn.t(), map()) :: Conn.t()
  def stats(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    with {:ok, type} <- diff_type(Map.get(params, "type", "branch")),
         {:ok, workspace} <- issue_workspace(project_slug, identifier),
         {:ok, stats} <- WorkspaceDiff.stats(workspace, type: type) do
      json(conn, %{data: stats, workspace: workspace_brief(workspace)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec stats_thread(Conn.t(), map()) :: Conn.t()
  def stats_thread(conn, %{"thread_id" => raw_id} = params) do
    with {:ok, type} <- diff_type(Map.get(params, "type", "branch")),
         {:ok, workspace} <- thread_workspace(raw_id),
         {:ok, stats} <- WorkspaceDiff.stats(workspace, type: type) do
      json(conn, %{data: stats, workspace: workspace_brief(workspace)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
      :no_workspace -> json(conn, %{data: [], workspace: workspace_brief(nil)})
    end
  end

  @spec files(Conn.t(), map()) :: Conn.t()
  def files(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    with {:ok, type} <- diff_type(Map.get(params, "type", "branch")),
         {:ok, workspace} <- issue_workspace(project_slug, identifier),
         {:ok, page} <- WorkspaceDiff.list_files(workspace, list_files_opts(type, params)) do
      json(conn, Map.put(page, :workspace, workspace_brief(workspace)))
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec files_thread(Conn.t(), map()) :: Conn.t()
  def files_thread(conn, %{"thread_id" => raw_id} = params) do
    with {:ok, type} <- diff_type(Map.get(params, "type", "branch")),
         {:ok, workspace} <- thread_workspace(raw_id),
         {:ok, page} <- WorkspaceDiff.list_files(workspace, list_files_opts(type, params)) do
      json(conn, Map.put(page, :workspace, workspace_brief(workspace)))
    else
      {:error, reason} ->
        TrackerErrors.render(conn, reason)

      :no_workspace ->
        json(conn, %{files: [], total: 0, limit: 100, next_cursor: nil, workspace: workspace_brief(nil)})
    end
  end

  @spec file_patch(Conn.t(), map()) :: Conn.t()
  def file_patch(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    with {:ok, type} <- diff_type(Map.get(params, "type", "branch")),
         {:ok, workspace} <- issue_workspace(project_slug, identifier),
         {:ok, patch} <- WorkspaceDiff.patch(workspace, type, patch_opts(params)) do
      json(conn, %{data: patch, workspace: workspace_brief(workspace)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec file_patch_thread(Conn.t(), map()) :: Conn.t()
  def file_patch_thread(conn, %{"thread_id" => raw_id} = params) do
    with {:ok, type} <- diff_type(Map.get(params, "type", "branch")),
         {:ok, workspace} <- thread_workspace(raw_id),
         {:ok, patch} <- WorkspaceDiff.patch(workspace, type, patch_opts(params)) do
      json(conn, %{data: patch, workspace: workspace_brief(workspace)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
      :no_workspace -> TrackerErrors.render(conn, :workspace_not_found)
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

  @spec summaries(Conn.t(), map()) :: Conn.t()
  def summaries(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with {:ok, workspace} <- issue_workspace(project_slug, identifier),
         {:ok, summaries} <- WorkspaceDiff.repo_summaries(workspace) do
      json(conn, %{
        data: Enum.map(summaries, &summary_json/1),
        workspace: workspace_brief(workspace)
      })
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec push(Conn.t(), map()) :: Conn.t()
  def push(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with {:ok, workspace} <- issue_workspace(project_slug, identifier),
         {:ok, results} <- WorkspacePush.push(workspace) do
      json(conn, %{
        data: Enum.map(results, &push_json/1),
        workspace: workspace_brief(workspace)
      })
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec generate_commit_message(Conn.t(), map()) :: Conn.t()
  def generate_commit_message(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with {:ok, workspace} <- issue_workspace(project_slug, identifier),
         {:ok, issue} <- load_issue_for_prompt(project_slug, identifier),
         {:ok, summary} <- diff_summary_for_commit(workspace),
         {:ok, message} <-
           CommitMessageGenerator.generate(
             workspace,
             issue,
             Keyword.merge([diff_summary: summary], generator_runner_opts())
           ) do
      json(conn, %{data: %{message: message}})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
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

  defp list_files_opts(type, params) do
    [
      type: type,
      repo: Map.get(params, "repo"),
      q: Map.get(params, "q"),
      limit: Map.get(params, "limit"),
      cursor: Map.get(params, "cursor")
    ]
  end

  defp patch_opts(params) do
    [repo: Map.get(params, "repo"), path: Map.get(params, "path")]
  end

  defp thread_workspace(raw_id) do
    with {:ok, id} <- parse_thread_id(raw_id),
         {:ok, thread} <- History.get_thread(id) do
      case Map.get(thread, :workspace_path) do
        path when is_binary(path) and path != "" -> {:ok, path}
        _ -> :no_workspace
      end
    end
  end

  defp commit_message(%{"message" => message}) when is_binary(message) do
    case String.trim(message) do
      "" -> {:error, :invalid_commit_message}
      trimmed -> {:ok, trimmed}
    end
  end

  defp commit_message(_params), do: {:error, :invalid_commit_message}

  defp summary_json(%{repo: repo, branch: branch, ahead_count: ahead_count, dirty?: dirty?}) do
    %{repo: repo, branch: branch, ahead_count: ahead_count, dirty: dirty?}
  end

  defp push_json(%{repo: repo, ok: true}), do: %{repo: repo, ok: true}
  defp push_json(%{repo: repo, ok: false, error: error}), do: %{repo: repo, ok: false, error: error}

  defp diff_summary_for_commit(workspace) do
    with {:ok, repos} <- WorkspaceDiff.changes(workspace, :uncommitted),
         summary when is_binary(summary) and summary != "" <- compact_diff_summary(repos) do
      {:ok, summary}
    else
      "" -> {:error, :nothing_to_commit}
      {:error, reason} -> {:error, reason}
    end
  end

  defp compact_diff_summary(repos) when is_list(repos) do
    repos
    |> Enum.reduce_while("", fn repo, summary ->
      remaining_bytes = @max_commit_diff_summary_bytes - byte_size(summary)

      if remaining_bytes <= 0 do
        {:halt, summary}
      else
        {:cont, append_repo_summary(summary, repo, remaining_bytes)}
      end
    end)
    |> String.trim()
  end

  defp append_repo_summary(summary, %{repo: repo, files: files}, remaining_bytes) when is_list(files) do
    Enum.reduce_while(files, summary, fn file, accumulated ->
      available_bytes = remaining_bytes - (byte_size(accumulated) - byte_size(summary))

      if available_bytes <= 0 do
        {:halt, accumulated}
      else
        {:cont, append_file_summary(accumulated, repo, file, available_bytes)}
      end
    end)
  end

  defp append_repo_summary(summary, _repo, _remaining_bytes), do: summary

  defp append_file_summary(summary, repo, %{path: path} = file, available_bytes) do
    patch = Map.get(file, :patch, "")
    entry = "#{repo}:#{path}\n#{patch}\n"
    summary <> truncate_to_bytes(entry, available_bytes)
  end

  defp append_file_summary(summary, _repo, _file, _available_bytes), do: summary

  defp truncate_to_bytes(value, max_bytes) when byte_size(value) <= max_bytes, do: value

  defp truncate_to_bytes(value, max_bytes) do
    value
    |> String.graphemes()
    |> Enum.reduce_while({"", 0}, fn grapheme, {truncated, used_bytes} ->
      grapheme_bytes = byte_size(grapheme)

      if used_bytes + grapheme_bytes > max_bytes do
        {:halt, {truncated, used_bytes}}
      else
        {:cont, {truncated <> grapheme, used_bytes + grapheme_bytes}}
      end
    end)
    |> elem(0)
  end

  defp load_issue_for_prompt(project_slug, identifier) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      {:ok,
       %{
         id: Map.get(issue, :id),
         identifier: Map.get(issue, :identifier),
         title: Map.get(issue, :title)
       }}
    end
  end

  defp generator_runner_opts do
    case Application.get_env(:symphony_elixir, :commit_message_generator_runner) do
      fun when is_function(fun, 4) -> [runner: fun]
      _ -> []
    end
  end

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
