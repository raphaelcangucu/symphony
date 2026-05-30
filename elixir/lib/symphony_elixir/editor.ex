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

  @type reason :: :disabled | :starting | :unavailable | :workspace_missing

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

    if File.dir?(workspace_path) do
      {:ok, resolve_editor_folder(workspace_path)}
    else
      {:error, :workspace_missing}
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

    case dev_roots do
      [{_name, single_path}] ->
        single_path

      multiple when length(multiple) > 1 ->
        write_multi_root_workspace(workspace_path, multiple)

      [] ->
        workspace_path
    end
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
    "#{Config.editor_base_url()}/?folder=#{URI.encode_www_form(path)}"
  end

  defp workspace_identifier(issue_identifier) do
    String.trim_leading(issue_identifier, "#")
  end

  defp status_fun do
    Application.get_env(:symphony_elixir, :editor_status_fun, &Server.status/0)
  end
end
