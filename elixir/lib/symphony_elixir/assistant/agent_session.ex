defmodule SymphonyElixir.Assistant.AgentSession do
  @moduledoc """
  Shared assistant turn runner for all agent backends.

  Codex is the primary backend; Claude, Cursor, and OpenCode share the same
  runner contracts through this module.
  """

  alias SymphonyElixir.Assistant.{
    FileActivityPresenter,
    GitHubAuthoring,
    History,
    IssueDocuments,
    ProjectExploreWorkspace,
    SubtaskAuthoring,
    ThreadDocuments,
    ToolCallPresenter,
    ToolExecutor
  }

  alias SymphonyElixir.Codex.DynamicTool
  alias SymphonyElixir.CodingAgent, as: RootCodingAgent
  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.{AgentPreference, InstanceConfig, ProjectConfig, Repo, Settings, Skills, Workspace}
  alias SymphonyElixir.Settings.Orchestration

  @history_limit 20

  @type turn_result :: %{
          required(:assistant_message) => String.t(),
          required(:tool_calls) => [map()],
          optional(:codex_thread_id) => String.t(),
          optional(:turn_id) => String.t()
        }

  @spec send_message(String.t(), String.t(), map(), keyword()) :: {:ok, turn_result()} | {:error, term()}
  def send_message(project_slug, message, context, opts \\ [])
      when is_binary(project_slug) and is_binary(message) and is_map(context) and is_list(opts) do
    with {:ok, trimmed_message} <- normalize_message(message),
         {:ok, workspace} <- ensure_workspace(project_slug, opts),
         {:ok, thread} <- History.ensure_thread(project_slug, %{workspace_path: workspace}),
         {:ok, history_before_turn} <- History.list_messages(project_slug),
         {:ok, user_message} <-
           History.append_message(thread, %{
             role: "user",
             content: trimmed_message,
             metadata: stringify_map(context)
           }),
         agent_kind = resolve_thread_agent(thread, context),
         opts =
           opts
           |> Keyword.put(:agent_kind, agent_kind)
           |> Keyword.put(:agent_thread_id, History.agent_thread_id(thread, agent_kind)),
         prompt <- build_prompt(project_slug, trimmed_message, context, history_before_turn),
         :ok <- maybe_call(opts, :on_message_created, History.message_payload(user_message)),
         {:ok, runner_result} <- run_codex_turn(workspace, prompt, project_slug, opts),
         {:ok, updated_thread} <- maybe_update_agent_thread(thread, runner_result, agent_kind),
         {:ok, assistant_message} <- persist_assistant_message(updated_thread, runner_result) do
      assistant_payload = History.message_payload(assistant_message)

      {:ok,
       %{
         assistant_message: assistant_message.content,
         tool_calls: assistant_message.tool_calls,
         codex_thread_id: Map.get(runner_result, :codex_thread_id) || Map.get(runner_result, "codex_thread_id"),
         turn_id: Map.get(runner_result, :turn_id) || Map.get(runner_result, "turn_id"),
         user_message: History.message_payload(user_message),
         assistant_chat_message: assistant_payload
       }}
    end
  end

  @spec send_message_to_thread(SymphonyElixir.Assistant.Thread.t(), String.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def send_message_to_thread(%{scope: "freeform", id: thread_id} = thread, message, context, opts \\ [])
      when is_binary(message) and is_map(context) and is_list(opts) do
    # Reload so that agent_thread_ids written by a prior turn (e.g. the claude cli_session_id)
    # are visible even when the caller holds a frozen struct from an earlier socket assign.
    thread = with({:ok, t} <- History.get_thread(thread_id), do: t) || thread
    agent_kind = resolve_thread_agent(thread, context)

    opts =
      opts
      |> Keyword.put(:agent_kind, agent_kind)
      |> Keyword.put(:agent_thread_id, History.agent_thread_id(thread, agent_kind))

    with {:ok, trimmed} <- normalize_message(message),
         workspace <- freeform_workspace(thread_id, opts),
         :ok <- File.mkdir_p(workspace),
         docs_before <- thread_doc_fingerprint(thread_id),
         history <- thread_id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         {:ok, user_message} <-
           History.append_message(thread, %{role: "user", content: trimmed, metadata: stringify_map(context)}),
         prompt <- build_freeform_prompt(trimmed, context, history),
         :ok <- maybe_call(opts, :on_message_created, History.message_payload(user_message)),
         {:ok, runner_result} <- run_freeform_turn(workspace, prompt, opts),
         {:ok, updated_thread} <- maybe_update_agent_thread(thread, runner_result, agent_kind),
         {:ok, assistant_message} <- persist_assistant_message(updated_thread, runner_result),
         :ok <- maybe_notify_thread_documents(thread_id, docs_before, opts) do
      {:ok,
       %{
         assistant_message: assistant_message.content,
         tool_calls: assistant_message.tool_calls,
         codex_thread_id: Map.get(runner_result, :codex_thread_id),
         turn_id: Map.get(runner_result, :turn_id),
         user_message: History.message_payload(user_message),
         assistant_chat_message: History.message_payload(assistant_message)
       }}
    end
  end

  @spec send_message_to_project_explore_thread(SymphonyElixir.Assistant.Thread.t(), String.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def send_message_to_project_explore_thread(
        %{scope: scope, id: thread_id, project_slug: project_slug} = thread,
        message,
        context,
        opts \\ []
      )
      when scope in ["project_explore", "project_session"] and is_binary(message) and is_map(context) and
             is_list(opts) do
    # Reload so that agent_thread_ids written by a prior turn are visible even
    # when the caller holds a frozen struct from an earlier socket assign.
    thread = with({:ok, t} <- History.get_thread(thread_id), do: t) || thread
    agent_kind = resolve_thread_agent(thread, context)

    opts =
      opts
      |> Keyword.put(:agent_kind, agent_kind)
      |> Keyword.put(:agent_thread_id, History.agent_thread_id(thread, agent_kind))

    with {:ok, trimmed} <- normalize_message(message),
         {:ok, workspace} <- ensure_project_explore_workspace(project_slug, thread, opts),
         history <- thread_id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         {:ok, user_message} <-
           History.append_message(thread, %{role: "user", content: trimmed, metadata: stringify_map(context)}),
         prompt <- build_project_explore_prompt(project_slug, trimmed, context, history),
         :ok <- maybe_call(opts, :on_message_created, History.message_payload(user_message)),
         {:ok, runner_result} <- run_project_explore_turn(workspace, prompt, project_slug, opts),
         {:ok, updated_thread} <- maybe_update_agent_thread(thread, runner_result, agent_kind),
         {:ok, assistant_message} <- persist_assistant_message(updated_thread, runner_result) do
      {:ok,
       %{
         assistant_message: assistant_message.content,
         tool_calls: assistant_message.tool_calls,
         codex_thread_id: Map.get(runner_result, :codex_thread_id),
         turn_id: Map.get(runner_result, :turn_id),
         user_message: History.message_payload(user_message),
         assistant_chat_message: History.message_payload(assistant_message)
       }}
    end
  end

  @kb_write_tools ~w(kb_create_page kb_update_page kb_link_task kb_delete_page kb_delete_asset kb_delete_folder)

  @spec send_message_to_kb_thread(SymphonyElixir.Assistant.Thread.t(), String.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def send_message_to_kb_thread(
        %{scope: "kb", id: thread_id, project_slug: project_slug} = thread,
        message,
        context,
        opts \\ []
      )
      when is_binary(message) and is_map(context) and is_list(opts) do
    # Reload so that agent_thread_ids written by a prior turn are visible even
    # when the caller holds a frozen struct from an earlier socket assign.
    thread = with({:ok, t} <- History.get_thread(thread_id), do: t) || thread
    agent_kind = resolve_thread_agent(thread, context)

    opts =
      opts
      |> Keyword.put(:agent_kind, agent_kind)
      |> Keyword.put(:agent_thread_id, History.agent_thread_id(thread, agent_kind))

    with {:ok, trimmed} <- normalize_message(message),
         workspace <- kb_thread_workspace(thread),
         :ok <- File.mkdir_p(workspace),
         history <- thread_id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         {:ok, user_message} <-
           History.append_message(thread, %{role: "user", content: trimmed, metadata: stringify_map(context)}),
         prompt <- build_kb_prompt(project_slug, trimmed, context, history),
         :ok <- maybe_call(opts, :on_message_created, History.message_payload(user_message)),
         {:ok, runner_result} <- run_codex_turn(workspace, prompt, project_slug, opts),
         {:ok, updated_thread} <- maybe_update_agent_thread(thread, runner_result, agent_kind),
         {:ok, assistant_message} <- persist_assistant_message(updated_thread, runner_result) do
      maybe_notify_kb_documents(assistant_message, context, opts)

      {:ok,
       %{
         assistant_message: assistant_message.content,
         tool_calls: assistant_message.tool_calls,
         codex_thread_id: Map.get(runner_result, :codex_thread_id),
         turn_id: Map.get(runner_result, :turn_id),
         user_message: History.message_payload(user_message),
         assistant_chat_message: History.message_payload(assistant_message)
       }}
    end
  end

  @spec send_message_to_issue_thread(SymphonyElixir.Assistant.Thread.t(), String.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def send_message_to_issue_thread(
        %{scope: scope, id: thread_id, project_slug: project_slug, issue_identifier: identifier} = thread,
        message,
        context,
        opts \\ []
      )
      when scope in ["issue", "issue_session"] and is_binary(message) and is_map(context) and
             is_list(opts) do
    # Reload so that agent_thread_ids written by a prior turn are visible even
    # when the caller holds a frozen struct from an earlier socket assign.
    thread = with({:ok, t} <- History.get_thread(thread_id), do: t) || thread
    agent_kind = resolve_thread_agent(thread, context)

    opts =
      opts
      |> Keyword.put(:agent_kind, agent_kind)
      |> Keyword.put(:agent_thread_id, History.agent_thread_id(thread, agent_kind))
      |> maybe_put_authoring_goal(thread, agent_kind)

    with {:ok, trimmed} <- normalize_message(message),
         {:ok, workspace} <- ensure_issue_workspace(thread),
         docs_before <- doc_fingerprint(identifier),
         history <- thread_id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         {:ok, user_message} <-
           History.append_message(thread, %{role: "user", content: trimmed, metadata: stringify_map(context)}),
         prompt <- build_issue_prompt(thread, trimmed, context, history),
         :ok <- maybe_call(opts, :on_message_created, History.message_payload(user_message)),
         {:ok, runner_result} <- run_issue_turn(workspace, prompt, project_slug, identifier, opts),
         {:ok, updated_thread} <- maybe_update_agent_thread(thread, runner_result, agent_kind),
         {:ok, assistant_message} <- persist_assistant_message(updated_thread, runner_result),
         :ok <- maybe_notify_documents(identifier, docs_before, opts) do
      {:ok,
       %{
         assistant_message: assistant_message.content,
         tool_calls: assistant_message.tool_calls,
         codex_thread_id: Map.get(runner_result, :codex_thread_id),
         turn_id: Map.get(runner_result, :turn_id),
         user_message: History.message_payload(user_message),
         assistant_chat_message: History.message_payload(assistant_message)
       }}
    end
  end

  @authoring_goal_continuation_prompt "Continue pursuing the authoring goal for this issue. Review the progress so far in this working tree, keep producing the spec/plan/analysis artifacts the objective calls for, and stop when the artifact is ready for review or you are blocked. This is authoring only: do NOT dispatch the orchestrator and do NOT change the issue's status, labels, or execution goal."

  @doc """
  Runs an autonomous authoring-goal continuation batch on an issue thread.

  Unlike `send_message_to_issue_thread/4` this does NOT append a user message: it
  resumes the thread's Codex goal and continues pursuing the objective, streaming
  each turn through the same callbacks. Used by the "resume" control so a stalled
  authoring goal can keep going without the operator typing a prompt.
  """
  @spec continue_issue_goal(SymphonyElixir.Assistant.Thread.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def continue_issue_goal(
        %{scope: "issue", id: thread_id, project_slug: project_slug, issue_identifier: identifier} = thread,
        context,
        opts \\ []
      )
      when is_map(context) and is_list(opts) do
    thread = with({:ok, t} <- History.get_thread(thread_id), do: t) || thread
    agent_kind = resolve_thread_agent(thread, context)

    cond do
      not History.thread_goal_mode(thread) ->
        {:error, :goal_mode_disabled}

      agent_kind not in [nil, "codex", :codex] ->
        {:error, :goal_not_native}

      true ->
        opts =
          opts
          |> Keyword.put(:agent_kind, agent_kind)
          |> Keyword.put(:agent_thread_id, History.agent_thread_id(thread, agent_kind))
          |> maybe_put_authoring_goal(thread, agent_kind)

        with {:ok, workspace} <- ensure_issue_workspace(thread),
             docs_before <- doc_fingerprint(identifier),
             history <- thread_id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
             prompt <- build_issue_prompt(thread, @authoring_goal_continuation_prompt, context, history),
             {:ok, runner_result} <- run_issue_turn(workspace, prompt, project_slug, identifier, opts),
             {:ok, updated_thread} <- maybe_update_agent_thread(thread, runner_result, agent_kind),
             {:ok, assistant_message} <- persist_assistant_message(updated_thread, runner_result),
             :ok <- maybe_notify_documents(identifier, docs_before, opts) do
          {:ok,
           %{
             assistant_message: assistant_message.content,
             tool_calls: assistant_message.tool_calls,
             codex_thread_id: Map.get(runner_result, :codex_thread_id),
             turn_id: Map.get(runner_result, :turn_id),
             assistant_chat_message: History.message_payload(assistant_message)
           }}
        end
    end
  end

  @spec freeform_workspace(integer() | String.t(), keyword()) :: Path.t()
  def freeform_workspace(thread_id, opts \\ []) do
    root = opts |> Keyword.get(:workspace_root, Config.workspace_root()) |> Path.expand()
    Path.join([root, "assistant", "freeform", to_string(thread_id)])
  end

  @spec freeform_workspace_root() :: Path.t()
  def freeform_workspace_root do
    Path.join([Config.workspace_root() |> Path.expand(), "assistant", "freeform"])
  end

  @spec assistant_workspace(String.t(), keyword()) :: {:ok, Path.t()} | {:error, term()}
  def assistant_workspace(project_slug, opts \\ []) when is_binary(project_slug) and is_list(opts) do
    case String.trim(project_slug) do
      "" ->
        {:error, {:missing_required_field, :project_slug}}

      trimmed ->
        root = opts |> Keyword.get(:workspace_root, Config.workspace_root()) |> Path.expand()
        {:ok, Path.join([root, "assistant", safe_project_workspace_name(trimmed)])}
    end
  end

  @spec build_prompt(String.t(), String.t(), map(), [map()]) :: String.t()
  def build_prompt(project_slug, message, context, history) do
    tracker_summary = project_tracker_summary(project_slug)

    """
    You are the Symphony Project assistant for `#{project_slug}`.

    Behave like a real conversational coding assistant inside the tracker.
    Answer naturally in the user's language. Use tracker tools only when the user asks for tracker data or a concrete tracker action.
    Prefer get_issue, get_project, get_issue_form_options, list_project_repositories, get_template, list_templates, get_workflow, and read_workspace_file over listing or searching the filesystem when you need structured project data.
    Project workflow markdown lives in the database (use get_workflow). Do not expect WORKFLOW.md in the workspace; read_workspace_file redirects that path to project settings.
    For orchestrator/dispatch questions: call get_workflow and read tracker.dispatch_states (queue for new auto-runs), active_states (polled), terminal_states, wait_states in data.config — not board status categories from get_project. Follow the workflow skill when editing workflow YAML.
    #{tracker_summary}
    Do not mirror normal chat replies as issue comments. Use add_comment when the user wants a comment on the issue; use update_issue for title/description/status changes.
    Board tools: list_issues, create_issue, get_issue, update_issue, move_issue, add_comment, list_comments, update_comment, list_pull_requests, link_pull_request, check_handoff_gate, get_evidence_status, manage_preview (status|start|stop|restart|output; optional server), list_previews, manage_tunnel (status|start), manage_dev_env, scan_project_setup, suggest_project_setup, update_project_workflow, update_project_repositories, dispatch_codex, get_agent_executions, get_issue_orchestrator_state, explain_dispatch_eligibility, list_running_agents, steer_agent, goal, manage_blockers, sync_issue, get_project, get_issue_form_options, list_project_repositories, get_workflow, read_workspace_file.
    Knowledge base tools (docs/ in each repo): kb_list_repositories, kb_search_pages, kb_read_page, kb_create_page, kb_update_page, kb_delete_page, kb_delete_asset, kb_delete_folder, kb_link_task, kb_sync. Projects can span multiple repositories; KB pages are addressed by (repository, path-within-docs). When the project has more than one repository and the user does not name one, the tool returns a remediation asking which repository — ASK the user, then retry with the `repository` argument (owner/name, workspace path, or slug). Use kb_search_pages before creating pages to avoid duplicates, kb_create_page for new pages and kb_update_page for existing ones, and kb_link_task to reference a tracker issue inside a page. KB writes save directly to the active working tree; kb_sync is a no-op compatibility hook. The delete tools (kb_delete_page, kb_delete_asset, kb_delete_folder) are destructive — kb_delete_folder removes a directory and everything inside it — so confirm the exact target with the user before calling them.
    Before moving an issue to a handoff/wait status, call check_handoff_gate. After writing evidence, call get_evidence_status. For preview: list_previews to discover; manage_preview status/output on crash (optional server); manage_tunnel start for public URLs; manage_dev_env when no_serve_step, then manage_preview start|status.
    To explain why an issue is or isn't auto-dispatched, call explain_dispatch_eligibility; for live running/retry/idle state call get_issue_orchestrator_state. To see every agent executing right now call list_running_agents, and steer_agent to inject a message into a running agent's turn. After opening a PR call link_pull_request. Manage dependencies with manage_blockers; pull external tracker edits with sync_issue.
    If the user asks for coding work, create or update tracker context first. Only call dispatch_codex when the user explicitly asks to start agent execution — never auto-dispatch after create_issue.
    When the user attaches an image or file, it is already saved in this project. If they want it on a task (e.g. in the description), embed it using the exact Markdown URL given in the attachment note (`![alt](URL)` for images) when you call create_issue/update_issue/add_comment — never just describe it in words.
    create_issue places new work in Backlog (intake) by default — omit status. Do not create directly in orchestrator queue statuses (e.g. Todo); use move_issue when the issue is ready for execution.
    #{github_create_issue_guidance(project_slug)}
    To assign someone, call get_issue_form_options and pass assignee_ids (GitHub login or remote id) on create_issue/update_issue — never use linear_graphql on non-Linear projects.
    If a request is ambiguous, ask one concise clarifying question before taking action.

    Recent conversation:
    #{format_history(history)}

    Context:
    #{inspect(context)}

    Current user message:
    #{message}
    """
    |> String.trim()
  end

  defp ensure_workspace(project_slug, opts) do
    with {:ok, workspace} <- assistant_workspace(project_slug, opts),
         :ok <- File.mkdir_p(workspace) do
      {:ok, workspace}
    end
  end

  defp run_codex_turn(workspace, prompt, project_slug, opts) do
    runner = Keyword.get(opts, :runner, &default_runner/4)

    runner_opts =
      opts
      |> Keyword.put(:project_slug, project_slug)
      |> Keyword.put_new(:dynamic_tools, ToolExecutor.combined_tool_specs())
      |> Keyword.put_new(:tool_executor, ToolExecutor.combined_codex_tool_executor(project_slug))
      |> maybe_put_project_codex_config(project_slug)

    runner.(workspace, prompt, assistant_issue(project_slug), runner_opts)
    |> normalize_runner_result()
  end

  defp run_project_explore_turn(workspace, prompt, project_slug, opts) do
    runner = Keyword.get(opts, :runner, &default_runner/4)

    runner_opts =
      opts
      |> Keyword.put(:project_slug, project_slug)
      |> Keyword.put_new(:dynamic_tools, ToolExecutor.combined_tool_specs())
      |> Keyword.put_new(:tool_executor, ToolExecutor.combined_codex_tool_executor(project_slug))
      |> maybe_put_project_codex_config(project_slug)

    runner.(workspace, prompt, project_explore_issue(project_slug), runner_opts)
    |> normalize_runner_result()
  end

  defp run_freeform_turn(workspace, prompt, opts) do
    runner = Keyword.get(opts, :runner, &default_runner/4)

    runner_opts =
      opts
      |> Keyword.put_new(:dynamic_tools, ToolExecutor.freeform_tool_specs())
      |> Keyword.put_new(:tool_executor, ToolExecutor.freeform_codex_tool_executor())
      |> maybe_put_instance_codex_config()

    runner.(workspace, prompt, freeform_issue(), runner_opts)
    |> normalize_runner_result()
  end

  # Honor the working tree persisted on the issue thread so the authoring turn writes where the
  # document viewer reads. If that path is unusable (e.g. a thread created while a divergent serve
  # pointed at another workspace root), recompute the canonical issue tree, repair the thread so
  # reads and writes realign, and continue instead of failing the turn.
  defp ensure_issue_workspace(%{workspace_path: path, issue_identifier: identifier} = thread)
       when is_binary(path) and path != "" do
    issue_ref = issue_workspace_ref(Map.get(thread, :project_slug), identifier)

    case Workspace.ensure_at(path, issue_ref) do
      {:ok, workspace} -> {:ok, workspace}
      {:error, _reason} -> heal_issue_workspace(thread, issue_ref)
    end
  end

  defp ensure_issue_workspace(%{issue_identifier: identifier} = thread) do
    heal_issue_workspace(thread, issue_workspace_ref(Map.get(thread, :project_slug), identifier))
  end

  defp heal_issue_workspace(thread, issue_ref) do
    with {:ok, workspace} <- Workspace.create_for_issue(issue_ref) do
      repair_thread_workspace_path(thread, workspace)
      {:ok, workspace}
    end
  end

  # Carry the thread's known project into workspace resolution so tree creation and
  # the coding-agent cwd guard agree on the SAME per-project root. The bare identifier
  # alone forces a `find_project_slug/1` lookup that returns nil for ambiguous or
  # non-local (e.g. GitHub) identifiers, silently falling back to the global workspace
  # root and tripping `:invalid_workspace_cwd`.
  defp issue_workspace_ref(project_slug, identifier) do
    %{id: nil, identifier: identifier, project_slug: project_slug}
  end

  defp repair_thread_workspace_path(%{workspace_path: current} = thread, workspace)
       when current != workspace do
    case History.update_thread(thread, %{workspace_path: workspace}) do
      {:ok, _updated} -> :ok
      {:error, _reason} -> :ok
    end
  end

  defp repair_thread_workspace_path(_thread, _workspace), do: :ok

  defp run_issue_turn(workspace, prompt, project_slug, identifier, opts) do
    runner = Keyword.get(opts, :runner, &default_runner/4)

    runner_opts =
      opts
      |> Keyword.put(:project_slug, project_slug)
      |> Keyword.put_new(:workspace_root, Workspace.workspace_root_for(issue_workspace_ref(project_slug, identifier)))
      |> Keyword.put(:dynamic_tools, ToolExecutor.issue_bound_tool_specs(identifier) ++ DynamicTool.tool_specs())
      |> Keyword.put(:tool_executor, ToolExecutor.issue_bound_combined_codex_tool_executor(project_slug, identifier))
      |> maybe_put_project_codex_config(project_slug)

    runner.(workspace, prompt, assistant_issue(project_slug), runner_opts)
    |> normalize_runner_result()
  end

  # Freeform chats have no project; they use instance-level codex settings
  # (SYMPHONY_CODEX_* env). Per-project overrides come from workflow_markdown in the DB.
  defp maybe_put_project_codex_config(opts, project_slug) when is_binary(project_slug) do
    project_codex = resolve_project_codex_config(project_slug) || %{}
    Keyword.put_new(opts, :codex_config, InstanceConfig.merge_codex_section(project_codex))
  end

  defp maybe_put_project_codex_config(opts, _project_slug), do: maybe_put_instance_codex_config(opts)

  defp maybe_put_instance_codex_config(opts) do
    Keyword.put_new(opts, :codex_config, InstanceConfig.codex_section())
  end

  defp resolve_project_codex_config(project_slug) do
    case Context.get_project(project_slug) do
      {:ok, project} -> project |> Repo.preload(:setup) |> ProjectConfig.resolve() |> Map.get(:codex)
      _ -> nil
    end
  end

  defp freeform_issue, do: %{id: "assistant:freeform", identifier: "freeform", title: "Freeform assistant chat"}

  defp project_explore_issue(project_slug),
    do: %{id: "assistant:explore:#{project_slug}", identifier: project_slug, title: "Project explore assistant"}

  defp ensure_project_explore_workspace(project_slug, %{workspace_path: path}, opts)
       when is_binary(path) and path != "" do
    case Workspace.ensure_at(path, ProjectExploreWorkspace.path(project_slug)) do
      {:ok, workspace} -> {:ok, workspace}
      {:error, _reason} -> ProjectExploreWorkspace.ensure(project_slug, opts)
    end
  end

  defp ensure_project_explore_workspace(project_slug, _thread, opts),
    do: ProjectExploreWorkspace.ensure(project_slug, opts)

  defp build_project_explore_prompt(project_slug, message, context, history) do
    orchestrator_summary = orchestrator_config_summary(project_slug)

    """
    You are the Symphony project explore assistant for `#{project_slug}`.
    You are running inside the project's working tree. The repositories are cloned here on their default integration branches.
    Behave like a real conversational coding assistant. Answer naturally in the user's language.
    Help the user understand the codebase, architecture, conventions, and Symphony project configuration.
    Read and search files as needed.

    Workflow and orchestrator (Symphony tracker):
    - Project workflow lives in the database — call get_workflow, not WORKFLOW.md in the repo.
    - get_project status categories (unstarted/started/completed) are board UI metadata; they do NOT define orchestrator dispatch.
    - Orchestrator reads YAML front matter: tracker.dispatch_states (queue for NEW auto-runs), tracker.active_states (polled candidates), tracker.wait_states, tracker.terminal_states.
    - Global gates: require_symphony_label and require_assignee_match (Settings).
    - When changing dispatch behavior, use update_project_workflow and preserve/update the tracker.* YAML keys — body prose alone does not change auto-dispatch.
    - Follow the workflow skill for full contract and debugging steps.

    #{orchestrator_summary}

    Tools: get_workflow, get_project, list_project_repositories, get_template, list_templates, read_workspace_file, list_issues, get_issue, update_project_workflow, update_project_repositories, and other tracker tools when needed.
    Do not create or update tracker issues unless the user explicitly asks. Do not dispatch Codex execution unless asked.
    Do not post issue comments - your replies are shown to the user directly in this chat.
    Prefer answering questions and exploring the code over making changes; only edit files when the user clearly wants that.

    Recent conversation:
    #{format_history(history)}

    Context:
    #{inspect(context)}

    Current user message:
    #{message}
    """
    |> String.trim()
  end

  @kb_body_limit 20_000

  defp build_kb_prompt(project_slug, message, context, history) do
    kb = kb_context(context)
    repo = Map.get(kb, "repoSlug") || Map.get(kb, "repo_slug") || ""
    path = Map.get(kb, "pagePath") || Map.get(kb, "page_path") || ""
    title = Map.get(kb, "title") || ""
    body = kb |> Map.get("body") |> truncate_kb_body()
    selection = kb |> Map.get("selection") |> normalize_kb_selection()

    """
    You are the Symphony Knowledge Base assistant for project `#{project_slug}`.
    You help the user write and maintain THIS knowledge base page, like a Notion AI side chat. Answer naturally in the user's language. Keep doc edits small and reviewable, and always say which repository and path you changed.

    The page the user is currently editing is already loaded for you:
    - Repository: #{repo}
    - Path: #{path}
    - Title: #{title}
    #{kb_selection_block(selection)}
    Current page content:
    ----------------------------------------
    #{body}
    ----------------------------------------

    Knowledge base tools (docs/ in each repo): kb_list_repositories, kb_search_pages, kb_read_page, kb_create_page, kb_update_page, kb_delete_page, kb_delete_asset, kb_delete_folder, kb_link_task, kb_sync. Pages are addressed by (repository, path-within-docs).
    To edit THIS page, call kb_update_page with repository "#{repo}" and path "#{path}" (it already exists — never kb_create_page it). Pass that repository explicitly so you never need to ask which repository. Use kb_search_pages/kb_read_page to consult other pages, kb_create_page only for brand-new pages, and kb_link_task to reference a tracker issue inside a page. KB writes save directly to the working tree; kb_sync is a no-op compatibility hook. Use kb_delete_page/kb_delete_asset/kb_delete_folder to remove content — they are destructive (kb_delete_folder deletes a whole directory and its contents), so confirm the exact target with the user first.
    You also have the project board tools (list_issues, create_issue, update_issue, add_comment, ...) for tracker actions when the user asks. Do not dispatch coding agents unless explicitly asked. Your replies are shown directly in this chat — do not mirror them as issue comments.
    If a request is ambiguous, ask one concise clarifying question first.

    Recent conversation:
    #{format_history(history)}

    Current user message:
    #{message}
    """
    |> String.trim()
  end

  defp kb_context(context) when is_map(context) do
    case Map.get(context, "kb") || Map.get(context, :kb) do
      kb when is_map(kb) -> kb
      _ -> %{}
    end
  end

  defp kb_context(_context), do: %{}

  defp truncate_kb_body(body) when is_binary(body) do
    if String.length(body) > @kb_body_limit do
      String.slice(body, 0, @kb_body_limit) <> "\n\n…(truncated; use kb_read_page for the full document)"
    else
      body
    end
  end

  defp truncate_kb_body(_body), do: "(empty page)"

  defp normalize_kb_selection(selection) when is_binary(selection) do
    case String.trim(selection) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_kb_selection(_selection), do: nil

  defp kb_selection_block(nil), do: ""

  defp kb_selection_block(selection) do
    "- The user has selected this text (focus your help here when relevant):\n  \"\"\"\n  #{selection}\n  \"\"\"\n"
  end

  defp kb_thread_workspace(%{workspace_path: path}) when is_binary(path) and path != "", do: path

  defp kb_thread_workspace(_thread) do
    Path.join([Config.workspace_root() |> Path.expand(), "assistant", "kb", "default"])
  end

  defp maybe_notify_kb_documents(%{tool_calls: tool_calls}, context, opts) when is_list(tool_calls) do
    if Enum.any?(tool_calls, &kb_write_tool_call?/1) do
      identifier = kb_context(context) |> Map.get("pagePath") || "kb"
      _ = maybe_call(opts, :on_documents_changed, identifier)
    end

    :ok
  end

  defp maybe_notify_kb_documents(_assistant_message, _context, _opts), do: :ok

  defp kb_write_tool_call?(tool_call) when is_map(tool_call) do
    # Name-only: any kb write tool invocation triggers a reload. Reloading after a
    # failed/partial write is harmless (the editor just re-reads the same content),
    # so this avoids depending on the exact tool-call status shape.
    name = Map.get(tool_call, "name") || Map.get(tool_call, :name)
    name in @kb_write_tools
  end

  defp kb_write_tool_call?(_tool_call), do: false

  defp orchestrator_config_summary(project_slug) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        project = Repo.preload(project, :setup)
        config = ProjectConfig.resolve(project)

        """
        Resolved orchestrator config for `#{project_slug}` (from stored workflow YAML):
        - dispatch_states (new auto-runs): #{inspect(config.dispatch_states)}
        - active_states (polled): #{inspect(config.active_states)}
        - wait_states: #{inspect(config.wait_states)}
        - terminal_states: #{inspect(config.terminal_states)}
        - require_symphony_label: #{Orchestration.require_symphony_label?()}
        - require_assignee_match: #{Orchestration.require_assignee_match?()}
        """

      _ ->
        ""
    end
  end

  defp github_create_issue_guidance(project_slug) do
    case GitHubAuthoring.create_issue_guidance_for_slug(project_slug) do
      "" -> ""
      text -> text <> "\n"
    end
  end

  defp project_tracker_summary(project_slug) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        project = Repo.preload(project, :setup)
        config = ProjectConfig.resolve(project)
        kind = project.tracker_kind || "local"
        dispatch_states = config.dispatch_states || []

        tracker_tools =
          case kind do
            "github" ->
              "This project uses GitHub Projects (tracker_kind: github). Use github_graphql, get_issue_form_options, list_project_repositories, and Symphony board tools — never linear_graphql or list_linear_projects for this project's issues. On multi-repo boards, create_issue/create_draft_issue require repository (owner/name) unless the task belongs in tracker.config.repo."

            "linear" ->
              "This project uses Linear (tracker_kind: linear). Use linear_graphql and Symphony board tools for issue operations."

            "jira" ->
              "This project uses Jira (tracker_kind: jira). Use Symphony board tools for issue operations."

            _ ->
              "This project uses the local tracker (tracker_kind: #{kind})."
          end

        """
        Project tracker:
        - tracker_kind: #{kind}
        - orchestrator queue (dispatch_states): #{inspect(dispatch_states)}
        #{tracker_tools}
        For GitHub/Jira project setup (not this board's issues), use list_github_projects / provision_github_project with Symphony's server token — do not run gh/curl in the shell.
        """

      _ ->
        ""
    end
  end

  defp build_freeform_prompt(message, context, history) do
    """
    You are the Symphony freeform assistant. There is no existing project or repository context.
    Behave like a real conversational coding assistant. Answer naturally in the user's language.

    Tools available in this chat. Always pass `project_slug` (from list_tracker_projects) for board operations.

    Discovery (local first, then remotes): list_tracker_projects, list_linear_projects, list_jira_projects, list_github_projects.
    Create projects: create_tracker_project (local only), create_github_tracker_project, provision_github_project.

    Board / issues (require project_slug): list_issues, create_issue, get_issue, update_issue, move_issue, add_comment,
    list_comments, update_comment, list_pull_requests, link_pull_request, check_handoff_gate, get_evidence_status,
    manage_preview (action: status|start|stop|restart|output; optional server), list_previews, manage_tunnel (status|start), manage_dev_env, scan_project_setup, suggest_project_setup,
    dispatch_codex, get_agent_executions, get_issue_orchestrator_state, explain_dispatch_eligibility,
    list_running_agents, steer_agent, goal, manage_blockers,
    sync_issue, get_project, list_project_repositories, get_workflow, read_workspace_file,
    update_project_workflow, update_project_repositories.

    Diagnose / repair: explain_dispatch_eligibility (why an issue isn't dispatching), get_issue_orchestrator_state
    (live running/retry/idle), list_running_agents (every agent executing now), steer_agent (inject a message into a
    running agent's turn), manage_blockers (blocked_by relations), sync_issue (pull external tracker edits).

    Knowledge base (require project_slug; docs/ in each repo): kb_list_repositories, kb_search_pages, kb_read_page,
    kb_create_page, kb_update_page, kb_delete_page, kb_delete_asset, kb_delete_folder, kb_link_task, kb_sync. Project/freeform KB writes save to the project working tree; issue-bound KB reads/writes save to the issue working tree. kb_sync is a no-op compatibility hook. Projects can
    span multiple repositories; when more than one is linked and the user does not name one, the tool returns a remediation
    asking which repository — ASK, then retry with the `repository` argument. Search before creating to avoid duplicates.
    The delete tools are destructive (kb_delete_folder removes a directory and everything inside it) — confirm the target first.

    Project setup flow: scan_project_setup → suggest_project_setup → update_project_workflow / update_project_repositories,
    then manage_dev_env (propose_steps|save_steps|run) before manage_preview for serve URLs; use list_previews to inventory and manage_tunnel start for public links.

    Templates: list_templates, get_template (use exact slugs from list_templates, e.g. multi-repo-fullstack). GraphQL escape hatches: github_graphql, linear_graphql.
    Use these structured tools instead of shell commands (gh, curl, ps) for tracker setup, discovery, and board actions.

    Recent conversation:
    #{format_history(history)}

    Context:
    #{inspect(context)}

    Current user message:
    #{message}
    """
    |> String.trim()
  end

  defp build_issue_prompt(%{metadata: metadata, issue_identifier: identifier, project_slug: project_slug}, message, context, history) do
    goal_mode = Map.get(metadata || %{}, "goal_mode", false) == true
    goal_objective = Map.get(metadata || %{}, "goal_objective")
    github_create = github_create_issue_guidance(project_slug)

    base = """
    You are the Symphony issue authoring assistant for `#{project_slug}`, working on issue `#{identifier}`.
    You are running inside the issue's working tree (the project repositories are cloned here).
    In this issue chat, knowledge-base page reads/writes (`kb_read_page`, `kb_create_page`, `kb_update_page`, `kb_link_task`) target the issue working tree so docs changed for this task are kept with the task branch.
    Answer in the user's language.
    Dispatching happens through this chat: only when the user explicitly asks to dispatch, start, or hand off the work, call the dispatch_codex tool for `#{identifier}` with concrete instructions. That moves the issue to In Progress so the orchestrator executes it (the orchestrator carries the issue's execution goal). Never dispatch on your own.
    Dispatch automatically assigns the issue to the connected GitHub user and applies the resolved agent's `symphony:*` label when missing, including child_run subtasks listed in the execution bundle — you do not need to set assignee or symphony labels manually before dispatch.
    Use goal (context authoring) to set, adjust, pause, resume, or clear the chat goal; use context execution only when the user explicitly asks to change the orchestrator execution goal.
    Do not mirror normal chat replies as issue comments — your replies are shown to the user directly in this chat.
    Use add_comment only when the user explicitly asks to post a comment on the issue; use update_issue for title, description, status, and assignee changes.

    When to call update_issue:
    - Plan or acceptance criteria are defined and stable
    - A discovery changes the implementation approach
    - Final enrichment when authoring is complete (executive summary + links to spec/plan/handoff)
    - The user explicitly asks to save something to the issue

    Do NOT call update_issue during:
    - Ongoing exploration (reading code, confirming components, tracing routes)
    - Unconfirmed hypotheses
    - Technical context that helps understanding but does not yet change what will be done

    Keep exploratory findings in this chat until they meet the criteria above.
    The issue description should reflect stable decisions, not a live investigation log.

    New issues belong in Backlog (intake) unless the user asks for a different status — omit status on create_issue or set status to Backlog; do not default to Todo or dispatch Codex unless the user explicitly asks.
    When splitting work into subtasks or creating related issues, use create_issue (or create_draft_issue before anchoring). Do not assume every new task belongs in the same repository as the parent issue.
    #{github_create}
    Assignees: call get_issue_form_options and use assignee_ids on update_issue — never linear_graphql on non-Linear projects.

    #{SubtaskAuthoring.guidance()}

    Recent conversation:
    #{format_history(history)}

    Context:
    #{inspect(context)}

    Current user message:
    #{message}
    """

    methodology_section = """

    Authoring methodology — choose depth from the conversation (no fixed mode):
    #{Skills.load(["brainstorming", "writing-plans"])}

    Decide the authoring depth from what the user asks for:
    - Quick brief or enriched description only: search the repositories in this working tree for relevant
      context (README, code, conventions) and call update_issue for `#{identifier}` once the description is
      stable and agreed in chat — not while still exploring or confirming hypotheses. Do not create spec/plan files.
    - Brainstorming, design, or implementation planning: **choose a git repository** in this working tree
      first (e.g. `back/`, `front/`), then write specs to `<repo>/docs/superpowers/specs/` and plans to
      `<repo>/docs/superpowers/plans/` inside that repo. Prefer the repo that owns the change (or the same
      repo as related existing specs); ask the user which repo if unclear. Never write to the workspace-root
      `docs/` folder — it is outside git and will not appear in Diff / changed-docs. Use section-by-section
      approval in chat. Codex is a coding agent; when the user explicitly asks to skip spec/plan work or
      authorizes implementation, acknowledge that direction and you may proceed directly to code.
    - When the task is ready for handoff: write a concise `<repo>/docs/superpowers/handoff.md` (key decisions +
      current state) in the same chosen repo and enrich the issue description (executive summary + links to
      spec/plan files) via update_issue — not before.
    Do not call update_issue while still exploring or before spec/plan sections are agreed in chat (when doing design work).
    State which depth you are taking and proceed.
    """

    String.trim(base <> methodology_section <> goal_mode_section(goal_mode, identifier, goal_objective))
  end

  defp goal_mode_section(false, _identifier, _objective), do: ""

  defp goal_mode_section(true, _identifier, objective) do
    objective_line =
      case normalize_goal_objective(objective) do
        nil ->
          "Derive the objective from the issue artifacts in this working tree (the executive " <>
            "summary, the spec's constraints, and the plan's verification steps)."

        text ->
          "Objective: #{text}"
      end

    """

    AUTHORING GOAL: ACTIVE (Codex long-running, in this conversation). You are pursuing a chat
    goal directly inside this authoring thread — keep working toward the objective across turns
    until the artifact is ready for review or you are blocked. #{objective_line}
    This is authoring only: do NOT dispatch the orchestrator and do NOT change the issue's status,
    labels, or execution goal. Produce the spec/plan/analysis artifacts the objective calls for.
    """
  end

  defp normalize_goal_objective(objective) when is_binary(objective) do
    case String.trim(objective) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_goal_objective(_), do: nil

  # Native Codex goals only apply to the codex agent. `agent_kind` arrives as a
  # string ("codex") from AgentPreference.normalize/1, so we must accept the
  # string form here — comparing against the bare `:codex` atom silently skipped
  # injection and left the authoring goal "enabled" without ever running.
  defp maybe_put_authoring_goal(opts, thread, agent_kind) do
    cond do
      agent_kind not in [nil, "codex", :codex] ->
        opts

      not History.thread_goal_mode(thread) ->
        opts

      true ->
        objective = History.thread_goal_objective(thread) || "Complete the authoring objective for this issue."
        Keyword.put(opts, :goal, objective)
    end
  end

  defp default_runner(workspace, prompt, issue, opts) do
    agent_kind = Keyword.get(opts, :agent_kind)

    with {:ok, session} <- RootCodingAgent.start_session(workspace, agent_kind, opts) do
      # Resume a claude session if a prior backend thread id is known.
      # For codex sessions the map gets an extra key that Codex.CodingAgent ignores harmlessly.
      session =
        case Keyword.get(opts, :agent_thread_id) do
          id when is_binary(id) -> Map.put(session, :cli_session_id, id)
          _ -> session
        end

      {:ok, collector} = Agent.start_link(fn -> %{assistant_message: "", tool_calls: []} end)

      try do
        on_message = fn message ->
          maybe_forward_turn_started(message, opts)
          relay_codex_event(message, collector, opts)

          case Keyword.get(opts, :on_message) do
            callback when is_function(callback, 1) -> callback.(message)
            _ -> :ok
          end
        end

        case RootCodingAgent.run_turn(session, prompt, issue, Keyword.put(opts, :on_message, on_message)) do
          {:ok, result} ->
            collected = Agent.get(collector, & &1)

            {:ok,
             result
             |> Map.put(:assistant_message, fallback_assistant_message(collected.assistant_message, agent_kind))
             |> Map.put(:tool_calls, collected.tool_calls)}

          {:error, reason} ->
            {:error, reason}
        end
      after
        Agent.stop(collector)
        RootCodingAgent.stop_session(session, Keyword.get(opts, :agent_kind))
      end
    end
  end

  # credo:disable-for-lines:120
  # credo:disable-for-next-line Credo.Check.Refactor.CyclomaticComplexity
  defp relay_codex_event(message, collector, opts) when is_map(message) do
    payload = event_payload(message)
    method = Map.get(payload, "method") || Map.get(payload, :method)
    file_activity = FileActivityPresenter.from_event(message)

    cond do
      match?({:started, _}, file_activity) ->
        {:started, tool_call} = file_activity
        maybe_call(opts, :on_tool_call_started, tool_call)

      match?({:completed, _}, file_activity) ->
        {:completed, tool_call} = file_activity

        Agent.update(collector, fn state ->
          tool_calls =
            upsert_tool_call_by_id(
              state.tool_calls,
              Map.get(tool_call, :id),
              tool_call,
              fn -> Map.get(tool_call, :name) end
            )

          %{state | tool_calls: tool_calls}
        end)

        maybe_call(opts, :on_tool_call_completed, tool_call)

      method == "item/agentMessage/delta" ->
        case extract_delta(payload) do
          delta when is_binary(delta) and delta != "" ->
            Agent.update(collector, fn state -> %{state | assistant_message: state.assistant_message <> delta} end)
            maybe_call(opts, :on_assistant_delta, delta)

          _ ->
            :ok
        end

      Map.get(message, :event) == :tool_call_started ->
        tool_call = tool_call_from_payload(payload, :tool_call_started, %{})
        maybe_call(opts, :on_tool_call_started, tool_call)

      Map.get(message, :event) in [:tool_call_completed, :tool_call_failed, :unsupported_tool_call] ->
        tool_call = tool_call_from_payload(payload, Map.get(message, :event), Map.get(message, :result) || %{})
        Agent.update(collector, fn state -> %{state | tool_calls: upsert_tool_call(state.tool_calls, tool_call)} end)
        maybe_call(opts, :on_tool_call_completed, tool_call)

      Map.get(message, :event) == :user_input_required ->
        maybe_call(opts, :on_user_input_required, %{
          request_id: Map.get(message, :request_id),
          item_id: Map.get(message, :item_id),
          questions: Map.get(message, :questions) || []
        })

      Map.get(message, :event) == :approval_required ->
        maybe_call(opts, :on_approval_required, approval_request_from_event(message, payload, method))

      match?(%{}, goal = goal_from_codex_event(message)) ->
        maybe_call(opts, :on_goal_updated, goal)

      # The Claude adapter streams partial assistant text as item/progress deltas.
      # Forward them for live token streaming in the UI. The persisted message is
      # assembled from the final item/created text item below, so we don't accumulate
      # the delta into the collector here (that would double the text).
      Map.get(message, :event) == :notification and method == "item/progress" ->
        delta = get_in(payload, ["params", "delta", "text"]) || get_in(payload, [:params, :delta, :text])

        if is_binary(delta) and delta != "" do
          maybe_call(opts, :on_assistant_delta, delta)
        end

      # Claude adapter emits tool activity as :notification events with method "item/created".
      # Route tool_call items through the same upsert/callback path as :tool_call_started,
      # and tool_result items through the :tool_call_completed path, so chips reach the relay.
      Map.get(message, :event) == :notification and method == "item/created" ->
        item = get_in(payload, ["params", "item"]) || get_in(payload, [:params, :item]) || %{}
        item_type = Map.get(item, "type") || Map.get(item, :type)

        cond do
          item_type == "tool_call" ->
            id = Map.get(item, "tool_use_id") || Map.get(item, :tool_use_id)
            raw_name = Map.get(item, "name") || Map.get(item, :name) || "unknown"
            name = String.replace_prefix(raw_name, "mcp__symphony__", "")
            input = Map.get(item, "input") || Map.get(item, :input) || %{}
            tool_call = %{name: name, status: "running", arguments: input, output: nil, result: %{}, id: id}

            # Upsert by tool_use_id, not name: a turn can issue many same-named calls
            # (e.g. several Bash commands) and each must keep its own row.
            Agent.update(collector, fn state ->
              %{state | tool_calls: upsert_tool_call_by_id(state.tool_calls, id, tool_call, fn -> name end)}
            end)

            maybe_call(opts, :on_tool_call_started, tool_call)

          item_type == "tool_result" ->
            id = Map.get(item, "tool_use_id") || Map.get(item, :tool_use_id)
            content = Map.get(item, "content") || Map.get(item, :content) || ""
            is_error = Map.get(item, "is_error") || Map.get(item, :is_error) || false
            status = if is_error, do: "error", else: "complete"
            output = format_cursor_tool_output(content)

            # A Claude/Cursor tool_result carries no tool name — only the paired tool_call
            # (started) event does. Leave :name unset so the by-id merge preserves the name
            # captured at start; only fall back to inference when this result has no started
            # entry to merge into. Setting an eager "unknown" here would clobber "Bash".
            update =
              %{status: status, output: output, result: %{}, id: id}
              |> put_present(:name, claude_tool_name(Map.get(item, "name") || Map.get(item, :name)))
              |> put_present(:arguments, Map.get(item, "input") || Map.get(item, :input))

            merged =
              Agent.get_and_update(collector, fn state ->
                tool_calls =
                  upsert_tool_call_by_id(state.tool_calls, id, update, fn -> infer_cursor_tool_name(content) end)

                {Enum.find(tool_calls, &(Map.get(&1, :id) == id)), %{state | tool_calls: tool_calls}}
              end)

            maybe_call(
              opts,
              :on_tool_call_completed,
              merged || ensure_tool_name(update, fn -> infer_cursor_tool_name(content) end)
            )

          # The Claude adapter delivers finalized assistant text as an item/created
          # "text" item (the authoritative full text of a message block). Accumulate it
          # so the reply reaches the persisted assistant message. Live token streaming
          # is handled separately via "item/progress" deltas, so we do NOT also append
          # those here (that would double the text).
          item_type == "text" ->
            text = Map.get(item, "text") || Map.get(item, :text) || ""

            if is_binary(text) and text != "" do
              Agent.update(collector, fn state -> %{state | assistant_message: state.assistant_message <> text} end)
            end

          true ->
            :ok
        end

      true ->
        :ok
    end
  end

  defp relay_codex_event(_message, _collector, _opts), do: :ok

  defp event_payload(message) when is_map(message) do
    case Map.get(message, :payload) || Map.get(message, "payload") do
      payload when is_map(payload) -> payload
      _ -> %{}
    end
  end

  defp event_payload(_message), do: %{}

  defp approval_request_from_event(message, payload, method) do
    params = Map.get(payload, "params") || Map.get(payload, :params) || %{}

    %{
      request_id: Map.get(message, :request_id) || Map.get(payload, "id") || Map.get(payload, :id),
      decision: Map.get(message, :decision),
      command: approval_command(params),
      cwd: Map.get(params, "cwd") || Map.get(params, :cwd),
      reason: Map.get(params, "reason") || Map.get(params, :reason) || method
    }
  end

  defp approval_command(params) when is_map(params) do
    Map.get(params, "command") ||
      Map.get(params, :command) ||
      Map.get(params, "cmd") ||
      Map.get(params, :cmd) ||
      Map.get(params, "shellCommand") ||
      Map.get(params, :shellCommand)
  end

  defp approval_command(_params), do: nil

  # credo:disable-for-next-line Credo.Check.Refactor.CyclomaticComplexity
  defp goal_from_codex_event(message) when is_map(message) do
    payload = event_payload(message)
    method = Map.get(payload, "method") || Map.get(payload, :method)

    goal =
      case method do
        "thread/goal/updated" ->
          get_in(payload, ["params", "goal"]) || get_in(payload, [:params, :goal])

        "turn/completed" ->
          get_in(payload, ["params", "goal"]) || get_in(payload, [:params, :goal])

        _ ->
          if Map.get(message, :event) == :turn_completed do
            get_in(payload, ["params", "goal"]) || get_in(payload, [:params, :goal])
          else
            nil
          end
      end

    if is_map(goal), do: goal, else: nil
  end

  defp goal_from_codex_event(_message), do: nil

  defp maybe_forward_turn_started(message, opts) when is_map(message) do
    if Map.get(message, :event) == :session_started do
      turn_id = Map.get(message, :turn_id) || Map.get(message, "turn_id")

      case Keyword.get(opts, :on_turn_started) do
        callback when is_function(callback, 1) and is_binary(turn_id) -> callback.(turn_id)
        _ -> :ok
      end
    end

    :ok
  end

  defp maybe_forward_turn_started(_message, _opts), do: :ok

  defp extract_delta(payload) do
    get_in(payload, ["params", "delta"]) ||
      get_in(payload, ["params", "text"]) ||
      get_in(payload, ["params", "message", "content"]) ||
      get_in(payload, [:params, :delta])
  end

  defp tool_call_from_payload(payload, event, result) do
    params = Map.get(payload, "params") || Map.get(payload, :params) || %{}
    raw_name = Map.get(params, "name") || Map.get(params, "tool") || Map.get(params, :name) || Map.get(params, :tool) || "unknown"
    # Strip the MCP gateway prefix that the Claude adapter emits for tools registered
    # via the ToolGateway. Codex names are unaffected (no-op for names without the prefix).
    name = String.replace_prefix(raw_name, "mcp__symphony__", "")

    %{
      name: name,
      status: tool_call_status(event),
      arguments: ToolCallPresenter.arguments(payload),
      output: ToolCallPresenter.output(result),
      result: result
    }
  end

  defp tool_call_status(:tool_call_started), do: "running"
  defp tool_call_status(:tool_call_failed), do: "error"
  defp tool_call_status(:unsupported_tool_call), do: "error"
  defp tool_call_status(_event), do: "complete"

  defp upsert_tool_call(tool_calls, tool_call) do
    [tool_call | Enum.reject(tool_calls, &(Map.get(&1, :name) == Map.get(tool_call, :name)))]
    |> Enum.reverse()
  end

  # Upsert by tool_use_id for claude/cursor notification-based tool results, merging into
  # the existing started entry so the tool name and arguments captured at start survive.
  # `fallback_name_fun` supplies a name only when the merged entry still lacks a real one
  # (e.g. a result with no started entry), so a real name is never overwritten by "unknown".
  defp upsert_tool_call_by_id(tool_calls, id, update, fallback_name_fun) when is_binary(id) do
    {matched, rest} = Enum.split_with(tool_calls, &(Map.get(&1, :id) == id))

    merged =
      (List.first(matched) || %{})
      |> Map.merge(Map.reject(update, fn {_k, v} -> is_nil(v) end))
      |> ensure_tool_name(fallback_name_fun)

    Enum.reverse([merged | Enum.reverse(rest)])
  end

  defp upsert_tool_call_by_id(tool_calls, _id, update, fallback_name_fun) do
    cleaned = Map.reject(update, fn {_k, v} -> is_nil(v) end)
    upsert_tool_call(tool_calls, ensure_tool_name(cleaned, fallback_name_fun))
  end

  # Keeps an existing, meaningful tool name; only applies the fallback when the name is
  # missing, blank, or the placeholder "unknown".
  defp ensure_tool_name(tool_call, fallback_name_fun) do
    case Map.get(tool_call, :name) do
      name when is_binary(name) and name != "" and name != "unknown" -> tool_call
      _ -> Map.put(tool_call, :name, fallback_name_fun.())
    end
  end

  defp put_present(map, _key, nil), do: map
  defp put_present(map, key, value), do: Map.put(map, key, value)

  # Strips the MCP gateway prefix; returns nil for a missing/blank name so callers can
  # decide whether to fall back to inference.
  defp claude_tool_name(name) when is_binary(name) and name != "",
    do: String.replace_prefix(name, "mcp__symphony__", "")

  defp claude_tool_name(_name), do: nil

  defp maybe_call(opts, key, payload) do
    case Keyword.get(opts, key) do
      callback when is_function(callback, 1) ->
        callback.(payload)
        :ok

      _ ->
        :ok
    end
  end

  defp doc_fingerprint(identifier) do
    case IssueDocuments.list_all(identifier) do
      %{documents: documents} when is_list(documents) ->
        documents
        |> Enum.map(fn document ->
          path = Map.get(document, :path)

          {
            path,
            Map.get(document, :kind),
            Map.get(document, :title),
            Map.get(document, :updated_at),
            content_fingerprint(identifier, path)
          }
        end)
        |> Enum.sort()

      _other ->
        []
    end
  end

  defp content_fingerprint(identifier, path) when is_binary(path) do
    case IssueDocuments.read(identifier, path) do
      {:ok, body} -> {:ok, :crypto.hash(:sha256, body) |> Base.encode16(case: :lower)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp content_fingerprint(_identifier, _path), do: {:error, :invalid_path}

  defp maybe_notify_documents(identifier, before, opts) do
    if doc_fingerprint(identifier) != before do
      maybe_call(opts, :on_documents_changed, identifier)
    else
      :ok
    end
  end

  defp thread_doc_fingerprint(thread_id) do
    case ThreadDocuments.list(thread_id) do
      %{documents: documents} when is_list(documents) ->
        documents
        |> Enum.map(fn document ->
          path = Map.get(document, :path)

          {
            path,
            Map.get(document, :kind),
            Map.get(document, :title),
            Map.get(document, :updated_at),
            thread_content_fingerprint(thread_id, path)
          }
        end)
        |> Enum.sort()

      _other ->
        []
    end
  end

  defp thread_content_fingerprint(thread_id, path) when is_binary(path) do
    case ThreadDocuments.read(thread_id, path) do
      {:ok, body} -> {:ok, :crypto.hash(:sha256, body) |> Base.encode16(case: :lower)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp thread_content_fingerprint(_thread_id, _path), do: {:error, :invalid_path}

  defp maybe_notify_thread_documents(thread_id, before, opts) do
    if thread_doc_fingerprint(thread_id) != before do
      maybe_call(opts, :on_thread_documents_changed, thread_id)
    else
      :ok
    end
  end

  defp fallback_assistant_message(message, agent_kind) do
    case String.trim(message) do
      "" -> "#{agent_label(agent_kind)} completed the turn without returning assistant text."
      trimmed -> trimmed
    end
  end

  defp agent_label("claude"), do: "Claude"
  defp agent_label("codex"), do: "Codex"
  defp agent_label("cursor"), do: "Cursor"
  defp agent_label(_), do: "The agent"

  # credo:disable-for-next-line Credo.Check.Refactor.CyclomaticComplexity
  defp normalize_runner_result({:ok, result}) when is_map(result) do
    assistant_message = Map.get(result, :assistant_message) || Map.get(result, "assistant_message")

    if is_binary(assistant_message) and String.trim(assistant_message) != "" do
      {:ok,
       %{
         assistant_message: assistant_message,
         tool_calls: Map.get(result, :tool_calls) || Map.get(result, "tool_calls") || [],
         codex_thread_id: Map.get(result, :codex_thread_id) || Map.get(result, "codex_thread_id") || Map.get(result, :thread_id),
         cli_session_id: Map.get(result, :cli_session_id) || Map.get(result, "cli_session_id"),
         turn_id: Map.get(result, :turn_id) || Map.get(result, "turn_id")
       }}
    else
      {:error, :assistant_message_required}
    end
  end

  defp normalize_runner_result({:error, reason}), do: {:error, reason}
  defp normalize_runner_result(_other), do: {:error, :invalid_runner_result}

  # Replaces the legacy maybe_update_codex_thread/2.
  # Persists the backend session/thread id for the resolved agent kind and updates
  # the thread's agent_kind when something meaningful happened:
  #   - backend returned a session/thread id → persist kind + id
  #   - agent kind changed vs what the thread had stored → persist kind only
  #   - nothing changed, no id returned → no write (preserves O(0) writes for
  #     fast stub runners and avoids timing regressions in tests)
  defp maybe_update_agent_thread(thread, runner_result, agent_kind) do
    backend_id =
      Map.get(runner_result, :codex_thread_id) || Map.get(runner_result, "codex_thread_id") ||
        Map.get(runner_result, :cli_session_id) || Map.get(runner_result, :thread_id)

    stored_kind = Map.get(thread, :agent_kind)

    cond do
      is_binary(backend_id) ->
        # Backend returned a session/thread id: persist both the agent kind and the id.
        with {:ok, thread} <- History.set_thread_agent(thread, agent_kind) do
          History.put_agent_thread_id(thread, agent_kind, backend_id)
        end

      stored_kind != agent_kind and is_binary(stored_kind) ->
        # Agent kind was previously stored as something different: update it.
        # (stored_kind == nil means the thread has never had an agent set — we skip
        # writing the default to avoid unnecessary writes on every new thread's first turn.)
        History.set_thread_agent(thread, agent_kind)

      true ->
        # Nothing to persist — no backend id and kind is unchanged or unset default.
        {:ok, thread}
    end
  end

  # Resolves the effective agent kind for a turn with the priority chain:
  # context (per-message) > thread's stored kind > operator settings default > "codex".
  # Project tier is intentionally absent here: the channel join sends an
  # effective_agent that includes it, and the composer echoes it back as
  # context.agent — so the project preference arrives via the context head.
  defp resolve_thread_agent(thread, context) do
    AgentPreference.normalize(Map.get(context, "agent") || Map.get(context, :agent)) ||
      AgentPreference.normalize(Map.get(thread, :agent_kind)) ||
      Settings.Agents.default_agent_kind()
  end

  defp persist_assistant_message(thread, runner_result) do
    History.append_message(thread, %{
      role: "assistant",
      content: Map.fetch!(runner_result, :assistant_message),
      turn_id: Map.get(runner_result, :turn_id),
      tool_calls: Map.get(runner_result, :tool_calls, [])
    })
  end

  defp assistant_issue(project_slug), do: %{id: "assistant:#{project_slug}", identifier: project_slug, title: "Project assistant chat"}

  defp format_history(history) do
    history
    |> Enum.take(-@history_limit)
    |> Enum.map(fn message -> "#{Map.get(message, :role) || Map.get(message, "role")}: #{Map.get(message, :content) || Map.get(message, "content")}" end)
    |> case do
      [] -> "(no prior messages)"
      lines -> Enum.join(lines, "\n")
    end
  end

  defp stringify_map(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {to_string(key), value} end)
  end

  defp normalize_message(message) do
    case String.trim(message) do
      "" -> {:error, :message_required}
      trimmed -> {:ok, trimmed}
    end
  end

  defp safe_project_workspace_name(project_slug) do
    safe =
      project_slug
      |> String.replace(~r/[^A-Za-z0-9_.-]+/, "-")
      |> String.trim("-")
      |> case do
        "" -> "project"
        value -> value
      end

    hash = :crypto.hash(:sha256, project_slug) |> Base.encode16(case: :lower) |> binary_part(0, 12)
    "#{safe}-#{hash}"
  end

  defp infer_cursor_tool_name(content) when is_binary(content) do
    cond do
      String.contains?(content, "Glob pattern") -> "Glob"
      String.contains?(content, "glob_pattern") -> "Glob"
      true -> "unknown"
    end
  end

  defp infer_cursor_tool_name(_content), do: "unknown"

  defp format_cursor_tool_output(content) when is_binary(content) do
    case Jason.decode(content) do
      {:ok, %{"error" => %{"error" => message}}} when is_binary(message) -> message
      {:ok, %{"error" => %{"message" => message}}} when is_binary(message) -> message
      {:ok, %{"error" => message}} when is_binary(message) -> message
      _ -> content
    end
  end

  defp format_cursor_tool_output(content), do: content
end
