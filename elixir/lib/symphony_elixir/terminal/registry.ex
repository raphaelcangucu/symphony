defmodule SymphonyElixir.Terminal.Registry do
  @moduledoc """
  Issue terminal session registry backed by stable tmux session names.
  """

  alias SymphonyElixir.Codex.Session, as: CodexSession
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Terminal.Tmux
  alias SymphonyElixir.Tracker.IssueAdapter
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

  @spec dev_session_name(String.t(), String.t(), String.t()) :: String.t()
  def dev_session_name(project_slug, issue_identifier, slug)
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(slug) do
    "sym-dev-#{safe_segment(project_slug, "project")}-#{safe_segment(issue_identifier, "issue")}-#{safe_segment(slug, "server")}"
  end

  @spec open_dev_session(String.t(), String.t(), String.t(), Path.t(), keyword()) ::
          {:ok, session()} | {:error, String.t()}
  def open_dev_session(project_slug, issue_identifier, slug, cwd, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(slug) and is_binary(cwd) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    session_name = dev_session_name(project_slug, issue_identifier, slug)

    with :ok <- ensure_tmux_available(tmux),
         {:ok, _state} <- ensure_session(tmux, session_name, cwd),
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

  @spec kill_dev_session(String.t(), String.t(), String.t(), keyword()) :: :ok | {:error, String.t()}
  def kill_dev_session(project_slug, issue_identifier, slug, opts \\ []) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.kill_session(dev_session_name(project_slug, issue_identifier, slug))
  end

  @spec open_project_issue_session(String.t(), String.t(), keyword()) ::
          {:ok, session()} | {:error, String.t() | atom()}
  def open_project_issue_session(project_slug, issue_identifier, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    session_name = session_name(project_slug, issue_identifier)

    with :ok <- ensure_tmux_available(tmux) do
      if tmux.has_session?(session_name) do
        resume_issue_session(tmux, project_slug, issue_identifier, session_name, opts)
      else
        start_issue_session(project_slug, issue_identifier, opts)
      end
    end
  end

  defp resume_issue_session(tmux, project_slug, issue_identifier, session_name, opts) do
    workspace = dependency(opts, :workspace, :terminal_workspace, Workspace)
    {:ok, output} = capture_output(tmux, session_name)

    {:ok,
     %{
       project_slug: project_slug,
       issue_identifier: issue_identifier,
       session_name: session_name,
       cwd: workspace.path_for_issue(workspace_identifier(issue_identifier)),
       state: "running",
       output: output
     }}
  end

  defp start_issue_session(project_slug, issue_identifier, opts) do
    with {:ok, issue} <- fetch_issue(project_slug, issue_identifier, opts),
         {:ok, session} <- open_issue_session(issue, opts) do
      {:ok, %{session | issue_identifier: issue_identifier}}
    end
  end

  defp fetch_issue(project_slug, issue_identifier, opts) do
    case Keyword.get(opts, :issue_fetcher) do
      fetcher when is_function(fetcher, 2) -> fetcher.(project_slug, issue_identifier)
      _absent -> default_fetch_issue(project_slug, issue_identifier)
    end
  end

  defp default_fetch_issue(project_slug, issue_identifier) do
    with {:ok, project} <- Context.get_project(project_slug) do
      IssueAdapter.dispatch(project, :get_issue, [issue_identifier])
    end
  end

  @spec open_issue_session(map(), keyword()) :: {:ok, session()} | {:error, String.t()}
  def open_issue_session(%{identifier: issue_identifier} = issue, opts \\ []) when is_binary(issue_identifier) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    workspace = dependency(opts, :workspace, :terminal_workspace, Workspace)
    project_slug = project_slug(issue)
    session_name = session_name(project_slug, issue_identifier)

    with :ok <- ensure_tmux_available(tmux),
         {:ok, cwd} <- create_workspace(workspace, issue),
         {:ok, session_state} <- ensure_session(tmux, session_name, cwd) do
      resumed_session_id = maybe_resume_codex_session(tmux, session_name, cwd, session_state, opts)
      maybe_persist_agent_session(project_slug, issue_identifier, resumed_session_id)
      {:ok, output} = capture_output(tmux, session_name)

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

  # When a brand new tmux session is created for an issue, resume the agent's
  # Codex conversation in it (interactive `codex resume <id>`) if one can be
  # resolved for the workspace. Existing sessions are left untouched so we never
  # interrupt a live terminal. Returns the resolved id (or nil).
  defp maybe_resume_codex_session(tmux, session_name, cwd, :created, opts) do
    case resolve_codex_session(cwd, opts) do
      {:ok, thread_id} ->
        tmux.send_keys(session_name, "codex resume #{thread_id}\n")
        thread_id

      :error ->
        nil
    end
  end

  defp maybe_resume_codex_session(_tmux, _session_name, _cwd, :existing, _opts), do: nil

  defp resolve_codex_session(cwd, opts) do
    case Keyword.get(opts, :codex_resolver) do
      resolver when is_function(resolver, 1) -> resolver.(cwd)
      _absent -> CodexSession.resolve(cwd)
    end
  end

  # Best-effort: persist the resolved session id onto the local tracker record so
  # the UI can surface it. No-ops for trackers without a local row (e.g. GitHub).
  defp maybe_persist_agent_session(_project_slug, _issue_identifier, nil), do: :ok

  defp maybe_persist_agent_session(project_slug, issue_identifier, thread_id) do
    Context.set_agent_session_id(project_slug, issue_identifier, thread_id)
    :ok
  rescue
    _error -> :ok
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

  @spec capture_dev_session(String.t(), String.t(), String.t(), keyword()) ::
          {:ok, String.t()} | {:error, String.t()}
  def capture_dev_session(project_slug, issue_identifier, slug, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(slug) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.capture_pane(dev_session_name(project_slug, issue_identifier, slug))
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
         {:ok, _session_state} <- ensure_session(tmux, session_name, cwd),
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
    if tmux.available?(), do: :ok, else: {:error, :tmux_unavailable}
  end

  defp create_workspace(workspace, issue) do
    issue_workspace_key = Map.put(issue, :identifier, workspace_identifier(issue.identifier))

    case workspace.create_for_issue(issue_workspace_key) do
      {:ok, cwd} -> {:ok, cwd}
      {:error, reason} -> {:error, {:workspace_setup_failed, reason}}
    end
  end

  # Mirror the orchestrator workspace identifier so the issue terminal attaches to
  # the same directory the agent uses: bare tracker identifier, no project prefix,
  # and without the remote "#" issue-number marker.
  defp workspace_identifier(issue_identifier) when is_binary(issue_identifier) do
    String.trim_leading(issue_identifier, "#")
  end

  defp ensure_session(tmux, session_name, cwd) do
    if tmux.has_session?(session_name) do
      {:ok, :existing}
    else
      case tmux.new_session(session_name, cwd) do
        :ok -> {:ok, :created}
        {:error, _message} = error -> error
      end
    end
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
  defp project_slug(%{project_slug: slug}) when is_binary(slug), do: slug
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
