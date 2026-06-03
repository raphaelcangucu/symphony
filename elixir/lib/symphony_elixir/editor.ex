defmodule SymphonyElixir.Editor do
  @moduledoc """
  Builds the browser URL that opens a task's workspace in code-server.

  Resolves the workspace path the same way the issue terminal does, gated on the
  editor being enabled, the code-server process being ready, and the workspace
  directory existing on disk.
  """

  alias SymphonyElixir.Config
  alias SymphonyElixir.Editor.Server
  alias SymphonyElixir.Workspace
  alias SymphonyElixir.WorkspaceSkills

  require Logger

  @type reason :: :disabled | :starting | :unavailable | :workspace_missing | :workspace_skills_unavailable

  @spec editor_target(String.t(), String.t()) :: {:ok, String.t()} | {:error, reason()}
  def editor_target(_project_slug, issue_identifier) when is_binary(issue_identifier) do
    with :ok <- ensure_enabled(),
         :ok <- ensure_ready(),
         {:ok, path} <- ensure_workspace(issue_identifier) do
      {:ok, build_url(path)}
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

  defp ensure_workspace(issue_identifier) do
    workspace_path = Workspace.path_for_issue(workspace_identifier(issue_identifier))

    cond do
      not File.dir?(workspace_path) ->
        {:error, :workspace_missing}

      WorkspaceSkills.prepare(workspace_path) == :ok ->
        {:ok, resolve_editor_folder(workspace_path)}

      true ->
        Logger.warning("Editor workspace skills preparation failed workspace=#{workspace_path}")
        {:error, :workspace_skills_unavailable}
    end
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
        workspace_path
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

  defp build_url(path) do
    param =
      if String.ends_with?(path, ".code-workspace") do
        "workspace"
      else
        "folder"
      end

    "#{Config.editor_base_url()}/?#{param}=#{URI.encode_www_form(path)}"
  end

  defp workspace_identifier(issue_identifier) do
    String.trim_leading(issue_identifier, "#")
  end

  defp status_fun do
    Application.get_env(:symphony_elixir, :editor_status_fun, &Server.status/0)
  end
end
