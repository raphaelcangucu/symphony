defmodule SymphonyElixir.Assistant.CodexSession do
  @moduledoc "Runs project assistant chat turns through a Codex app-server session boundary."

  alias SymphonyElixir.Assistant.{History, IssueDocuments, ToolExecutor}
  alias SymphonyElixir.Codex.CodingAgent
  alias SymphonyElixir.Config
  alias SymphonyElixir.{Skills, Workspace}

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
         prompt <- build_prompt(project_slug, trimmed_message, context, history_before_turn),
         :ok <- maybe_call(opts, :on_message_created, History.message_payload(user_message)),
         {:ok, runner_result} <- run_codex_turn(workspace, prompt, project_slug, opts),
         {:ok, updated_thread} <- maybe_update_codex_thread(thread, runner_result),
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
    with {:ok, trimmed} <- normalize_message(message),
         workspace <- freeform_workspace(thread_id, opts),
         :ok <- File.mkdir_p(workspace),
         history <- thread_id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         {:ok, user_message} <-
           History.append_message(thread, %{role: "user", content: trimmed, metadata: stringify_map(context)}),
         prompt <- build_freeform_prompt(trimmed, context, history),
         :ok <- maybe_call(opts, :on_message_created, History.message_payload(user_message)),
         {:ok, runner_result} <- run_freeform_turn(workspace, prompt, opts),
         {:ok, updated_thread} <- maybe_update_codex_thread(thread, runner_result),
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
    with {:ok, trimmed} <- normalize_message(message),
         {:ok, workspace} <- ensure_issue_workspace(thread),
         docs_before <- doc_fingerprint(identifier),
         history <- thread_id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1),
         {:ok, user_message} <-
           History.append_message(thread, %{role: "user", content: trimmed, metadata: stringify_map(context)}),
         prompt <- build_issue_prompt(thread, trimmed, context, history),
         :ok <- maybe_call(opts, :on_message_created, History.message_payload(user_message)),
         {:ok, runner_result} <- run_issue_turn(workspace, prompt, project_slug, identifier, opts),
         {:ok, updated_thread} <- maybe_update_codex_thread(thread, runner_result),
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
    Do not post issue comments - your replies are shown to the user directly in this chat. Use update_issue when you need to record something on an issue.
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
      |> Keyword.put_new(:dynamic_tools, ToolExecutor.tool_specs())
      |> Keyword.put_new(:tool_executor, ToolExecutor.codex_tool_executor(project_slug))

    runner.(workspace, prompt, assistant_issue(project_slug), runner_opts)
    |> normalize_runner_result()
  end

  defp run_freeform_turn(workspace, prompt, opts) do
    runner = Keyword.get(opts, :runner, &default_runner/4)

    runner_opts =
      opts
      |> Keyword.put(:dynamic_tools, [])
      |> Keyword.put(:tool_executor, fn _tool, _arguments -> {:error, :no_tools_in_freeform_chat} end)

    runner.(workspace, prompt, freeform_issue(), runner_opts)
    |> normalize_runner_result()
  end

  # Honor the working tree persisted on the issue thread so the authoring turn writes where the
  # document viewer reads. If that path is unusable (e.g. a thread created while a divergent serve
  # pointed at another workspace root), recompute the canonical issue tree, repair the thread so
  # reads and writes realign, and continue instead of failing the turn.
  defp ensure_issue_workspace(%{workspace_path: path, issue_identifier: identifier} = thread)
       when is_binary(path) and path != "" do
    case Workspace.ensure_at(path, identifier) do
      {:ok, workspace} -> {:ok, workspace}
      {:error, _reason} -> heal_issue_workspace(thread, identifier)
    end
  end

  defp ensure_issue_workspace(%{issue_identifier: identifier} = thread) do
    heal_issue_workspace(thread, identifier)
  end

  defp heal_issue_workspace(thread, identifier) do
    with {:ok, workspace} <- Workspace.create_for_issue(identifier) do
      repair_thread_workspace_path(thread, workspace)
      {:ok, workspace}
    end
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
      |> Keyword.put(:dynamic_tools, ToolExecutor.issue_bound_tool_specs(identifier))
      |> Keyword.put(:tool_executor, ToolExecutor.issue_bound_codex_tool_executor(project_slug, identifier))

    runner.(workspace, prompt, assistant_issue(project_slug), runner_opts)
    |> normalize_runner_result()
  end

  defp freeform_issue, do: %{id: "assistant:freeform", identifier: "freeform", title: "Freeform assistant chat"}

  defp build_freeform_prompt(message, context, history) do
    """
    You are the Symphony freeform assistant. There is no project or repository context.
    Behave like a real conversational coding assistant. Answer naturally in the user's language.
    Do not call tracker tools; none are available in this chat.

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

          Write spec files to `docs/superpowers/specs/` and plan files to `docs/superpowers/plans/`
          in this working tree. Get section-by-section approval in chat. Do not start writing feature code.
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
    with {:ok, session} <- CodingAgent.start_session(workspace, opts) do
      {:ok, collector} = Agent.start_link(fn -> %{assistant_message: "", tool_calls: []} end)

      try do
        on_message = fn message ->
          relay_codex_event(message, collector, opts)

          case Keyword.get(opts, :on_message) do
            callback when is_function(callback, 1) -> callback.(message)
            _ -> :ok
          end
        end

        case CodingAgent.run_turn(session, prompt, issue, Keyword.put(opts, :on_message, on_message)) do
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
        CodingAgent.stop_session(session)
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

      true ->
        :ok
    end
  end

  defp relay_codex_event(_message, _collector, _opts), do: :ok

  defp extract_delta(payload) do
    get_in(payload, ["params", "delta"]) ||
      get_in(payload, ["params", "text"]) ||
      get_in(payload, ["params", "message", "content"]) ||
      get_in(payload, [:params, :delta])
  end

  defp tool_call_from_payload(payload, event, result) do
    params = Map.get(payload, "params") || Map.get(payload, :params) || %{}
    name = Map.get(params, "name") || Map.get(params, "tool") || Map.get(params, :name) || Map.get(params, :tool) || "unknown"

    %{
      name: name,
      status: tool_call_status(event),
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
         turn_id: Map.get(result, :turn_id) || Map.get(result, "turn_id")
       }}
    else
      {:error, :assistant_message_required}
    end
  end

  defp normalize_runner_result({:error, reason}), do: {:error, reason}
  defp normalize_runner_result(_other), do: {:error, :invalid_runner_result}

  defp maybe_update_codex_thread(thread, runner_result) do
    case Map.get(runner_result, :codex_thread_id) do
      codex_thread_id when is_binary(codex_thread_id) and codex_thread_id != "" ->
        History.update_thread(thread, %{codex_thread_id: codex_thread_id})

      _ ->
        {:ok, thread}
    end
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
