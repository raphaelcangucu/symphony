defmodule SymphonyElixir.Assistant.AgentSession do
  @moduledoc """
  Shared assistant turn runner for all agent backends.

  Codex, Claude, Cursor, and OpenCode share provider-neutral conversation and
  run contracts through this module.
  """

  alias SymphonyElixir.Agent.{ConversationRef, RunResult}

  alias SymphonyElixir.Assistant.{
    AuthoringGoalControl,
    FileActivityPresenter,
    FileChangeCapture,
    GitHubAuthoring,
    History,
    IssueDocuments,
    ProjectExploreWorkspace,
    SkillProfiles,
    SubtaskAuthoring,
    ThreadDocuments,
    ToolCallPresenter,
    ToolExecutor,
    TurnConfiguration,
    TurnTimeline
  }

  alias SymphonyElixir.Codex.DynamicTool
  alias SymphonyElixir.Claude.GoalStore, as: ClaudeGoalStore
  alias SymphonyElixir.CodingAgent, as: RootCodingAgent
  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.{AgentPreference, InstanceConfig, ProjectConfig, Repo, Settings, Skills, Workspace}
  alias SymphonyElixir.Workspace.IssueBranches
  alias SymphonyElixir.Settings.Orchestration
  alias SymphonyElixir.Workspace.PathOwnership

  require Logger

  @history_limit 20

  @type turn_result :: %{
          required(:assistant_message) => String.t(),
          required(:tool_calls) => [map()],
          optional(:content_blocks) => [map()],
          optional(:provider) => String.t(),
          optional(:conversation_id) => String.t(),
          optional(:run_id) => String.t(),
          optional(:execution_id) => String.t()
        }

  @doc """
  Executes one provider-neutral turn without creating or loading an assistant
  database thread. This is the runner used by the standalone agent client.
  """
  @spec run_standalone(Path.t(), String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def run_standalone(workspace, prompt, opts)
      when is_binary(workspace) and is_binary(prompt) and is_list(opts) do
    provider = Keyword.get(opts, :agent_kind)
    runner = Keyword.get(opts, :runner, &default_runner/4)
    issue = freeform_issue() |> Map.put(:agent_kind, provider)

    runner.(Path.expand(workspace), prompt, issue, opts)
    |> normalize_runner_result(provider)
  end

  @spec send_message(String.t(), String.t(), map(), keyword()) :: {:ok, turn_result()} | {:error, term()}
  def send_message(project_slug, message, context, opts \\ [])
      when is_binary(project_slug) and is_binary(message) and is_map(context) and is_list(opts) do
    with thread_id when is_integer(thread_id) <- Keyword.get(opts, :assistant_thread_id),
         {:ok, %{scope: "project", project_slug: ^project_slug} = thread} <- active_thread(thread_id) do
      send_message_to_project_thread(thread, message, context, opts)
    else
      nil -> {:error, :assistant_thread_required}
      {:ok, _thread} -> {:error, :assistant_thread_context_mismatch}
      {:error, reason} -> {:error, reason}
      _ -> {:error, :assistant_thread_required}
    end
  end

  @spec send_message_to_project_thread(SymphonyElixir.Assistant.Thread.t(), String.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def send_message_to_project_thread(
        %{scope: "project", id: thread_id, project_slug: project_slug},
        message,
        context,
        opts \\ []
      )
      when is_integer(thread_id) and is_binary(project_slug) and is_binary(message) and is_map(context) and
             is_list(opts) do
    with {:ok, thread} <- active_thread(thread_id),
         {:ok, trimmed_message} <- normalize_message(message),
         {:ok, workspace} <- persisted_thread_workspace(thread),
         {:ok, agent_kind} <- resolve_thread_agent(thread, context),
         {:ok, thread} <- persist_requested_model_provenance(thread, context, agent_kind),
         {:ok, opts} <-
           opts
           |> Keyword.put(:agent_kind, agent_kind)
           |> put_conversation_opts(thread, agent_kind)
           |> Keyword.put(:assistant_thread_id, thread.id)
           |> maybe_put_authoring_goal(thread, agent_kind),
         history_before_turn <- thread_id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         {:ok, user_message} <-
           History.append_message(thread, %{
             role: "user",
             content: trimmed_message,
             metadata: stringify_map(context)
           }),
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
         user_message: History.message_payload(user_message),
         assistant_chat_message: assistant_payload
       }
       |> Map.merge(turn_identity_fields(runner_result))}
    end
  end

  @spec send_message_to_thread(SymphonyElixir.Assistant.Thread.t(), String.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def send_message_to_thread(%{scope: "freeform", id: thread_id}, message, context, opts \\ [])
      when is_binary(message) and is_map(context) and is_list(opts) do
    with {:ok, thread} <- active_thread(thread_id),
         {:ok, agent_kind} <- resolve_thread_agent(thread, context),
         {:ok, thread} <- persist_requested_model_provenance(thread, context, agent_kind),
         {:ok, opts} <-
           opts
           |> Keyword.put(:agent_kind, agent_kind)
           |> put_conversation_opts(thread, agent_kind)
           |> Keyword.put(:assistant_thread_id, thread.id)
           |> maybe_put_authoring_goal(thread, agent_kind),
         {:ok, trimmed} <- normalize_message(message),
         {:ok, workspace} <- persisted_thread_workspace(thread),
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
         user_message: History.message_payload(user_message),
         assistant_chat_message: History.message_payload(assistant_message)
       }
       |> Map.merge(turn_identity_fields(runner_result))}
    end
  end

  @spec send_message_to_project_explore_thread(SymphonyElixir.Assistant.Thread.t(), String.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def send_message_to_project_explore_thread(
        %{scope: scope, id: thread_id, project_slug: project_slug},
        message,
        context,
        opts \\ []
      )
      when scope in ["project_explore", "project_session"] and is_binary(message) and is_map(context) and
             is_list(opts) do
    with {:ok, thread} <- active_thread(thread_id),
         {:ok, agent_kind} <- resolve_thread_agent(thread, context),
         {:ok, thread} <- persist_requested_model_provenance(thread, context, agent_kind),
         {:ok, opts} <-
           opts
           |> Keyword.put(:agent_kind, agent_kind)
           |> put_conversation_opts(thread, agent_kind)
           |> Keyword.put(:assistant_thread_id, thread.id)
           |> maybe_put_authoring_goal(thread, agent_kind),
         {:ok, trimmed} <- normalize_message(message),
         {:ok, workspace} <- ensure_project_explore_workspace(project_slug, thread, opts),
         history <- thread_id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         {:ok, user_message} <-
           History.append_message(thread, %{role: "user", content: trimmed, metadata: stringify_map(context)}),
         prompt <- build_project_explore_prompt(project_slug, trimmed, context, history),
         :ok <- maybe_call(opts, :on_message_created, History.message_payload(user_message)),
         :ok <- revalidate_session_workspace(thread, workspace),
         {:ok, runner_result} <- run_project_explore_turn(workspace, prompt, project_slug, opts),
         {:ok, updated_thread} <- maybe_update_agent_thread(thread, runner_result, agent_kind),
         {:ok, assistant_message} <- persist_assistant_message(updated_thread, runner_result) do
      {:ok,
       %{
         assistant_message: assistant_message.content,
         tool_calls: assistant_message.tool_calls,
         user_message: History.message_payload(user_message),
         assistant_chat_message: History.message_payload(assistant_message)
       }
       |> Map.merge(turn_identity_fields(runner_result))}
    end
  end

  @kb_write_tools ~w(kb_create_page kb_update_page kb_link_task kb_delete_page kb_delete_asset kb_delete_folder)

  @spec send_message_to_kb_thread(SymphonyElixir.Assistant.Thread.t(), String.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def send_message_to_kb_thread(
        %{scope: "kb", id: thread_id, project_slug: project_slug},
        message,
        context,
        opts \\ []
      )
      when is_binary(message) and is_map(context) and is_list(opts) do
    with {:ok, thread} <- active_thread(thread_id),
         {:ok, agent_kind} <- resolve_thread_agent(thread, context),
         {:ok, thread} <- persist_requested_model_provenance(thread, context, agent_kind),
         {:ok, opts} <-
           opts
           |> Keyword.put(:agent_kind, agent_kind)
           |> put_conversation_opts(thread, agent_kind)
           |> Keyword.put(:assistant_thread_id, thread.id)
           |> maybe_put_authoring_goal(thread, agent_kind),
         {:ok, trimmed} <- normalize_message(message),
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
         user_message: History.message_payload(user_message),
         assistant_chat_message: History.message_payload(assistant_message)
       }
       |> Map.merge(turn_identity_fields(runner_result))}
    end
  end

  @doc """
  Idempotently provisions the workspace pinned on an issue or issue-session thread.

  Isolated parallel trees also receive a per-issue feature branch checkout in each
  repository after provisioning completes.
  """
  @spec provision_thread_workspace(SymphonyElixir.Assistant.Thread.t()) :: {:ok, Path.t()} | {:error, term()}
  def provision_thread_workspace(%{scope: scope} = thread) when scope in ["issue", "issue_session"] do
    with {:ok, path} <- persisted_thread_workspace_path(thread),
         issue_ref <- issue_workspace_ref(Map.get(thread, :project_slug), thread.issue_identifier),
         clone_branches <- clone_branches_from_thread(thread),
         {:ok, workspace} <- Workspace.ensure_at(path, issue_ref, clone_branches: clone_branches),
         :ok <- maybe_ensure_isolated_branches(thread, workspace) do
      {:ok, workspace}
    end
  end

  def provision_thread_workspace(_thread), do: {:error, :unsupported_scope}

  @spec send_message_to_issue_thread(SymphonyElixir.Assistant.Thread.t(), String.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def send_message_to_issue_thread(
        %{scope: scope, id: thread_id, project_slug: project_slug, issue_identifier: identifier},
        message,
        context,
        opts \\ []
      )
      when scope in ["issue", "issue_session"] and is_binary(message) and is_map(context) and
             is_list(opts) do
    with {:ok, thread} <- active_thread(thread_id),
         {:ok, agent_kind} <- resolve_thread_agent(thread, context),
         {:ok, thread} <- persist_requested_model_provenance(thread, context, agent_kind),
         {:ok, opts} <-
           opts
           |> Keyword.put(:agent_kind, agent_kind)
           |> put_conversation_opts(thread, agent_kind)
           |> Keyword.put(:assistant_thread_id, thread.id)
           |> maybe_put_authoring_goal(thread, agent_kind),
         {:ok, trimmed} <- normalize_message(message),
         {:ok, workspace} <- ensure_issue_workspace(thread),
         docs_before <- doc_fingerprint(identifier),
         history <- thread_id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         {:ok, user_message} <-
           History.append_message(thread, %{role: "user", content: trimmed, metadata: stringify_map(context)}),
         prompt <- build_issue_prompt(thread, trimmed, context, history),
         :ok <- maybe_call(opts, :on_message_created, History.message_payload(user_message)),
         :ok <- revalidate_session_workspace(thread, workspace),
         {:ok, runner_result} <- run_issue_turn(workspace, prompt, project_slug, identifier, opts),
         {:ok, updated_thread} <- maybe_update_agent_thread(thread, runner_result, agent_kind),
         {:ok, assistant_message} <- persist_assistant_message(updated_thread, runner_result),
         :ok <- maybe_notify_documents(identifier, docs_before, opts) do
      {:ok,
       %{
         assistant_message: assistant_message.content,
         tool_calls: assistant_message.tool_calls,
         user_message: History.message_payload(user_message),
         assistant_chat_message: History.message_payload(assistant_message)
       }
       |> Map.merge(turn_identity_fields(runner_result))}
    end
  end

  @authoring_goal_continuation_prompt "Continue pursuing the chat goal for this issue. Review the progress so far in this working tree, keep working toward the objective, and stop when the result is ready for review or you are blocked. Do NOT dispatch the orchestrator and do NOT change the issue's status, labels, or run objective unless the user explicitly asks."
  @generic_goal_continuation_prompt "Continue pursuing the chat goal for this assistant thread. Review the conversation and current workspace, keep producing the requested analysis or artifacts, and stop when the result is ready for review or you are blocked. Never dispatch autonomous execution, change tracker state, or switch to another assistant thread unless the user explicitly asks."

  @doc """
  Runs an autonomous authoring-goal continuation batch on any persistent thread.

  This does not append a user message. Each scope retains its own workspace,
  prompt context, tools, and persistence behavior.
  """
  @spec continue_thread_goal(SymphonyElixir.Assistant.Thread.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def continue_thread_goal(%{id: thread_id} = _thread, context, opts \\ [])
      when is_integer(thread_id) and is_map(context) and is_list(opts) do
    with {:ok, thread} <- active_thread(thread_id),
         true <- History.thread_goal_mode(thread) || {:error, :goal_mode_disabled},
         {:ok, agent_kind} <- persisted_goal_agent(thread),
         {:ok, opts} <-
           opts
           |> Keyword.put(:agent_kind, agent_kind)
           |> put_conversation_opts(thread, agent_kind)
           |> Keyword.put(:assistant_thread_id, thread.id)
           |> maybe_put_authoring_goal(thread, agent_kind) do
      continue_goal_turn(thread, context, opts, agent_kind)
    end
  end

  @doc "Compatibility wrapper for issue and issue-session authoring continuations."
  @spec continue_issue_goal(SymphonyElixir.Assistant.Thread.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def continue_issue_goal(%{scope: scope} = thread, context, opts \\ [])
      when scope in ["issue", "issue_session"] and is_map(context) and is_list(opts),
      do: continue_thread_goal(thread, context, opts)

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
    #{docked_location_block(context)}
    Behave like a real conversational coding assistant inside the tracker.
    Answer naturally in the user's language. Use tracker tools only when the user asks for tracker data or a concrete tracker action.
    Prefer get_issue, get_project, get_issue_form_options, list_project_repositories, get_template, list_templates, get_workflow, and read_workspace_file over listing or searching the filesystem when you need structured project data.
    Project workflow markdown lives in the database (use get_workflow). Do not expect WORKFLOW.md in the workspace; read_workspace_file redirects that path to project settings.
    For orchestrator/dispatch questions: call get_workflow and read tracker.dispatch_states (queue for new auto-runs), active_states (polled), terminal_states, wait_states in data.config — not board status categories from get_project. Follow the workflow skill when editing workflow YAML.
    #{tracker_summary}
    Do not mirror normal chat replies as issue comments. Use add_comment when the user wants a comment on the issue; use update_issue for title/description/status changes.
    Board tools: list_issues, create_issue, get_issue, update_issue, move_issue, add_comment, list_comments, update_comment, delete_comment, list_pull_requests, link_pull_request, check_handoff_gate, get_evidence_status, manage_preview (status|start|stop|restart|output|prepare; optional server), list_previews, manage_tunnel (status|start), manage_dev_env, scan_project_setup, suggest_project_setup, update_project_workflow, update_project_repositories, dispatch_codex, get_agent_executions, get_issue_orchestrator_state, explain_dispatch_eligibility, list_running_agents, steer_agent, goal, manage_blockers, sync_issue, get_project, get_issue_form_options, list_project_repositories, get_workflow, read_workspace_file.
    Knowledge base tools (docs/ in each repo): kb_list_repositories, kb_search_pages, kb_read_page, kb_create_page, kb_update_page, kb_delete_page, kb_delete_asset, kb_delete_folder, kb_link_task, kb_sync. Projects can span multiple repositories; KB pages are addressed by (repository, path-within-docs). When the project has more than one repository and the user does not name one, the tool returns a remediation asking which repository — ASK the user, then retry with the `repository` argument (owner/name, workspace path, or slug). Use kb_search_pages before creating pages to avoid duplicates, kb_create_page for new pages and kb_update_page for existing ones, and kb_link_task to reference a tracker issue inside a page. KB writes save directly to the active working tree; kb_sync is a no-op compatibility hook. The delete tools (kb_delete_page, kb_delete_asset, kb_delete_folder) are destructive — kb_delete_folder removes a directory and everything inside it — so confirm the exact target with the user before calling them.
    Before moving an issue to a handoff/wait status, call check_handoff_gate. After writing evidence, call get_evidence_status. For preview: prefer manage_preview status/start/restart (leased ports match the Preview dock); on crash use output then restart; if you must run serve yourself use prepare and run the returned command verbatim — never invent ports or unmanaged INSPIRE_PORT bring-up. Cite only in_sync URLs. Use list_previews to inventory and manage_tunnel start for public links.
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

  defp run_codex_turn(workspace, prompt, project_slug, opts) do
    runner = Keyword.get(opts, :runner, &default_runner/4)

    runner_opts =
      opts
      |> Keyword.put(:project_slug, project_slug)
      |> Keyword.put_new(:dynamic_tools, ToolExecutor.combined_tool_specs())
      |> Keyword.put_new(:tool_executor, ToolExecutor.combined_codex_tool_executor(project_slug, opts))
      |> maybe_put_project_codex_config(project_slug)

    runner.(workspace, prompt, assistant_issue(project_slug), runner_opts)
    |> normalize_runner_result(Keyword.get(opts, :agent_kind))
  end

  defp run_project_explore_turn(workspace, prompt, project_slug, opts) do
    runner = Keyword.get(opts, :runner, &default_runner/4)
    %{root: project_root} = Workspace.project_layout(project_slug)

    runner_opts =
      opts
      |> Keyword.put(:project_slug, project_slug)
      |> Keyword.put_new(:workspace_root, Path.expand(project_root))
      |> Keyword.put_new(:dynamic_tools, ToolExecutor.combined_tool_specs())
      |> Keyword.put_new(:tool_executor, ToolExecutor.combined_codex_tool_executor(project_slug, opts))
      |> maybe_put_project_codex_config(project_slug)

    runner.(workspace, prompt, project_explore_issue(project_slug), runner_opts)
    |> normalize_runner_result(Keyword.get(opts, :agent_kind))
  end

  defp run_freeform_turn(workspace, prompt, opts) do
    runner = Keyword.get(opts, :runner, &default_runner/4)

    runner_opts =
      opts
      |> Keyword.put_new(:dynamic_tools, ToolExecutor.freeform_tool_specs())
      |> Keyword.put_new(:tool_executor, ToolExecutor.freeform_codex_tool_executor(opts))
      |> maybe_put_instance_codex_config()

    runner.(workspace, prompt, freeform_issue(), runner_opts)
    |> normalize_runner_result(Keyword.get(opts, :agent_kind))
  end

  defp ensure_issue_workspace(%{scope: "issue_session"} = thread) do
    case provision_thread_workspace(thread) do
      {:ok, workspace} -> {:ok, workspace}
      {:error, {:workspace_symlink_escape, _path, _root}} -> workspace_not_executable()
      {:error, :invalid_workspace_cwd} -> workspace_not_executable()
      {:error, reason} -> {:error, reason}
    end
  end

  # Honor the working tree persisted on the legacy issue thread so the authoring turn writes where the
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

  defp persisted_thread_workspace_path(%{workspace_path: path}) when is_binary(path) and path != "",
    do: {:ok, path}

  defp persisted_thread_workspace_path(_thread),
    do: {:error, {:authoring_goal_unavailable, :workspace_not_executable}}

  defp maybe_ensure_isolated_branches(%{metadata: metadata, project_slug: slug, issue_identifier: identifier}, workspace)
       when is_binary(slug) and is_binary(identifier) and is_binary(workspace) do
    if Map.get(metadata || %{}, "workspace_kind") == "isolated" do
      IssueBranches.ensure(workspace, slug, identifier)
    else
      :ok
    end
  end

  defp maybe_ensure_isolated_branches(_thread, _workspace), do: :ok

  defp clone_branches_from_thread(%{metadata: metadata}) when is_map(metadata) do
    case Map.get(metadata, "clone_branches") do
      branches when is_map(branches) -> branches
      _ -> %{}
    end
  end

  defp clone_branches_from_thread(_thread), do: %{}

  defp run_issue_turn(workspace, prompt, project_slug, identifier, opts) do
    runner = Keyword.get(opts, :runner, &default_runner/4)

    runner_opts =
      opts
      |> Keyword.put(:project_slug, project_slug)
      |> Keyword.put_new(:workspace_root, Workspace.workspace_root_for(issue_workspace_ref(project_slug, identifier)))
      |> Keyword.put(:dynamic_tools, ToolExecutor.issue_bound_tool_specs(identifier) ++ DynamicTool.tool_specs())
      |> Keyword.put(:tool_executor, ToolExecutor.issue_bound_combined_codex_tool_executor(project_slug, identifier, opts))
      |> maybe_put_project_codex_config(project_slug)

    runner.(workspace, prompt, assistant_issue(project_slug), runner_opts)
    |> normalize_runner_result(Keyword.get(opts, :agent_kind))
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

  defp ensure_project_explore_workspace(project_slug, %{scope: "project_session"} = thread, opts) do
    with {:ok, path} <- session_workspace_path(thread),
         :ok <- maybe_ensure_project_default_workspace(project_slug, path, opts) do
      {:ok, path}
    end
  end

  defp ensure_project_explore_workspace(_project_slug, thread, _opts),
    do: persisted_thread_workspace(thread)

  defp session_workspace_path(%{workspace_path: path}) when is_binary(path) and path != "",
    do: {:ok, path}

  defp session_workspace_path(_thread),
    do: {:error, {:authoring_goal_unavailable, :workspace_not_executable}}

  defp maybe_ensure_project_default_workspace(project_slug, path, opts)
       when is_binary(project_slug) and is_binary(path) do
    explore_path = ProjectExploreWorkspace.path(project_slug)

    if Path.expand(path) == Path.expand(explore_path) do
      case ProjectExploreWorkspace.ensure(project_slug, explore_workspace_opts(opts)) do
        {:ok, _ensured} -> :ok
        {:error, reason} -> {:error, reason}
      end
    else
      :ok
    end
  end

  defp maybe_ensure_project_default_workspace(_project_slug, _path, _opts), do: :ok

  defp explore_workspace_opts(opts) when is_list(opts) do
    Keyword.take(opts, [:git])
  end

  defp persisted_thread_workspace(%{scope: "freeform"} = thread) do
    path = resolve_freeform_workspace_path(thread)

    case File.mkdir_p(path) do
      :ok ->
        repair_freeform_workspace_path(thread, path)
        {:ok, path}

      {:error, _reason} ->
        {:error, {:authoring_goal_unavailable, :workspace_not_executable}}
    end
  end

  defp persisted_thread_workspace(%{workspace_path: path}) when is_binary(path) and path != "" do
    case File.mkdir_p(path) do
      :ok -> {:ok, path}
      {:error, _reason} -> {:error, {:authoring_goal_unavailable, :workspace_not_executable}}
    end
  end

  defp persisted_thread_workspace(_thread),
    do: {:error, {:authoring_goal_unavailable, :workspace_not_executable}}

  # Freeform threads persist an absolute workspace path. When the instance
  # workspace root moves (common across serve restarts / env changes), the
  # stored path falls outside Config.workspace_root/0 and Codex refuses the cwd.
  # Recompute the canonical freeform tree and repair the thread so the next turn
  # lands under the live root.
  defp resolve_freeform_workspace_path(%{workspace_path: path} = thread)
       when is_binary(path) and path != "" do
    root = Config.workspace_root() |> Path.expand()
    expanded = Path.expand(path)
    root_prefix = root <> "/"

    if expanded != root and String.starts_with?(expanded <> "/", root_prefix) do
      expanded
    else
      canonical_freeform_workspace(thread)
    end
  end

  defp resolve_freeform_workspace_path(thread), do: canonical_freeform_workspace(thread)

  defp canonical_freeform_workspace(%{metadata: metadata, id: thread_id}) do
    binding_id =
      case metadata do
        %{"gateway_binding_id" => id} when is_integer(id) -> id
        %{"gateway_binding_id" => id} when is_binary(id) -> id
        %{gateway_binding_id: id} when is_integer(id) or is_binary(id) -> id
        _other -> thread_id
      end

    freeform_workspace(binding_id)
  end

  defp repair_freeform_workspace_path(%{workspace_path: current} = thread, path)
       when is_binary(current) and current != path do
    case History.update_thread(thread, %{workspace_path: path}) do
      {:ok, _updated} -> :ok
      {:error, _reason} -> :ok
    end
  end

  defp repair_freeform_workspace_path(_thread, _path), do: :ok

  # This check intentionally sits immediately before each runner call. A filesystem
  # TOCTOU window still exists after validation; the coding-agent runner's cwd/root
  # guards remain the final boundary if the path changes during process launch.
  defp revalidate_session_workspace(
         %{scope: "project_session", project_slug: project_slug},
         workspace
       ) do
    project_slug
    |> PathOwnership.validate(workspace)
    |> executable_workspace_result()
  end

  defp revalidate_session_workspace(
         %{scope: "issue_session", project_slug: project_slug, issue_identifier: identifier},
         workspace
       ) do
    project_slug
    |> PathOwnership.validate_issue(workspace, identifier)
    |> executable_workspace_result()
  end

  defp revalidate_session_workspace(_thread, _workspace), do: :ok

  defp executable_workspace_result({:ok, _ownership}), do: :ok

  defp executable_workspace_result({:error, _reason}),
    do: {:error, {:authoring_goal_unavailable, :workspace_not_executable}}

  defp active_thread(thread_id) when is_integer(thread_id) do
    case History.get_thread(thread_id) do
      {:ok, %{status: "active"} = thread} -> {:ok, thread}
      {:ok, _thread} -> {:error, :assistant_thread_not_active}
      {:error, reason} -> {:error, reason}
    end
  end

  defp persisted_goal_agent(thread) do
    cond do
      thread.agent_kind in ["codex", "claude"] -> {:ok, thread.agent_kind}
      match?({:ok, %ConversationRef{}}, History.conversation_ref(thread, "claude")) -> {:ok, "claude"}
      match?({:ok, %ConversationRef{}}, History.conversation_ref(thread, "codex")) -> {:ok, "codex"}
      true -> {:error, {:authoring_goal_unavailable, {:unsupported_agent, "unknown"}}}
    end
  end

  defp continue_goal_turn(%{scope: "project", project_slug: project_slug} = thread, context, opts, agent_kind) do
    with {:ok, workspace} <- persisted_thread_workspace(thread),
         history <- thread.id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         prompt <- build_prompt(project_slug, @generic_goal_continuation_prompt, context, history),
         {:ok, runner_result} <- run_codex_turn(workspace, prompt, project_slug, opts),
         {:ok, result, _assistant_message} <- persist_continuation(thread, runner_result, agent_kind) do
      {:ok, result}
    end
  end

  defp continue_goal_turn(
         %{scope: scope, project_slug: project_slug} = thread,
         context,
         opts,
         agent_kind
       )
       when scope in ["project_explore", "project_session"] do
    with {:ok, workspace} <- ensure_project_explore_workspace(project_slug, thread, opts),
         history <- thread.id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         prompt <- build_project_explore_prompt(project_slug, @generic_goal_continuation_prompt, context, history),
         :ok <- revalidate_session_workspace(thread, workspace),
         {:ok, runner_result} <- run_project_explore_turn(workspace, prompt, project_slug, opts),
         {:ok, result, _assistant_message} <- persist_continuation(thread, runner_result, agent_kind) do
      {:ok, result}
    end
  end

  defp continue_goal_turn(%{scope: "freeform"} = thread, context, opts, agent_kind) do
    with {:ok, workspace} <- persisted_thread_workspace(thread),
         history <- thread.id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         prompt <- build_freeform_prompt(@generic_goal_continuation_prompt, context, history),
         {:ok, runner_result} <- run_freeform_turn(workspace, prompt, opts),
         {:ok, result, _assistant_message} <- persist_continuation(thread, runner_result, agent_kind) do
      {:ok, result}
    end
  end

  defp continue_goal_turn(
         %{scope: "kb", project_slug: project_slug} = thread,
         context,
         opts,
         agent_kind
       ) do
    with {:ok, workspace} <- persisted_thread_workspace(thread),
         history <- thread.id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         prompt <- build_kb_prompt(project_slug, @generic_goal_continuation_prompt, context, history),
         {:ok, runner_result} <- run_codex_turn(workspace, prompt, project_slug, opts),
         {:ok, result, assistant_message} <- persist_continuation(thread, runner_result, agent_kind) do
      maybe_notify_kb_documents(assistant_message, context, opts)
      {:ok, result}
    end
  end

  defp continue_goal_turn(
         %{scope: scope, project_slug: project_slug, issue_identifier: identifier} = thread,
         context,
         opts,
         agent_kind
       )
       when scope in ["issue", "issue_session"] do
    with {:ok, workspace} <- goal_issue_workspace(thread),
         docs_before <- doc_fingerprint(identifier),
         history <- thread.id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         prompt <- build_issue_prompt(thread, @authoring_goal_continuation_prompt, context, history),
         :ok <- revalidate_session_workspace(thread, workspace),
         {:ok, runner_result} <- run_issue_turn(workspace, prompt, project_slug, identifier, opts),
         {:ok, result, _assistant_message} <- persist_continuation(thread, runner_result, agent_kind),
         :ok <- maybe_notify_documents(identifier, docs_before, opts) do
      {:ok, result}
    end
  end

  defp goal_issue_workspace(%{scope: "issue_session"} = thread),
    do: session_workspace_path(thread)

  defp goal_issue_workspace(thread), do: persisted_thread_workspace(thread)

  defp persist_continuation(thread, runner_result, agent_kind) do
    with {:ok, updated_thread} <- maybe_update_agent_thread(thread, runner_result, agent_kind),
         {:ok, assistant_message} <- persist_assistant_message(updated_thread, runner_result) do
      result =
        %{
          assistant_message: assistant_message.content,
          tool_calls: assistant_message.tool_calls,
          assistant_chat_message: History.message_payload(assistant_message)
        }
        |> Map.merge(turn_identity_fields(runner_result))

      {:ok, result, assistant_message}
    end
  end

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

    Tools: get_workflow, get_project, list_project_repositories, get_template, list_templates, read_workspace_file, list_issues, get_issue, update_project_workflow, update_project_repositories, manage_preview (status|start|stop|restart|output|prepare), list_previews, manage_tunnel, manage_dev_env, check_handoff_gate, get_evidence_status, kb_*, and other tracker tools when needed.
    For preview: prefer manage_preview so ports match the Preview dock; cite only in_sync URLs; never invent ports.
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

  @doc """
  Describes where the operator is when talking to the docked Maestro on a
  global surface (home or observability), so the freeform assistant frames its
  role accordingly. Public so it can be unit-tested in isolation.
  """
  @spec freeform_location_block(map()) :: String.t()
  def freeform_location_block(context) when is_map(context) do
    case freeform_surface(context) do
      "observability" ->
        "User location: the Observability page. Act as the global operator: prefer list_observability_runtimes to inspect active runtimes/sessions, and help open or triage the issues behind them."

      _ ->
        "User location: Home (global operator). You can manage projects, browse and manage issues across projects, edit the user's personal knowledge base (pass project_slug \"@user\"), and read or update instance settings."
    end
  end

  defp freeform_surface(context) do
    (Map.get(context, "surface") || Map.get(context, :surface) || "home")
    |> to_string()
  end

  @doc """
  When the operator is talking through the docked Maestro on a board/list or an
  open issue drawer, returns a one-line hint describing that location so the
  project/issue prompt can stay concise and act in-place. Returns "" when there
  is no docked-panel context. Public for unit testing.
  """
  @spec docked_location_block(map()) :: String.t()
  def docked_location_block(context) when is_map(context) do
    case Map.get(context, "maestro") || Map.get(context, :maestro) do
      maestro when is_map(maestro) ->
        case to_string(Map.get(maestro, "kind") || Map.get(maestro, :kind)) do
          "project" ->
            "You are docked on the operator's #{maestro_view(maestro)} view of this project — keep replies concise and act on this board."

          "issue" ->
            "You are docked on the operator's open issue drawer (#{maestro_view(maestro)} view) — stay focused on this issue."

          _ ->
            ""
        end

      _ ->
        ""
    end
  end

  defp maestro_view(maestro) do
    case to_string(Map.get(maestro, "view") || Map.get(maestro, :view) || "board") do
      "list" -> "list"
      _ -> "board"
    end
  end

  defp build_freeform_prompt(message, context, history) do
    """
    You are the Symphony freeform assistant. There is no existing project or repository context.
    Behave like a real conversational coding assistant. Answer naturally in the user's language.

    #{freeform_location_block(context)}

    Tools available in this chat. Always pass `project_slug` (from list_tracker_projects) for board operations.

    Discovery (local first, then remotes): list_tracker_projects, list_linear_projects, list_jira_projects, list_github_projects.
    Create projects: create_tracker_project (local only), create_github_tracker_project, provision_github_project.

    Board / issues (require project_slug): list_issues, create_issue, get_issue, update_issue, move_issue, add_comment,
    list_comments, update_comment, delete_comment, list_pull_requests, link_pull_request, check_handoff_gate, get_evidence_status,
    manage_preview (action: status|start|stop|restart|output|prepare; optional server), list_previews, manage_tunnel (status|start), manage_dev_env, scan_project_setup, suggest_project_setup,
    dispatch_codex, get_agent_executions, get_issue_orchestrator_state, explain_dispatch_eligibility,
    list_running_agents, steer_agent, goal, manage_blockers,
    sync_issue, get_project, list_project_repositories, get_workflow, read_workspace_file,
    update_project_workflow, update_project_repositories.

    Diagnose / repair: explain_dispatch_eligibility (why an issue isn't dispatching), get_issue_orchestrator_state
    (live running/retry/idle), list_running_agents (every agent executing now), steer_agent (inject a message into a
    running agent's turn), manage_blockers (blocked_by relations), sync_issue (pull external tracker edits).

    Observability: list_observability_runtimes (live runtimes reported to the hub — status, running/retrying counts, per-agent usage; optional project_slug filter).

    Instance settings: get_settings (read operator config; optional group), update_setting (change one group/name/value — confirm with the user before writing).

    Knowledge base (require project_slug; docs/ in each repo): kb_list_repositories, kb_search_pages, kb_read_page,
    kb_create_page, kb_update_page, kb_delete_page, kb_delete_asset, kb_delete_folder, kb_link_task, kb_sync. Project/freeform KB writes save to the project working tree; issue-bound KB reads/writes save to the issue working tree. kb_sync is a no-op compatibility hook. Projects can
    span multiple repositories; when more than one is linked and the user does not name one, the tool returns a remediation
    asking which repository — ASK, then retry with the `repository` argument. Search before creating to avoid duplicates.
    The delete tools are destructive (kb_delete_folder removes a directory and everything inside it) — confirm the target first.

    Project setup flow: scan_project_setup → suggest_project_setup → update_project_workflow / update_project_repositories.
    For preview: prefer manage_preview status/start/restart (leased ports match the Preview dock); on crash use output then restart; if you must run serve yourself use prepare and run the returned command verbatim — never invent ports or unmanaged INSPIRE_PORT bring-up. Cite only in_sync URLs. Use list_previews to inventory and manage_tunnel start for public links.

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

  defp build_issue_prompt(
         %{metadata: metadata, issue_identifier: identifier, project_slug: project_slug, scope: scope} = thread,
         message,
         context,
         history
       ) do
    goal_mode = Map.get(metadata || %{}, "goal_mode", false) == true
    goal_objective = Map.get(metadata || %{}, "goal_objective")
    github_create = github_create_issue_guidance(project_slug)
    turn_config = issue_turn_configuration(thread, context)

    base = """
    You are the Symphony issue session assistant for `#{project_slug}`, working on issue `#{identifier}`.
    You are running inside the issue's working tree (the project repositories are cloned here).
    Current agent mode: `#{turn_config.mode}`. Skill toolkit: `#{turn_config.skill_profile}`.
    In this issue chat, knowledge-base page reads/writes (`kb_read_page`, `kb_create_page`, `kb_update_page`, `kb_link_task`) target the issue working tree so docs changed for this task are kept with the task branch.
    #{docked_location_block(context)}
    Answer in the user's language.
    Autonomous dispatch happens only when the user explicitly asks to dispatch, start an autonomous run, or hand off the work — then call the dispatch_codex tool for `#{identifier}` with concrete instructions. That moves the issue to In Progress so the orchestrator executes it (the orchestrator carries the issue's run objective). Never dispatch on your own.
    Dispatch automatically assigns the issue to the connected GitHub user and applies the resolved agent's `symphony:*` label when missing, including child_run subtasks listed in the execution bundle — you do not need to set assignee or symphony labels manually before dispatch.
    Do NOT enable or set a chat goal on your own. Activate or change the chat goal only when the user uses `/goal` or explicitly asks in natural language (for example: "ative o goal", "use goal mode", "liga o goal mode para fazer X"). Then use goal (context authoring/plan) to set, adjust, pause, resume, or clear it. Use context execution only when the user explicitly asks to change the orchestrator run objective.
    Do not mirror normal chat replies as issue comments — your replies are shown to the user directly in this chat.
    Use add_comment only when the user explicitly asks to post a comment on the issue; use update_issue for title, description, status, and assignee changes.

    Project tools available in this session (bound to `#{identifier}` when relevant): list_issues, create_issue, get_issue, update_issue, move_issue, add_comment, list_comments, update_comment, delete_comment, list_pull_requests, link_pull_request, check_handoff_gate, get_evidence_status, manage_preview (status|start|stop|restart|output|prepare; optional server), list_previews, manage_tunnel (status|start), manage_dev_env, scan_project_setup, suggest_project_setup, update_project_workflow, update_project_repositories, dispatch_codex, get_agent_executions, get_issue_orchestrator_state, explain_dispatch_eligibility, list_running_agents, steer_agent, goal, manage_blockers, sync_issue, get_project, get_issue_form_options, list_project_repositories, get_workflow, read_workspace_file, kb_list_repositories, kb_search_pages, kb_read_page, kb_create_page, kb_update_page, kb_link_task.
    Before moving to a handoff/wait status, call check_handoff_gate. After writing evidence, call get_evidence_status. For preview: prefer manage_preview status/start/restart (leased ports match the Preview dock); on crash use output then restart; if you must run serve yourself use prepare and run the returned command verbatim — never invent ports or unmanaged INSPIRE_PORT bring-up. Cite only in_sync URLs.

    When to call update_issue:
    - Plan or acceptance criteria are defined and stable
    - A discovery changes the implementation approach
    - Final enrichment when planning/implementation is complete (executive summary + links to spec/plan/handoff)
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

    String.trim(
      base <>
        mode_methodology_section(turn_config, identifier, scope) <>
        goal_mode_section(goal_mode, identifier, goal_objective, turn_config)
    )
  end

  defp issue_turn_configuration(%{scope: scope, metadata: metadata}, context) when is_map(context) do
    mode =
      pick_context_string(context, ["execution_mode", :execution_mode]) ||
        Map.get(metadata || %{}, "execution_mode")

    skill_profile =
      pick_context_string(context, ["skill_profile", :skill_profile]) ||
        Map.get(metadata || %{}, "skill_profile") ||
        SkillProfiles.auto()

    TurnConfiguration.resolve(%{
      scope: scope,
      mode: mode,
      skill_profile: skill_profile,
      runtime: "interactive"
    })
  end

  defp pick_context_string(context, keys) when is_map(context) and is_list(keys) do
    Enum.find_value(keys, fn key ->
      case Map.get(context, key) do
        value when is_binary(value) ->
          case String.trim(value) do
            "" -> nil
            trimmed -> trimmed
          end

        _ ->
          nil
      end
    end)
  end

  defp mode_methodology_section(%{mode: "plan"} = config, identifier, _scope) do
    preload = Skills.load(config.preload_slugs)

    """

    MODE: PLAN (read-only). Do NOT implement code changes, create application source files, or run mutating commands.
    Planning methodology — choose depth from the conversation:
    #{preload}

    Decide the planning depth from what the user asks for:
    - Quick brief or enriched description only: search the repositories in this working tree for relevant
      context (README, code, conventions) and call update_issue for `#{identifier}` once the description is
      stable and agreed in chat — not while still exploring or confirming hypotheses. Do not create spec/plan files.
    - Brainstorming, design, or implementation planning: **choose a git repository** in this working tree
      first (e.g. `back/`, `front/`), then write specs to `<repo>/docs/superpowers/specs/` and plans to
      `<repo>/docs/superpowers/plans/` inside that repo. Prefer the repo that owns the change (or the same
      repo as related existing specs); ask the user which repo if unclear. Never write to the workspace-root
      `docs/` folder — it is outside git and will not appear in Diff / changed-docs. Use section-by-section
      approval in chat.
    - When the task is ready for handoff: write a concise `<repo>/docs/superpowers/handoff.md` (key decisions +
      current state) in the same chosen repo and enrich the issue description (executive summary + links to
      spec/plan files) via update_issue — not before.
    Do not call update_issue while still exploring or before spec/plan sections are agreed in chat (when doing design work).
    State which depth you are taking and proceed.
    If the user asks to implement, remind them to switch to Build or Yolo mode (or approve the plan) so this session can edit files.
    """
  end

  defp mode_methodology_section(%{mode: mode} = config, identifier, _scope) when mode in ["build", "yolo"] do
    preload = Skills.load(config.preload_slugs)
    access = if mode == "yolo", do: "full access without approval prompts", else: "workspace write with command approvals"

    """

    MODE: #{String.upcase(mode)} (#{access}).
    Exit plan mode. Implement in this session: create, edit, and delete files in the issue working tree as needed.
    Do NOT wait for orchestrator dispatch unless the user explicitly asks to run autonomously.
    Implementation methodology:
    #{preload}

    Follow the approved spec/plan/handoff for `#{identifier}` when present. Prefer test-driven changes and verify before claiming completion.
    You may proceed directly to code. Keep the chat goal / run objective unchanged unless the user asks.
    """
  end

  defp mode_methodology_section(config, identifier, scope) do
    mode_methodology_section(%{config | mode: "plan"}, identifier, scope)
  end

  defp goal_mode_section(false, _identifier, _objective, _turn_config), do: ""

  defp goal_mode_section(true, _identifier, objective, turn_config) do
    objective_line =
      case normalize_goal_objective(objective) do
        nil ->
          "Derive the objective from the issue artifacts in this working tree (the executive " <>
            "summary, the spec's constraints, and the plan's verification steps)."

        text ->
          "Objective: #{text}"
      end

    mode_hint =
      case turn_config.mode do
        "plan" -> "Stay in Plan mode: produce analysis/spec/plan artifacts."
        mode when mode in ["build", "yolo"] -> "You may implement in this session under #{mode} mode."
        _ -> "Follow the current agent mode."
      end

    """

    CHAT GOAL: ACTIVE (long-running, in this conversation). Keep working toward the objective across turns
    until the artifact or implementation is ready for review or you are blocked. #{objective_line}
    #{mode_hint}
    Do NOT dispatch the orchestrator and do NOT change the issue's status, labels, or run objective unless the user explicitly asks.
    """
  end

  defp normalize_goal_objective(objective) when is_binary(objective) do
    case String.trim(objective) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_goal_objective(_), do: nil

  # Authoring goals: Codex uses native thread/goal via `:goal` opt; Claude uses
  # the `/goal` sidecar (`goal_role: :authoring`) injected by Claude.CodingAgent.
  defp maybe_put_authoring_goal(opts, thread, agent_kind) do
    if agent_kind in ["claude", :claude] do
      prepare_claude_authoring_goal(opts, thread)
    else
      prepare_non_claude_authoring_goal(opts, thread, agent_kind)
    end
  end

  defp prepare_claude_authoring_goal(opts, thread) do
    with {:ok, stored_goal} <- read_claude_authoring_goal(thread) do
      objective = History.thread_goal_objective(thread) || "Complete the authoring objective for this assistant thread."

      cond do
        match?(%{"pending_command" => "clear"}, stored_goal) ->
          {:ok, claude_authoring_opts(opts)}

        not History.thread_goal_mode(thread) ->
          {:ok, opts}

        claude_goal_sync_required?(thread, stored_goal, objective) ->
          with :ok <- maybe_set_claude_authoring_goal(%{thread | agent_kind: "claude"}, objective) do
            {:ok, claude_authoring_opts(opts)}
          end

        true ->
          {:ok, claude_authoring_opts(opts)}
      end
    end
  end

  defp prepare_non_claude_authoring_goal(opts, thread, agent_kind) do
    cond do
      not History.thread_goal_mode(thread) ->
        {:ok, opts}

      agent_kind in [nil, "codex", :codex] ->
        objective = History.thread_goal_objective(thread) || "Complete the authoring objective for this assistant thread."
        {:ok, Keyword.put(opts, :goal, objective)}

      true ->
        {:ok, opts}
    end
  end

  defp claude_authoring_opts(opts) do
    opts
    |> Keyword.put(:goal_role, :authoring)
    |> Keyword.delete(:goal)
  end

  defp claude_goal_sync_required?(thread, stored_goal, objective) do
    is_nil(stored_goal) or
      Map.get(stored_goal, "objective") != objective or
      Map.get(thread, :agent_kind) not in ["claude", :claude]
  end

  defp maybe_set_claude_authoring_goal(thread, objective) do
    case AuthoringGoalControl.sync_native_objective(thread, objective) do
      {:ok, _payload, _thread} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp read_claude_authoring_goal(%{id: id, workspace_path: workspace})
       when is_integer(id) and is_binary(workspace) do
    case ClaudeGoalStore.read(workspace, :authoring, id) do
      {:ok, goal} -> {:ok, goal}
      :error -> {:ok, nil}
      {:error, reason} -> {:error, reason}
    end
  end

  defp read_claude_authoring_goal(_thread),
    do: {:error, {:authoring_goal_unavailable, :workspace_not_executable}}

  defp default_runner(workspace, prompt, issue, opts) do
    agent_kind = Keyword.get(opts, :agent_kind)

    with {:ok, session} <- RootCodingAgent.start_session(workspace, agent_kind, opts) do
      {:ok, collector} = Agent.start_link(&TurnTimeline.new/0)

      try do
        on_message = fn message ->
          maybe_forward_turn_started(message, opts)
          relay_codex_event(message, collector, workspace, opts)

          case Keyword.get(opts, :on_message) do
            callback when is_function(callback, 1) -> callback.(message)
            _ -> :ok
          end
        end

        case RootCodingAgent.run_turn(session, prompt, issue, Keyword.put(opts, :on_message, on_message)) do
          {:ok, result} ->
            timeline = Agent.get(collector, & &1)
            collected_text = TurnTimeline.assistant_text(timeline)
            assistant_message = fallback_assistant_message(collected_text, agent_kind)

            timeline =
              if collected_text == "",
                do: TurnTimeline.append_text(timeline, assistant_message),
                else: timeline

            {:ok,
             result
             |> Map.put(:assistant_message, assistant_message)
             |> Map.put(:tool_calls, TurnTimeline.tool_calls(timeline))
             |> Map.put(:content_blocks, TurnTimeline.content_blocks(timeline))}

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
  defp relay_codex_event(message, collector, workspace, opts) when is_map(message) do
    payload = event_payload(message)
    method = Map.get(payload, "method") || Map.get(payload, :method)
    file_activity = FileActivityPresenter.from_event(message)

    cond do
      match?({:started, _}, file_activity) ->
        {:started, tool_call} = file_activity
        normalized = collect_tool_call(collector, tool_call)
        maybe_call(opts, :on_tool_call_started, normalized)

      match?({:completed, _}, file_activity) ->
        {:completed, tool_call} = file_activity
        tool_call = maybe_capture_file_patches(tool_call, workspace)
        normalized = collect_tool_call(collector, tool_call)
        maybe_call(opts, :on_tool_call_completed, normalized)

      method == "item/agentMessage/delta" ->
        case extract_delta(payload) do
          delta when is_binary(delta) ->
            if delta == "" do
              :ok
            else
              Agent.update(collector, &TurnTimeline.append_text(&1, delta))
              maybe_call(opts, :on_assistant_delta, delta)
            end

          _ ->
            :ok
        end

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
      method == "item/created" ->
        item = get_in(payload, ["params", "item"]) || get_in(payload, [:params, :item]) || %{}
        item_type = Map.get(item, "type") || Map.get(item, :type)

        cond do
          item_type == "tool_call" ->
            id = Map.get(item, "tool_use_id") || Map.get(item, :tool_use_id)
            raw_name = Map.get(item, "name") || Map.get(item, :name) || "unknown"
            name = String.replace_prefix(raw_name, "mcp__symphony__", "")
            input = Map.get(item, "input") || Map.get(item, :input) || %{}
            tool_call = %{name: name, status: "running", arguments: input, output: nil, result: %{}, id: id}

            normalized = collect_tool_call(collector, tool_call)
            maybe_call(opts, :on_tool_call_started, normalized)

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
              collector
              |> collect_tool_call(update)
              |> maybe_apply_inferred_tool_name(collector, content)

            maybe_call(opts, :on_tool_call_completed, merged)

          # The Claude adapter delivers finalized assistant text as an item/created
          # "text" item (the authoritative full text of a message block). Accumulate it
          # so the reply reaches the persisted assistant message. Live token streaming
          # is handled separately via "item/progress" deltas, so we do NOT also append
          # those here (that would double the text).
          item_type == "text" ->
            text = Map.get(item, "text") || Map.get(item, :text) || ""

            if is_binary(text) and text != "" do
              Agent.update(collector, &TurnTimeline.append_text(&1, text))
            end

          true ->
            :ok
        end

      Map.get(message, :event) == :tool_call_started ->
        tool_call = tool_call_from_payload(payload, :tool_call_started, %{})
        normalized = collect_tool_call(collector, tool_call)
        maybe_call(opts, :on_tool_call_started, normalized)

      Map.get(message, :event) in [:tool_call_completed, :tool_call_failed, :unsupported_tool_call] ->
        tool_call = tool_call_from_payload(payload, Map.get(message, :event), Map.get(message, :result) || %{})
        normalized = collect_tool_call(collector, tool_call)
        maybe_call(opts, :on_tool_call_completed, normalized)

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

      true ->
        :ok
    end
  end

  defp relay_codex_event(_message, _collector, _workspace, _opts), do: :ok

  # Codex reports file_change items with the affected paths, but a native patch is
  # only present when Codex's own event embeds one (see FileActivityPresenter). When
  # it doesn't, capture ONLY the reported paths via targeted, single-file git diffs
  # (FileChangeCapture) rather than ever computing a full workspace diff.
  defp maybe_capture_file_patches(%{name: "apply_patch", result: result} = tool_call, workspace)
       when is_binary(workspace) and is_map(result) do
    case {Map.get(result, "files"), Map.get(result, "paths")} do
      {files, paths} when files in [nil, []] and is_list(paths) and paths != [] ->
        captured = FileChangeCapture.capture(workspace, paths)
        {diff, additions, deletions} = captured_aggregate(captured)

        updated_result =
          result
          |> Map.put("files", captured)
          |> Map.put("diff", diff)
          |> Map.put("additions", additions)
          |> Map.put("deletions", deletions)

        %{tool_call | result: updated_result}

      _ ->
        tool_call
    end
  end

  defp maybe_capture_file_patches(tool_call, _workspace), do: tool_call

  defp captured_aggregate([]), do: {nil, 0, 0}

  defp captured_aggregate(captured) do
    diff =
      captured
      |> Enum.map(&Map.get(&1, "patch"))
      |> Enum.reject(&(&1 in [nil, ""]))
      |> Enum.join("\n")

    additions = Enum.sum(Enum.map(captured, &Map.get(&1, "additions", 0)))
    deletions = Enum.sum(Enum.map(captured, &Map.get(&1, "deletions", 0)))
    {if(diff == "", do: nil, else: diff), additions, deletions}
  end

  defp collect_tool_call(collector, tool_call) do
    Agent.get_and_update(collector, fn timeline ->
      {updated_timeline, normalized} = TurnTimeline.upsert_tool_call(timeline, tool_call)
      {normalized, updated_timeline}
    end)
  end

  defp maybe_apply_inferred_tool_name(tool_call, _collector, _content)
       when is_binary(tool_call.name) and tool_call.name not in ["", "unknown"],
       do: tool_call

  defp maybe_apply_inferred_tool_name(tool_call, collector, content) do
    case infer_cursor_tool_name(content) do
      "unknown" ->
        tool_call

      inferred_name ->
        collect_tool_call(collector, %{
          id: tool_call.id,
          name: inferred_name,
          status: tool_call.status
        })
    end
  end

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
      conversation_id =
        Map.get(message, :conversation_id) || Map.get(message, "conversation_id")

      run_id = Map.get(message, :run_id) || Map.get(message, "run_id")

      case Keyword.get(opts, :on_turn_started) do
        callback
        when is_function(callback, 2) and is_binary(conversation_id) and
               is_binary(run_id) ->
          callback.(conversation_id, run_id)

        _ ->
          :ok
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
      id: provider_tool_call_id(payload),
      name: name,
      status: tool_call_status(event),
      arguments: ToolCallPresenter.arguments(payload),
      output: ToolCallPresenter.output(result),
      result: result
    }
  end

  defp provider_tool_call_id(payload) do
    case Map.get(payload, "id") || Map.get(payload, :id) do
      nil -> nil
      id when is_binary(id) -> id
      id when is_integer(id) -> Integer.to_string(id)
      id -> id
    end
  end

  defp tool_call_status(:tool_call_started), do: "running"
  defp tool_call_status(:tool_call_failed), do: "error"
  defp tool_call_status(:unsupported_tool_call), do: "error"
  defp tool_call_status(_event), do: "complete"

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
    case message do
      "" -> "#{agent_label(agent_kind)} completed the turn without returning assistant text."
      collected -> collected
    end
  end

  defp agent_label("claude"), do: "Claude"
  defp agent_label("codex"), do: "Codex"
  defp agent_label("cursor"), do: "Cursor"
  defp agent_label(_), do: "The agent"

  # credo:disable-for-next-line Credo.Check.Refactor.CyclomaticComplexity
  defp normalize_runner_result({:ok, result}, provider) when is_map(result) do
    with {:ok, provider} <- result_provider(provider),
         {:ok, normalized} <- RunResult.normalize(provider, result) do
      {:ok, RunResult.to_map(normalized)}
    end
  end

  defp normalize_runner_result({:error, reason}, _provider), do: {:error, reason}
  defp normalize_runner_result(_other, _provider), do: {:error, :invalid_runner_result}

  defp result_provider(nil), do: {:ok, Settings.Agents.default_agent_kind()}

  defp result_provider(provider) do
    case AgentPreference.normalize(provider) do
      nil -> {:error, {:unsupported_provider, provider}}
      normalized -> {:ok, normalized}
    end
  end

  # Persists the canonical provider conversation id and updates
  # the thread's agent_kind when something meaningful happened:
  #   - backend returned a conversation id → persist kind + id
  #   - agent kind changed vs what the thread had stored → persist kind only
  #   - nothing changed, no id returned → no write (preserves O(0) writes for
  #     fast stub runners and avoids timing regressions in tests)
  defp maybe_update_agent_thread(thread, runner_result, agent_kind) do
    conversation_ref =
      case ConversationRef.new(agent_kind, Map.get(runner_result, :conversation_id)) do
        {:ok, ref} -> ref
        {:error, _reason} -> nil
      end

    stored_kind = Map.get(thread, :agent_kind)

    identity_result =
      cond do
        match?(%ConversationRef{}, conversation_ref) ->
          with {:ok, thread} <- History.set_thread_agent(thread, agent_kind) do
            History.put_conversation_ref(thread, conversation_ref)
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

    with {:ok, thread} <- identity_result do
      provenance =
        [:resolved_model, :resolved_effort]
        |> Enum.reduce(%{}, fn key, values ->
          case Map.get(runner_result, key) do
            value when is_binary(value) and value != "" -> Map.put(values, key, value)
            _value -> values
          end
        end)

      History.put_model_provenance(thread, provenance)
    end
  end

  defp put_conversation_opts(opts, thread, agent_kind) do
    case History.conversation_ref(thread, agent_kind) do
      {:ok, %ConversationRef{} = ref} ->
        Keyword.put(opts, :conversation_ref, ref)

      :error ->
        Keyword.delete(opts, :conversation_ref)
    end
  end

  defp persist_requested_model_provenance(thread, context, agent_kind)
       when is_map(thread) and is_map(context) and is_binary(agent_kind) do
    model_present? = Map.has_key?(context, "model") or Map.has_key?(context, :model)
    effort_present? = Map.has_key?(context, "effort") or Map.has_key?(context, :effort)

    if model_present? or effort_present? do
      History.put_model_provenance(thread, %{
        requested_model: Map.get(context, "model") || Map.get(context, :model),
        requested_effort:
          if(agent_kind == "cursor",
            do: nil,
            else: Map.get(context, "effort") || Map.get(context, :effort)
          ),
        resolved_model: nil,
        resolved_effort: nil
      })
    else
      {:ok, thread}
    end
  end

  defp turn_identity_fields(runner_result) do
    %{
      provider: Map.get(runner_result, :provider),
      conversation_id: Map.get(runner_result, :conversation_id),
      run_id: Map.get(runner_result, :run_id),
      execution_id: Map.get(runner_result, :execution_id),
      resolved_model: Map.get(runner_result, :resolved_model),
      resolved_effort: Map.get(runner_result, :resolved_effort)
    }
  end

  defp workspace_not_executable,
    do: {:error, {:authoring_goal_unavailable, :workspace_not_executable}}

  # Resolves the effective agent kind for a turn with the priority chain:
  # active Goal provider > context (per-message) > thread's stored kind > operator default.
  # Project tier is intentionally absent here: the channel join sends an
  # effective_agent that includes it, and the composer echoes it back as
  # context.agent — so the project preference arrives via the context head.
  defp resolve_thread_agent(thread, context) do
    requested_agent = AgentPreference.normalize(Map.get(context, "agent") || Map.get(context, :agent))

    if History.thread_goal_mode(thread) do
      with {:ok, goal_agent} <- persisted_goal_agent(thread) do
        if is_binary(requested_agent) and requested_agent != goal_agent,
          do: {:error, {:authoring_goal_provider_mismatch, goal_agent, requested_agent}},
          else: {:ok, goal_agent}
      end
    else
      {:ok,
       requested_agent ||
         AgentPreference.normalize(Map.get(thread, :agent_kind)) ||
         Settings.Agents.default_agent_kind()}
    end
  end

  defp persist_assistant_message(thread, runner_result) do
    attrs = %{
      role: "assistant",
      content: Map.fetch!(runner_result, :assistant_message),
      run_id: Map.get(runner_result, :run_id),
      tool_calls: Map.get(runner_result, :tool_calls, [])
    }

    attrs =
      case Map.fetch(runner_result, :content_blocks) do
        {:ok, content_blocks} ->
          if TurnTimeline.valid_content_blocks?(
               content_blocks,
               attrs.content,
               attrs.tool_calls
             ),
             do: Map.put(attrs, :metadata, %{"content_blocks" => content_blocks}),
             else: attrs

        :error ->
          attrs
      end

    History.append_message(thread, attrs)
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
