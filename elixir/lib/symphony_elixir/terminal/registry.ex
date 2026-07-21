defmodule SymphonyElixir.Terminal.Registry do
  @moduledoc """
  Issue terminal session registry backed by stable tmux session names.
  """

  alias SymphonyElixir.Codex.Session, as: CodexStore
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Terminal.{TabStore, Tmux}
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Workspace

  @type session :: %{
          required(:project_slug) => String.t(),
          required(:session_name) => String.t(),
          required(:cwd) => Path.t(),
          required(:state) => String.t(),
          required(:output) => String.t(),
          optional(:issue_identifier) => String.t() | nil,
          optional(:workspace_path) => Path.t()
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

  @spec dev_workspace_session_name(String.t(), Path.t(), String.t()) :: String.t()
  def dev_workspace_session_name(project_slug, workspace_path, slug)
      when is_binary(project_slug) and is_binary(workspace_path) and is_binary(slug) do
    "#{workspace_session_name(project_slug, Path.expand(workspace_path))}-dev-#{safe_segment(slug, "server")}"
  end

  @spec open_workspace_dev_session(
          String.t(),
          Path.t(),
          String.t(),
          Path.t(),
          keyword()
        ) ::
          {:ok, session()} | {:error, String.t()}
  def open_workspace_dev_session(
        project_slug,
        workspace_path,
        slug,
        cwd,
        opts \\ []
      )
      when is_binary(project_slug) and is_binary(workspace_path) and is_binary(slug) and
             is_binary(cwd) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    session_name = dev_workspace_session_name(project_slug, workspace_path, slug)

    with :ok <- ensure_tmux_available(tmux),
         {:ok, _state} <- ensure_session(tmux, session_name, cwd),
         {:ok, output} <- capture_output(tmux, session_name) do
      {:ok,
       %{
         project_slug: project_slug,
         issue_identifier: nil,
         workspace_path: Path.expand(workspace_path),
         session_name: session_name,
         cwd: cwd,
         state: "running",
         output: output
       }}
    end
  end

  @spec kill_workspace_dev_session(String.t(), Path.t(), String.t(), keyword()) ::
          :ok | {:error, String.t()}
  def kill_workspace_dev_session(project_slug, workspace_path, slug, opts \\ [])
      when is_binary(project_slug) and is_binary(workspace_path) and is_binary(slug) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.kill_session(dev_workspace_session_name(project_slug, workspace_path, slug))
  end

  @spec capture_workspace_dev_session(String.t(), Path.t(), String.t(), keyword()) ::
          {:ok, String.t()} | {:error, String.t()}
  def capture_workspace_dev_session(project_slug, workspace_path, slug, opts \\ [])
      when is_binary(project_slug) and is_binary(workspace_path) and is_binary(slug) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.capture_pane(dev_workspace_session_name(project_slug, workspace_path, slug))
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

  @spec open_workspace_session(String.t(), String.t(), keyword()) ::
          {:ok, session()} | {:error, String.t() | atom()}
  def open_workspace_session(project_slug, workspace_path, opts \\ [])
      when is_binary(project_slug) and is_binary(workspace_path) do
    expanded_path = Path.expand(workspace_path)
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    session_name = workspace_session_name(project_slug, expanded_path)

    with :ok <- ensure_workspace_directory(expanded_path),
         :ok <- ensure_tmux_available(tmux),
         {:ok, _session_state} <- ensure_session(tmux, session_name, expanded_path),
         {:ok, output} <- capture_output(tmux, session_name) do
      {:ok,
       %{
         project_slug: project_slug,
         issue_identifier: nil,
         workspace_path: expanded_path,
         session_name: session_name,
         cwd: expanded_path,
         state: "running",
         output: output
       }}
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
      _absent -> CodexStore.resolve(cwd)
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

  @spec send_input_workspace(String.t(), String.t(), String.t(), keyword()) ::
          :ok | {:error, String.t()}
  def send_input_workspace(project_slug, workspace_path, data, opts \\ [])
      when is_binary(project_slug) and is_binary(workspace_path) and is_binary(data) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.send_keys(workspace_session_name(project_slug, Path.expand(workspace_path)), data)
  end

  @spec resize_workspace(String.t(), String.t(), pos_integer(), pos_integer(), keyword()) ::
          :ok | {:error, String.t()}
  def resize_workspace(project_slug, workspace_path, cols, rows, opts \\ [])
      when is_binary(project_slug) and is_binary(workspace_path) and is_integer(cols) and
             is_integer(rows) and cols > 0 and rows > 0 do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.resize(workspace_session_name(project_slug, Path.expand(workspace_path)), cols, rows)
  end

  @spec capture_dev_session(String.t(), String.t(), String.t(), keyword()) ::
          {:ok, String.t()} | {:error, String.t()}
  def capture_dev_session(project_slug, issue_identifier, slug, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(slug) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.capture_pane(dev_session_name(project_slug, issue_identifier, slug))
  end

  @doc """
  Forward raw keyboard input (including control bytes such as Ctrl+C) to a dev
  server's tmux session, so an operator can cancel a boot and take over from
  the same shell.
  """
  @spec send_input_dev(String.t(), String.t(), String.t(), String.t(), keyword()) ::
          :ok | {:error, String.t()}
  def send_input_dev(project_slug, issue_identifier, slug, data, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(slug) and is_binary(data) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.send_keys(dev_session_name(project_slug, issue_identifier, slug), data)
  end

  @spec resize_dev(String.t(), String.t(), String.t(), pos_integer(), pos_integer(), keyword()) ::
          :ok | {:error, String.t()}
  def resize_dev(project_slug, issue_identifier, slug, cols, rows, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(slug) and
             is_integer(cols) and is_integer(rows) and cols > 0 and rows > 0 do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.resize(dev_session_name(project_slug, issue_identifier, slug), cols, rows)
  end

  @doc "Whether the dev server tmux session currently exists."
  @spec dev_session_exists?(String.t(), String.t(), String.t(), keyword()) :: boolean()
  def dev_session_exists?(project_slug, issue_identifier, slug, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(slug) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.has_session?(dev_session_name(project_slug, issue_identifier, slug))
  rescue
    _error -> false
  end

  @spec capture(String.t(), String.t(), keyword()) :: {:ok, String.t()} | {:error, String.t()}
  def capture(project_slug, issue_identifier, opts \\ []) when is_binary(project_slug) and is_binary(issue_identifier) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.capture_pane(session_name(project_slug, issue_identifier))
  end

  @spec capture_workspace(String.t(), String.t(), keyword()) ::
          {:ok, String.t()} | {:error, String.t()}
  def capture_workspace(project_slug, workspace_path, opts \\ [])
      when is_binary(project_slug) and is_binary(workspace_path) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tmux.capture_pane(workspace_session_name(project_slug, Path.expand(workspace_path)))
  end

  @spec tab_session_name(String.t(), String.t()) :: String.t()
  def tab_session_name(project_slug, tab_id) when is_binary(project_slug) and is_binary(tab_id) do
    "sym-tab-#{safe_segment(project_slug, "project")}-#{safe_segment(tab_id, "tab")}"
  end

  @spec tab_channel_topic(String.t(), String.t()) :: String.t()
  def tab_channel_topic(project_slug, tab_id) when is_binary(project_slug) and is_binary(tab_id) do
    "terminal:tab:#{project_slug}:#{tab_id}"
  end

  @spec list_tabs(String.t(), String.t()) :: {:ok, [map()]} | {:error, term()}
  def list_tabs(project_slug, issue_identifier)
      when is_binary(project_slug) and is_binary(issue_identifier) do
    tabs =
      project_slug
      |> TabStore.list(issue_identifier)
      |> Enum.map(&tab_payload/1)

    {:ok, tabs}
  end

  @spec create_tab(String.t(), String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def create_tab(project_slug, issue_identifier, attrs, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_map(attrs) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)
    tab_id = generate_tab_id()
    title = tab_title(attrs)
    command = tab_command(attrs)

    with :ok <- ensure_tmux_available(tmux),
         {:ok, cwd} <- resolve_tab_cwd(project_slug, issue_identifier, attrs, opts),
         session_name = tab_session_name(project_slug, tab_id),
         {:ok, _session_state} <- ensure_session(tmux, session_name, cwd),
         :ok <- maybe_run_command(tmux, session_name, command),
         {:ok, output} <- capture_output(tmux, session_name) do
      tab = %{
        id: tab_id,
        project_slug: project_slug,
        issue_identifier: issue_identifier,
        title: title,
        cwd: cwd,
        command: command,
        session_name: session_name,
        state: "running"
      }

      :ok = TabStore.put(tab)
      {:ok, tab_payload(Map.put(tab, :output, output))}
    end
  end

  @spec rename_tab(String.t(), String.t(), String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def rename_tab(project_slug, issue_identifier, tab_id, title)
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(tab_id) and is_binary(title) do
    trimmed = String.trim(title)

    if trimmed == "" do
      {:error, "terminal tab title is required"}
    else
      case TabStore.rename(project_slug, issue_identifier, tab_id, trimmed) do
        {:ok, tab} -> {:ok, tab_payload(tab)}
        {:error, :not_found} -> {:error, :terminal_tab_not_found}
      end
    end
  end

  @spec close_tab(String.t(), String.t(), String.t(), keyword()) :: :ok | {:error, term()}
  def close_tab(project_slug, issue_identifier, tab_id, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(tab_id) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)

    with {:ok, tab} <- TabStore.get(project_slug, tab_id),
         true <- tab.issue_identifier == issue_identifier,
         :ok <- tmux.kill_session(tab.session_name),
         :ok <- TabStore.delete(project_slug, issue_identifier, tab_id) do
      :ok
    else
      false -> {:error, :terminal_tab_not_found}
      {:error, :not_found} -> {:error, :terminal_tab_not_found}
      {:error, message} when is_binary(message) -> {:error, message}
      other -> other
    end
  end

  @spec open_tab_session(String.t(), String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def open_tab_session(project_slug, tab_id, opts \\ []) when is_binary(project_slug) and is_binary(tab_id) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)

    with :ok <- ensure_tmux_available(tmux),
         {:ok, tab} <- TabStore.get(project_slug, tab_id),
         {:ok, _session_state} <- ensure_session(tmux, tab.session_name, tab.cwd),
         {:ok, output} <- capture_output(tmux, tab.session_name) do
      {:ok, tab_payload(Map.put(tab, :output, output))}
    else
      {:error, :not_found} -> {:error, :terminal_tab_not_found}
      other -> other
    end
  end

  @spec send_input_tab(String.t(), String.t(), String.t(), keyword()) :: :ok | {:error, String.t()}
  def send_input_tab(project_slug, tab_id, data, opts \\ [])
      when is_binary(project_slug) and is_binary(tab_id) and is_binary(data) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)

    with {:ok, tab} <- TabStore.get(project_slug, tab_id) do
      tmux.send_keys(tab.session_name, data)
    else
      {:error, :not_found} -> {:error, "terminal tab not found"}
    end
  end

  @spec resize_tab(String.t(), String.t(), pos_integer(), pos_integer(), keyword()) :: :ok | {:error, String.t()}
  def resize_tab(project_slug, tab_id, cols, rows, opts \\ [])
      when is_binary(project_slug) and is_binary(tab_id) and is_integer(cols) and is_integer(rows) and cols > 0 and
             rows > 0 do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)

    with {:ok, tab} <- TabStore.get(project_slug, tab_id) do
      tmux.resize(tab.session_name, cols, rows)
    else
      {:error, :not_found} -> {:error, "terminal tab not found"}
    end
  end

  @spec capture_tab(String.t(), String.t(), keyword()) :: {:ok, String.t()} | {:error, String.t()}
  def capture_tab(project_slug, tab_id, opts \\ []) when is_binary(project_slug) and is_binary(tab_id) do
    tmux = dependency(opts, :tmux, :terminal_tmux, Tmux)

    with {:ok, tab} <- TabStore.get(project_slug, tab_id) do
      tmux.capture_pane(tab.session_name)
    else
      {:error, :not_found} -> {:error, "terminal tab not found"}
    end
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

  defp ensure_workspace_directory(workspace_path) do
    if File.dir?(workspace_path), do: :ok, else: {:error, :workspace_missing}
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

  defp workspace_session_name(project_slug, expanded_path) do
    path_hash =
      :sha256
      |> :crypto.hash(expanded_path)
      |> Base.encode16(case: :lower)
      |> binary_part(0, 12)

    "sym-workspace-#{safe_segment(project_slug, "project")}-#{path_hash}"
  end

  defp generate_tab_id do
    "tab-" <> Base.url_encode64(:crypto.strong_rand_bytes(6), padding: false)
  end

  defp tab_title(%{"title" => title}) when is_binary(title) do
    trimmed = String.trim(title)
    if trimmed == "", do: "Shell", else: trimmed
  end

  defp tab_title(_attrs), do: "Shell"

  defp tab_command(%{"command" => command}) when is_binary(command) do
    trimmed = String.trim(command)
    if trimmed == "", do: nil, else: trimmed
  end

  defp tab_command(_attrs), do: nil

  defp resolve_tab_cwd(project_slug, issue_identifier, attrs, opts) do
    case Map.get(attrs, "cwd") do
      cwd when is_binary(cwd) and cwd != "" ->
        File.mkdir_p(cwd)
        {:ok, cwd}

      _ when issue_identifier == "__project__" ->
        cwd = default_project_cwd(project_slug)
        File.mkdir_p(cwd)
        {:ok, cwd}

      _ ->
        with {:ok, issue} <- fetch_issue(project_slug, issue_identifier, opts) do
          create_workspace(dependency(opts, :workspace, :terminal_workspace, Workspace), issue)
        end
    end
  end

  defp maybe_run_command(_tmux, _session_name, nil), do: :ok

  defp maybe_run_command(tmux, session_name, command) when is_binary(command) do
    tmux.send_keys(session_name, command <> "\n")
  end

  defp tab_payload(tab) do
    %{
      id: tab.id,
      project_slug: tab.project_slug,
      issue_identifier: tab.issue_identifier,
      title: tab.title,
      cwd: tab.cwd,
      command: Map.get(tab, :command),
      session_name: tab.session_name,
      state: tab.state,
      channel_topic: tab_channel_topic(tab.project_slug, tab.id),
      output: Map.get(tab, :output, "")
    }
  end
end
