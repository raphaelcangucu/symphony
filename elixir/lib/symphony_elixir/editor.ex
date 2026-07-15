defmodule SymphonyElixir.Editor do
  @moduledoc """
  Builds the browser URL that opens a task's workspace in code-server.

  Resolves the workspace path the same way the issue terminal does, gated on the
  editor being enabled, the code-server process being ready, and the workspace
  directory existing on disk.
  """

  alias SymphonyElixir.Config
  alias SymphonyElixir.Assistant.ProjectExploreWorkspace
  alias SymphonyElixir.Editor.Server
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Workspace
  alias SymphonyElixir.WorkspaceSkills

  require Logger

  @type reason ::
          :disabled
          | :starting
          | :unavailable
          | :workspace_missing
          | :workspace_skills_unavailable

  @spec editor_target(String.t(), String.t()) :: {:ok, String.t()} | {:error, reason()}
  def editor_target(project_slug, issue_identifier) when is_binary(issue_identifier) do
    with :ok <- ensure_enabled(),
         :ok <- ensure_ready(),
         {:ok, path} <- ensure_browser_workspace(project_slug, issue_identifier) do
      {:ok, build_browser_url(path)}
    end
  end

  @spec cursor_desktop_target(String.t(), String.t()) :: {:ok, String.t()} | {:error, reason()}
  def cursor_desktop_target(project_slug, issue_identifier) when is_binary(issue_identifier) do
    case ensure_workspace_path(project_slug, issue_identifier) do
      {:ok, path} -> {:ok, build_cursor_url(path)}
      {:error, _} = error -> error
    end
  end

  @spec project_editor_target(String.t()) :: {:ok, String.t()} | {:error, reason()}
  def project_editor_target(project_slug) when is_binary(project_slug) do
    with :ok <- ensure_enabled(),
         :ok <- ensure_ready(),
         {:ok, path} <- ensure_browser_project_workspace(project_slug) do
      {:ok, build_browser_url(path)}
    end
  end

  @spec project_cursor_desktop_target(String.t()) :: {:ok, String.t()} | {:error, reason()}
  def project_cursor_desktop_target(project_slug) when is_binary(project_slug) do
    case ensure_project_workspace_path(project_slug) do
      {:ok, path} -> {:ok, build_cursor_url(path)}
      {:error, _} = error -> error
    end
  end

  defp ensure_enabled do
    if Config.editor_enabled?(), do: :ok, else: {:error, :disabled}
  end

  defp ensure_ready do
    case status_fun().() do
      :ready -> :ok
      :starting -> {:error, :starting}
      _ -> {:error, :unavailable}
    end
  end

  defp ensure_workspace_path(project_slug, issue_identifier) do
    workspace_path = Workspace.path_for_issue(workspace_identifier(issue_identifier))

    if File.dir?(workspace_path) do
      {:ok, resolve_issue_editor_folder(project_slug, workspace_path)}
    else
      {:error, :workspace_missing}
    end
  end

  defp ensure_project_workspace_path(project_slug) do
    slug = String.trim(project_slug)
    workspace_path = ProjectExploreWorkspace.path(slug)

    if File.dir?(workspace_path) do
      {:ok, resolve_project_editor_folder(slug, workspace_path)}
    else
      {:error, :workspace_missing}
    end
  end

  defp ensure_browser_workspace(project_slug, issue_identifier) do
    workspace_path = Workspace.path_for_issue(workspace_identifier(issue_identifier))

    cond do
      not File.dir?(workspace_path) ->
        {:error, :workspace_missing}

      WorkspaceSkills.prepare(workspace_path) == :ok ->
        {:ok, resolve_issue_editor_folder(project_slug, workspace_path)}

      true ->
        Logger.warning("Editor workspace skills preparation failed workspace=#{workspace_path}")
        {:error, :workspace_skills_unavailable}
    end
  end

  defp ensure_browser_project_workspace(project_slug) do
    slug = String.trim(project_slug)
    workspace_path = ProjectExploreWorkspace.path(slug)

    cond do
      not File.dir?(workspace_path) ->
        {:error, :workspace_missing}

      WorkspaceSkills.prepare(workspace_path) == :ok ->
        {:ok, resolve_project_editor_folder(slug, workspace_path)}

      true ->
        Logger.warning("Editor project workspace skills preparation failed workspace=#{workspace_path}")
        {:error, :workspace_skills_unavailable}
    end
  end

  # Issue workspaces clone repositories into configured subdirectories (e.g.
  # `advising/`). Prefer the project's repository layout, then legacy dev-root
  # names, then any immediate child that contains a `.git` directory.
  defp resolve_issue_editor_folder(project_slug, workspace_path) do
    resolve_project_editor_folder(project_slug, workspace_path)
  end

  # Opens the buildable repo root inside a task workspace when hooks clone into
  # subdirectories (e.g. macro-markets `front/`, `back/`, or legacy `repo/`).
  defp resolve_editor_folder(workspace_path) do
    repo_subdirs = ["front", "repo", "back"]

    dev_roots =
      repo_subdirs
      |> Enum.filter(fn name ->
        sub = Path.join(workspace_path, name)
        File.dir?(sub) and dev_root?(sub)
      end)
      |> Enum.map(fn name -> {name, Path.join(workspace_path, name)} end)

    editor_roots =
      case docs_root(workspace_path, dev_roots) do
        nil -> dev_roots
        docs -> dev_roots ++ [docs]
      end

    case editor_roots do
      [{_name, single_path}] ->
        single_path

      multiple when length(multiple) > 1 ->
        write_multi_root_workspace(workspace_path, multiple)

      [] ->
        case git_roots(workspace_path) do
          [{_name, single_path}] ->
            single_path

          multiple when length(multiple) > 1 ->
            write_multi_root_workspace(workspace_path, multiple)

          [] ->
            workspace_path
        end
    end
  end

  defp resolve_project_editor_folder(project_slug, workspace_path) do
    project_roots =
      project_slug
      |> Context.list_repositories()
      |> Enum.map(fn repo -> {repo.workspace_path, Path.join(workspace_path, repo.workspace_path)} end)
      |> Enum.filter(fn {_name, path} -> File.dir?(path) end)

    case project_roots do
      [{_name, single_path}] ->
        single_path

      multiple when length(multiple) > 1 ->
        write_multi_root_workspace(workspace_path, multiple)

      [] ->
        resolve_editor_folder(workspace_path)
    end
  end

  defp docs_root(_workspace_path, []), do: nil

  defp docs_root(workspace_path, _dev_roots) do
    docs = Path.join(workspace_path, "docs")

    if File.dir?(docs), do: {"docs", docs}
  end

  defp dev_root?(path) do
    File.regular?(Path.join(path, "package.json")) or
      File.regular?(Path.join(path, "composer.json"))
  end

  defp git_roots(workspace_path) do
    case File.ls(workspace_path) do
      {:ok, names} ->
        names
        |> Enum.reject(&ignored_workspace_entry?/1)
        |> Enum.filter(fn name ->
          sub = Path.join(workspace_path, name)
          File.dir?(sub) and File.dir?(Path.join(sub, ".git"))
        end)
        |> Enum.map(fn name -> {name, Path.join(workspace_path, name)} end)

      {:error, _} ->
        []
    end
  end

  defp ignored_workspace_entry?(name) do
    name in [".git", ".symphony", ".claude", ".codex", ".cursor", ".vscode"]
  end

  defp write_multi_root_workspace(workspace_path, named_paths) do
    file = Path.join(workspace_path, ".symphony/editor.code-workspace")
    File.mkdir_p!(Path.dirname(file))

    folders =
      Enum.map(named_paths, fn {name, abs_path} ->
        %{"name" => name, "path" => abs_path}
      end)

    File.write!(file, Jason.encode!(%{"folders" => folders}, pretty: true))
    file
  end

  defp build_browser_url(path) do
    param =
      if String.ends_with?(path, ".code-workspace") do
        "workspace"
      else
        "folder"
      end

    "#{Config.editor_base_url()}/?#{param}=#{URI.encode_www_form(path)}"
  end

  defp build_cursor_url(path) do
    normalized = path |> Path.expand() |> String.replace("\\", "/")

    case wsl_cursor_url(normalized) do
      nil -> "cursor://file/" <> URI.encode(normalized)
      url -> url
    end
  end

  # When Symphony runs in WSL and the user opens the tracker from a Windows browser,
  # Cursor Desktop needs the vscode-remote form instead of a Linux file:// path.
  defp wsl_cursor_url("/" <> _ = path) do
    case System.get_env("WSL_DISTRO_NAME") do
      nil ->
        nil

      distro ->
        remote = "wsl+" <> String.downcase(distro)
        "cursor://vscode-remote/" <> remote <> path
    end
  end

  defp wsl_cursor_url(_), do: nil

  defp workspace_identifier(issue_identifier) do
    String.trim_leading(issue_identifier, "#")
  end

  defp status_fun do
    Application.get_env(:symphony_elixir, :editor_status_fun, &Server.status/0)
  end
end
