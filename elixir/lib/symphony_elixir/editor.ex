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
    path = Workspace.path_for_issue(workspace_identifier(issue_identifier))

    if File.dir?(path), do: {:ok, path}, else: {:error, :workspace_missing}
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
