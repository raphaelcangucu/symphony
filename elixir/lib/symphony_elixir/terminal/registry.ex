defmodule SymphonyElixir.Terminal.Registry do
  @moduledoc """
  Issue terminal session registry backed by stable tmux session names.
  """

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Terminal.Tmux
  alias SymphonyElixir.Workspace

  @type session :: %{
          project_slug: String.t(),
          issue_identifier: String.t(),
          session_name: String.t(),
          cwd: Path.t(),
          state: String.t(),
          output: String.t()
        }

  @spec session_name(String.t()) :: String.t()
  def session_name(issue_identifier) when is_binary(issue_identifier) do
    "sym-issue-#{safe_segment(issue_identifier, "issue")}"
  end

  @spec session_name(String.t(), String.t()) :: String.t()
  def session_name(project_slug, issue_identifier) when is_binary(project_slug) and is_binary(issue_identifier) do
    "sym-issue-#{safe_segment(project_slug, "project")}-#{safe_segment(issue_identifier, "issue")}"
  end

  @spec open_project_issue_session(String.t(), String.t(), keyword()) ::
          {:ok, session()} | {:error, String.t() | atom()}
  def open_project_issue_session(project_slug, issue_identifier, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) do
    with {:ok, issue} <- Context.get_issue(project_slug, issue_identifier) do
      open_issue_session(issue, opts)
    end
  end

  @spec open_issue_session(map(), keyword()) :: {:ok, session()} | {:error, String.t()}
  def open_issue_session(%{identifier: issue_identifier} = issue, opts \\ []) when is_binary(issue_identifier) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    workspace = dependency(opts, :workspace, :terminal_workspace, Workspace)
    project_slug = project_slug(issue)
    session_name = session_name(project_slug, issue_identifier)

    with :ok <- ensure_tmux_available(tmux),
         {:ok, cwd} <- create_workspace(workspace, issue, project_slug),
         :ok <- ensure_session(tmux, session_name, cwd),
         {:ok, output} <- capture_output(tmux, session_name) do
      {:ok,
       %{
         project_slug: project_slug,
         issue_identifier: issue_identifier,
         session_name: session_name,
         cwd: cwd,
         state: "running",
         output: output
       }}
    end
  end

  @spec send_input(String.t(), String.t(), String.t(), keyword()) :: :ok | {:error, String.t()}
  def send_input(project_slug, issue_identifier, data, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(data) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.send_keys(session_name(project_slug, issue_identifier), data)
  end

  @spec resize(String.t(), String.t(), pos_integer(), pos_integer(), keyword()) :: :ok | {:error, String.t()}
  def resize(project_slug, issue_identifier, cols, rows, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_integer(cols) and
             is_integer(rows) and cols > 0 and rows > 0 do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.resize(session_name(project_slug, issue_identifier), cols, rows)
  end

  @spec capture(String.t(), String.t(), keyword()) :: {:ok, String.t()} | {:error, String.t()}
  def capture(project_slug, issue_identifier, opts \\ []) when is_binary(project_slug) and is_binary(issue_identifier) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.capture_pane(session_name(project_slug, issue_identifier))
  end

  @spec project_session_name(String.t()) :: String.t()
  def project_session_name(project_slug) when is_binary(project_slug) do
    "sym-devenv-#{safe_segment(project_slug, "project")}"
  end

  @spec open_project_session(String.t(), keyword()) :: {:ok, session()} | {:error, String.t()}
  def open_project_session(project_slug, opts \\ []) when is_binary(project_slug) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    cwd = Keyword.get(opts, :cwd) || default_project_cwd(project_slug)
    session_name = project_session_name(project_slug)

    with :ok <- ensure_tmux_available(tmux),
         :ok <- File.mkdir_p(cwd),
         :ok <- ensure_session(tmux, session_name, cwd),
         {:ok, output} <- capture_output(tmux, session_name) do
      {:ok,
       %{
         project_slug: project_slug,
         issue_identifier: "__devenv__",
         session_name: session_name,
         cwd: cwd,
         state: "running",
         output: output
       }}
    end
  end

  @spec send_input_project(String.t(), String.t(), keyword()) :: :ok | {:error, String.t()}
  def send_input_project(project_slug, data, opts \\ []) when is_binary(project_slug) and is_binary(data) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.send_keys(project_session_name(project_slug), data)
  end

  @spec capture_project(String.t(), keyword()) :: {:ok, String.t()} | {:error, String.t()}
  def capture_project(project_slug, opts \\ []) when is_binary(project_slug) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.capture_pane(project_session_name(project_slug))
  end

  defp ensure_tmux_available(tmux) do
    if tmux.available?(), do: :ok, else: {:error, "tmux is not available"}
  end

  defp create_workspace(workspace, issue, project_slug) do
    issue_workspace_key = Map.put(issue, :identifier, "#{project_slug}-#{issue.identifier}")

    case workspace.create_for_issue(issue_workspace_key) do
      {:ok, cwd} -> {:ok, cwd}
      {:error, reason} -> {:error, "workspace setup failed: #{inspect(reason)}"}
    end
  end

  defp ensure_session(tmux, session_name, cwd) do
    if tmux.has_session?(session_name), do: :ok, else: tmux.new_session(session_name, cwd)
  end

  defp capture_output(tmux, session_name) do
    case tmux.capture_pane(session_name) do
      {:ok, output} -> {:ok, output}
      {:error, _message} -> {:ok, ""}
    end
  end

  defp dependency(opts, option_key, env_key, default) do
    Keyword.get(opts, option_key) || Application.get_env(:symphony_elixir, env_key, default)
  end

  defp project_slug(%{project: %{slug: slug}}) when is_binary(slug), do: slug
  defp project_slug(_issue), do: "local"

  defp default_project_cwd(project_slug) do
    Path.join(SymphonyElixir.Config.workspace_root(), project_slug)
  end

  defp safe_segment(value, fallback) do
    value
    |> String.trim()
    |> String.replace(~r/[^a-zA-Z0-9._-]/, "_")
    |> String.trim("_")
    |> case do
      "" -> fallback
      value -> if Regex.match?(~r/[a-zA-Z0-9]/, value), do: value, else: fallback
    end
  end
end
