defmodule SymphonyElixir.Assistant.CodexSession do
  @moduledoc "Runs project assistant chat turns through a Codex app-server session boundary."

  alias SymphonyElixir.Assistant.{History, IssueDocuments, ProjectExploreWorkspace, ThreadDocuments, ToolCallPresenter, ToolExecutor}
  alias SymphonyElixir.Codex.DynamicTool
  alias SymphonyElixir.CodingAgent, as: RootCodingAgent
  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.{AgentPreference, InstanceConfig, ProjectConfig, Repo, Settings, Skills, Workspace}

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
         {:ok, user_message} <- History.append_message(thread, %{role: "user", content: trimmed_message, metadata: stringify_map(context)}),
         agent_kind = resolve_thread_agent(thread, context),
         opts = opts |> Keyword.put(:agent_kind, agent_kind) |> Keyword.put(:agent_thread_id, History.agent_thread_id(thread, agent_kind)),
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
        %{scope: "project_explore", id: thread_id, project_slug: project_slug} = thread,
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

  @spec send_message_to_issue_thread(SymphonyElixir.Assistant.Thread.t(), String.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def send_message_to_issue_thread(
        %{scope: "issue", id: thread_id, project_slug: project_slug, issue_identifier: identifier} = thread,
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
    """
    You are the Symphony Project assistant for `#{project_slug}`.

    Behave like a real conversational coding assistant inside the tracker.
    Answer naturally in the user's language. Use tracker tools only when the user asks for tracker data or a concrete tracker action.
    Prefer get_issue, get_project, list_project_repositories, get_template, list_templates, get_workflow, and read_workspace_file over listing or searching the filesystem when you need structured project data.
    Project workflow markdown lives in the database (use get_workflow). Do not expect WORKFLOW.md in the workspace; read_workspace_file redirects that path to project settings.
    For GitHub Projects use list_github_projects, provision_github_project, or create_github_tracker_project — or github_graphql — with Symphony's server GITHUB_TOKEN. Do not run gh/curl in the shell for tracker setup.
    Do not mirror normal chat replies as issue comments. Use add_comment when the user wants a comment on the issue; use update_issue for title/description/status changes.
    Board tools: list_issues, create_issue, get_issue, update_issue, move_issue, add_comment, list_pull_requests, manage_preview (start/stop/restart/status), update_project_workflow, update_project_repositories, dispatch_codex, get_agent_executions, get_project, list_project_repositories, get_workflow, read_workspace_file.
    If the user asks for coding work, create or update tracker context and dispatch Codex through the tracker workflow instead of editing files directly from this chat.
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
    """
    You are the Symphony project explore assistant for `#{project_slug}`.
    You are running inside the project's working tree. The repositories are cloned here on their default integration branches.
    Behave like a real conversational coding assistant. Answer naturally in the user's language.
    Help the user understand the codebase, architecture, and conventions. Read and search files as needed.
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

  defp build_freeform_prompt(message, context, history) do
    """
    You are the Symphony freeform assistant. There is no existing project or repository context.
    Behave like a real conversational coding assistant. Answer naturally in the user's language.

    Tools available in this chat. Always pass `project_slug` (from list_tracker_projects) for board operations.

    Discovery (local first, then remotes): list_tracker_projects, list_linear_projects, list_jira_projects, list_github_projects.
    Create projects: create_tracker_project (local only), create_github_tracker_project, provision_github_project.

    Board / issues (require project_slug): list_issues, create_issue, get_issue, update_issue, move_issue, add_comment,
    list_pull_requests, manage_preview (action: status|start|stop|restart), dispatch_codex, get_agent_executions,
    get_project, list_project_repositories, get_workflow, read_workspace_file, update_project_workflow, update_project_repositories.

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
    mode = Map.get(metadata || %{}, "mode", "triage")
    goal_mode = Map.get(metadata || %{}, "goal_mode", false) == true

    base = """
    You are the Symphony issue authoring assistant for `#{project_slug}`, working on issue `#{identifier}`.
    You are running inside the issue's working tree (the project repositories are cloned here).
    Answer in the user's language. Use tracker tools to update the bound issue. Do not dispatch Codex unless asked.
    Do not post issue comments - your replies are shown to the user directly in this chat. Author the issue via the update_issue tool instead of commenting.

    Recent conversation:
    #{format_history(history)}

    Context:
    #{inspect(context)}

    Current user message:
    #{message}
    """

    mode_section =
      case mode do
        "complex" ->
          """

          MODE: COMPLEX. Follow this vendored methodology exactly:
          #{Skills.load(["brainstorming", "writing-plans"])}

          Design-first authoring is desired by default: write spec files to `docs/superpowers/specs/`
          and plan files to `docs/superpowers/plans/` in this working tree, with section-by-section
          approval in chat. Codex is a coding agent; when the user explicitly asks to skip spec/plan
          work or authorizes implementation, acknowledge that direction and you may proceed directly to code.
          When the user signals the task is ready, write a concise `docs/superpowers/handoff.md`
          (key decisions + current state) and enrich the issue description (executive summary +
          links to the spec/plan files) via the update_issue tool.
          """

        "simple" ->
          """

          MODE: SIMPLE. Search the repositories in this working tree for relevant context (README, code,
          conventions) and produce a fuller, formal issue description. Apply it with the update_issue tool
          for `#{identifier}`. Do not create spec/plan files.
          """

        _ ->
          "\n\nMODE: TRIAGE. Collect the title and a short description, then help decide simple vs complex."
      end

    String.trim(base <> mode_section <> goal_mode_section(goal_mode, identifier))
  end

  defp goal_mode_section(false, _identifier), do: ""

  defp goal_mode_section(true, identifier) do
    """

    GOAL MODE: ENABLED (Codex long-running). When the user asks you to dispatch Codex for
    `#{identifier}`, call the dispatch_codex tool WITH a `goal` argument. Derive the goal from the
    issue artifacts in this working tree (the executive summary as the objective, the plan's
    verification steps as the checks, and the spec's constraints), plus a clear stopping condition
    (stop when complete or blocked). Keep the goal concise and self-contained so the orchestrator
    can follow it across multiple turns. Do not dispatch on your own — only when the user asks.
    """
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
             |> Map.put(:assistant_message, fallback_assistant_message(collected.assistant_message))
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

  defp relay_codex_event(message, collector, opts) when is_map(message) do
    payload = Map.get(message, :payload) || Map.get(message, "payload") || %{}
    method = Map.get(payload, "method") || Map.get(payload, :method)

    cond do
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
            Agent.update(collector, fn state -> %{state | tool_calls: upsert_tool_call(state.tool_calls, tool_call)} end)
            maybe_call(opts, :on_tool_call_started, tool_call)

          item_type == "tool_result" ->
            id = Map.get(item, "tool_use_id") || Map.get(item, :tool_use_id)
            content = Map.get(item, "content") || Map.get(item, :content) || ""
            is_error = Map.get(item, "is_error") || Map.get(item, :is_error) || false
            status = if is_error, do: "error", else: "complete"
            tool_call = %{name: nil, status: status, arguments: nil, output: content, result: %{}, id: id}
            Agent.update(collector, fn state -> %{state | tool_calls: upsert_tool_call_by_id(state.tool_calls, id, tool_call)} end)
            maybe_call(opts, :on_tool_call_completed, tool_call)

          true ->
            :ok
        end

      true ->
        :ok
    end
  end

  defp relay_codex_event(_message, _collector, _opts), do: :ok

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

  # Upsert by tool_use_id for claude notification-based tool results, merging into the
  # existing started entry (preserving :name and :arguments from the started event).
  defp upsert_tool_call_by_id(tool_calls, id, update) when is_binary(id) do
    {matched, rest} = Enum.split_with(tool_calls, &(Map.get(&1, :id) == id))
    merged = Map.merge(List.first(matched) || %{}, Map.reject(update, fn {_k, v} -> is_nil(v) end))
    Enum.reverse([merged | Enum.reverse(rest)])
  end

  defp upsert_tool_call_by_id(tool_calls, _id, update), do: upsert_tool_call(tool_calls, update)

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
    case IssueDocuments.list(identifier) do
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

  defp fallback_assistant_message(message) do
    case String.trim(message) do
      "" -> "Codex completed the turn without returning assistant text."
      trimmed -> trimmed
    end
  end

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
end
