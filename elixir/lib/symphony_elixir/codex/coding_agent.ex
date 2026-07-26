defmodule SymphonyElixir.Codex.CodingAgent do
  @moduledoc """
  Minimal client for the Codex app-server JSON-RPC 2.0 stream over stdio.
  """

  @version Mix.Project.config()[:version]

  @behaviour SymphonyElixir.CodingAgent

  require Logger
  alias SymphonyElixir.Agent.ConversationRef
  alias SymphonyElixir.Codex.Config, as: CodexConfig
  alias SymphonyElixir.Codex.DynamicTool
  alias SymphonyElixir.Codex.Session
  alias SymphonyElixir.Config
  alias SymphonyElixir.ExecutionMode

  @initialize_id 1
  @thread_start_id 2
  @turn_start_id 3
  @goal_set_id 4
  @thread_resume_id 5
  @goal_get_id 6
  @goal_clear_id 7
  @thread_compact_start_id 8
  @thread_name_set_id 9
  @thread_archive_id 10
  @steer_base_id 100
  @default_max_goal_turns 50
  @max_goal_turns_cap 500
  @port_line_bytes 1_048_576
  @max_stream_log_bytes 1_000
  @non_interactive_tool_input_answer "This is a non-interactive session. Operator input is unavailable."
  @goal_continuation_prompt "Continue working toward the active goal. Review prior progress, continue from the current workspace state, and stop when the goal is complete or blocked."

  @type session :: %{
          port: port(),
          metadata: map(),
          approval_policy: String.t() | map(),
          auto_approve_requests: boolean(),
          thread_sandbox: String.t(),
          turn_sandbox_policy: map(),
          thread_id: String.t(),
          workspace: Path.t()
        }

  @impl true
  def capabilities, do: SymphonyElixir.Agent.BackendCapabilities.for("codex")

  @spec run(Path.t(), String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def run(workspace, prompt, issue, opts \\ []) do
    with {:ok, session} <- start_session(workspace, opts) do
      try do
        result = run_turn(session, prompt, issue, opts)
        maybe_archive_on_stop(session, opts)
        result
      after
        stop_session(session)
      end
    end
  end

  @spec start_session(Path.t(), keyword()) :: {:ok, session()} | {:error, term()}
  @impl true
  def start_session(workspace, opts \\ []) do
    codex_section = codex_section(opts)
    goals_section = goals_section(opts)

    with :ok <- validate_goal_request(opts, goals_section),
         :ok <- validate_workspace_cwd(workspace, opts),
         {:ok, port} <- start_port(workspace, codex_section) do
      metadata = port_metadata(port)
      expanded_workspace = Path.expand(workspace)

      with {:ok, session_policies} <- session_policies(expanded_workspace, codex_section, opts),
           {:ok, %{thread_id: thread_id} = thread_context, origin} <-
             do_start_session(port, expanded_workspace, session_policies, opts, goals_section),
           :ok <- maybe_set_thread_name(port, thread_id, Keyword.get(opts, :thread_name)),
           {:ok, goal_state, goal_map} <-
             establish_goal(port, thread_id, origin, opts, goals_section) do
        # Only durable goal-mode runs own the workspace session sidecar.
        # Interactive (non-goal) sessions share the working tree with the
        # issue's durable thread; overwriting the pointer here cross-links
        # session logs between sibling sessions and makes the next goal-mode
        # run resume the wrong conversation.
        if goal_opt?(opts), do: Session.write(expanded_workspace, thread_id)
        maybe_mirror_session_goal(expanded_workspace, goal_map)

        {:ok,
         %{
           port: port,
           metadata: metadata,
           approval_policy: session_policies.approval_policy,
           auto_approve_requests: session_policies.approval_policy == "never",
           thread_sandbox: session_policies.thread_sandbox,
           turn_sandbox_policy: session_policies.turn_sandbox_policy,
           thread_id: thread_id,
           resolved_model: thread_context.resolved_model,
           resolved_effort: thread_context.resolved_effort,
           workspace: expanded_workspace,
           goals_section: goals_section,
           thread_origin: origin,
           goal_active: goal_state == :active,
           goal_attempted: goal_state != :not_requested
         }}
      else
        {:error, reason} ->
          stop_port(port)
          {:error, reason}
      end
    end
  end

  @typedoc """
  Out-of-band goal operations against a stored Codex thread:

    * `:get` — read the current persisted goal.
    * `:clear` — remove the persisted goal.
    * `{:set, attrs}` — create/replace/update the goal. `attrs` may carry
      `:objective`, `:status` and `:token_budget` (use `nil` to remove the
      budget; omit the key to leave it unchanged).
  """
  @type goal_command :: :get | :clear | {:set, map()}

  @doc """
  Operate on a stored Codex thread goal without running a turn.

  Opens a short-lived app-server connection, resumes the issue's durable thread,
  and applies the requested native `thread/goal/*` operation. This is the control
  plane Symphony uses for operator actions (pause/resume/clear/edit/budget): the
  goal lifecycle stays owned by the Codex thread rather than a Symphony-side
  abstraction.
  """
  @spec manage_goal(Path.t(), goal_command(), keyword()) ::
          {:ok, map() | nil | :cleared} | {:error, term()}
  def manage_goal(workspace, command, opts \\ []) do
    codex_section = codex_section(opts)
    goals_section = goals_section(opts)

    with :ok <- validate_workspace_cwd(workspace, opts),
         {:ok, thread_id} <- control_thread_id(workspace, opts),
         {:ok, port} <- start_port(workspace, codex_section) do
      try do
        with {:ok, session_policies} <- session_policies(Path.expand(workspace), codex_section, opts),
             :ok <- send_initialize(port),
             {:ok, _resumed_id} <- resume_thread(port, thread_id, session_policies, opts) do
          mirror_command_result(
            apply_goal_command(port, thread_id, command, goals_section),
            Path.expand(workspace)
          )
        end
      after
        stop_port(port)
      end
    end
  end

  @doc "Sets the display name of an existing native Codex thread."
  @spec set_thread_name(Path.t(), String.t(), String.t(), keyword()) :: :ok | {:error, term()}
  def set_thread_name(workspace, thread_id, name, opts \\ [])
      when is_binary(workspace) and is_binary(thread_id) and is_binary(name) and is_list(opts) do
    trimmed_thread_id = String.trim(thread_id)
    trimmed_name = String.trim(name)
    codex_section = codex_section(opts)

    cond do
      trimmed_thread_id == "" ->
        {:error, :invalid_thread_id}

      trimmed_name == "" ->
        {:error, :invalid_thread_name}

      true ->
        with :ok <- validate_workspace_cwd(workspace, opts),
             {:ok, port} <- start_port(workspace, codex_section) do
          try do
            with :ok <- send_initialize(port),
                 :ok <- request_thread_name_set(port, trimmed_thread_id, trimmed_name) do
              :ok
            end
          after
            stop_port(port)
          end
        end
    end
  end

  @doc """
  Ensure the issue's Codex thread exists and set a goal on it without running a
  turn.

  Resolves and resumes the durable thread (sidecar/opts), or starts a new
  durable thread only when the issue has none yet, then applies a native
  `thread/goal/set`. Writes the workspace session sidecar so future runs resume
  the same thread, mirrors the native goal into the sidecar for dormant display,
  and returns the resolved/created `thread_id` so callers can persist the
  issue's `agent_session_id`. This is how defining a goal creates the Codex
  thread it lives on.
  """
  @spec ensure_goal(Path.t(), map(), keyword()) ::
          {:ok, %{goal: map() | nil, thread_id: String.t(), origin: :started | :resumed}}
          | {:error, term()}
  def ensure_goal(workspace, attrs, opts \\ []) when is_map(attrs) do
    codex_section = codex_section(opts)
    goals_section = goals_section(opts)

    if CodexConfig.goals_enabled?(goals_section) do
      with :ok <- validate_workspace_cwd(workspace, opts),
           {:ok, port} <- start_port(workspace, codex_section) do
        expanded_workspace = Path.expand(workspace)

        try do
          with {:ok, session_policies} <- session_policies(expanded_workspace, codex_section, opts),
               :ok <- send_initialize(port),
               {:ok, thread_id, origin} <-
                 ensure_control_thread(port, expanded_workspace, session_policies, opts),
               {:ok, goal} <- request_goal_set(port, thread_id, attrs) do
            Session.write(expanded_workspace, thread_id)
            Session.put_goal(expanded_workspace, goal)
            {:ok, %{goal: goal, thread_id: thread_id, origin: origin}}
          end
        after
          stop_port(port)
        end
      end
    else
      {:error, :goals_disabled}
    end
  end

  @doc """
  Whether Codex Goal mode is enabled for the given run opts (merging the global
  `codex:` section with any per-project `codex_config`).
  """
  @spec goals_enabled?(keyword()) :: boolean()
  def goals_enabled?(opts) do
    opts |> goals_section() |> CodexConfig.goals_enabled?()
  end

  @spec run_turn(session(), String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  @impl true
  def run_turn(%{} = session, prompt, issue, opts \\ []) do
    on_message = Keyword.get(opts, :on_message, &default_on_message/1)

    tool_executor =
      Keyword.get(opts, :tool_executor, fn tool, arguments ->
        DynamicTool.execute(tool, arguments, issue: issue)
      end)

    with {:ok, goal_active} <- ensure_goal_active(session, opts) do
      run_goal_turns(
        session,
        prompt,
        issue,
        opts,
        on_message,
        tool_executor,
        goal_active,
        max_goal_turns(opts),
        1
      )
    end
  end

  defp run_goal_turns(
         session,
         prompt,
         issue,
         opts,
         on_message,
         tool_executor,
         goal_active,
         max_goal_turns,
         turn_number
       ) do
    case run_single_turn(session, prompt, issue, opts, on_message, tool_executor) do
      {:ok, turn_session} ->
        case next_goal_turn_action(goal_active, session, turn_session, turn_number, max_goal_turns) do
          :continue ->
            Logger.info("Continuing Codex goal for #{issue_context(issue)} turn=#{turn_number + 1}/#{max_goal_turns}")

            run_goal_turns(
              session,
              @goal_continuation_prompt,
              issue,
              opts,
              on_message,
              tool_executor,
              goal_active,
              max_goal_turns,
              turn_number + 1
            )

          :budget_exhausted ->
            Logger.info("Codex goal turn budget exhausted for #{issue_context(issue)} max_goal_turns=#{max_goal_turns}")

            {:ok, complete_goal_turn(turn_session, turn_number)}

          :stop ->
            {:ok, complete_goal_turn(turn_session, turn_number)}

          {:error, reason} ->
            {:error, reason}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp run_single_turn(
         %{
           port: port,
           metadata: metadata,
           approval_policy: approval_policy,
           auto_approve_requests: auto_approve_requests,
           turn_sandbox_policy: turn_sandbox_policy,
           thread_id: thread_id,
           workspace: workspace
         } = session,
         prompt,
         issue,
         opts,
         on_message,
         tool_executor
       ) do
    case start_turn(port, thread_id, prompt, issue, workspace, approval_policy, turn_sandbox_policy, opts) do
      {:ok, turn_id} ->
        session_id = "#{thread_id}-#{turn_id}"
        Logger.info("Codex session started for #{issue_context(issue)} session_id=#{session_id}")

        emit_message(
          on_message,
          :session_started,
          %{
            provider: "codex",
            conversation_id: thread_id,
            run_id: turn_id
          },
          metadata
        )

        turn_ctx = %{
          thread_id: thread_id,
          turn_id: turn_id,
          next_id: @steer_base_id,
          pending: %{},
          interactive_user_input: Keyword.get(opts, :interactive_user_input, false),
          turn_error: nil,
          agent_message?: false,
          latest_goal_update: nil,
          resolved_model: Map.get(session, :resolved_model),
          resolved_effort: Map.get(session, :resolved_effort)
        }

        case await_turn_completion(port, on_message, tool_executor, auto_approve_requests, turn_ctx) do
          {:ok,
           %{
             completion_payload: completion_payload,
             goal_update: goal_update,
             resolved_model: resolved_model,
             resolved_effort: resolved_effort
           }} ->
            Logger.info("Codex session completed for #{issue_context(issue)} session_id=#{session_id}")

            {:ok,
             %{
               result: :turn_completed,
               completion_payload: completion_payload,
               goal_update: goal_update,
               provider: "codex",
               conversation_id: thread_id,
               run_id: turn_id,
               resolved_model: resolved_model,
               resolved_effort: resolved_effort
             }}

          {:error, reason} ->
            if context_window_failure?(reason) and not Keyword.get(opts, :context_window_compacted?, false) do
              Logger.warning("Codex context window exhausted for #{issue_context(issue)} session_id=#{session_id}; compacting thread before retry")

              case compact_thread(port, thread_id, on_message, tool_executor, auto_approve_requests, turn_ctx) do
                :ok ->
                  retry_opts = Keyword.put(opts, :context_window_compacted?, true)
                  run_single_turn(session, prompt, issue, retry_opts, on_message, tool_executor)

                {:error, compact_reason} ->
                  Logger.warning("Codex thread compaction failed for #{issue_context(issue)} session_id=#{session_id}: #{inspect(compact_reason)}")

                  emit_turn_error(on_message, metadata, session_id, reason)
                  {:error, reason}
              end
            else
              Logger.warning("Codex session ended with error for #{issue_context(issue)} session_id=#{session_id}: #{inspect(reason)}")

              emit_turn_error(on_message, metadata, session_id, reason)
              {:error, reason}
            end
        end

      {:error, reason} ->
        Logger.error("Codex session failed for #{issue_context(issue)}: #{inspect(reason)}")
        emit_message(on_message, :startup_failed, %{reason: reason}, metadata)
        {:error, reason}
    end
  end

  defp next_goal_turn_action(false, _session, _turn_session, _turn_number, _max_goal_turns), do: :stop

  defp next_goal_turn_action(true, _session, _turn_session, turn_number, max_goal_turns)
       when turn_number >= max_goal_turns,
       do: :budget_exhausted

  defp next_goal_turn_action(
         true,
         %{port: port, thread_id: thread_id},
         %{goal_update: goal_update},
         _turn_number,
         _max_goal_turns
       ) do
    with {:ok, status} <- goal_status_after_turn(port, thread_id, goal_update) do
      case status do
        :active -> :continue
        :terminal -> :stop
      end
    end
  end

  defp complete_goal_turn(turn_session, turn_number) do
    turn_session
    |> Map.delete(:goal_update)
    |> Map.put(:goal_turns, turn_number)
  end

  defp goal_status_after_turn(port, thread_id, goal_update) do
    case goal_lifecycle_status(goal_update) do
      status when status in [:active, :terminal] ->
        {:ok, status}

      :ambiguous ->
        authoritative_goal_status(port, thread_id)
    end
  end

  defp authoritative_goal_status(port, thread_id) do
    case request_goal_get(port, thread_id) do
      {:ok, %{} = goal} ->
        case goal_lifecycle_status(goal) do
          status when status in [:active, :terminal] -> {:ok, status}
          :ambiguous -> {:error, {:goal_status_failed, {:ambiguous_status, goal_status_value(goal)}}}
        end

      {:ok, nil} ->
        {:error, {:goal_status_failed, :missing_goal}}

      {:error, reason} ->
        {:error, {:goal_status_failed, reason}}
    end
  end

  defp emit_turn_error(on_message, metadata, _session_id, reason) do
    emit_message(
      on_message,
      :turn_ended_with_error,
      %{
        reason: reason
      },
      metadata
    )
  end

  defp compact_thread(port, thread_id, on_message, tool_executor, auto_approve_requests, turn_ctx) do
    send_message(port, %{
      "method" => "thread/compact/start",
      "id" => @thread_compact_start_id,
      "params" => %{"threadId" => thread_id}
    })

    with {:ok, _result} <- await_response(port, @thread_compact_start_id),
         {:ok, _payload} <-
           await_turn_completion(
             port,
             on_message,
             tool_executor,
             auto_approve_requests,
             compact_turn_context(turn_ctx)
           ) do
      :ok
    else
      {:error, reason} -> {:error, reason}
      other -> {:error, other}
    end
  end

  defp compact_turn_context(turn_ctx) do
    %{
      turn_ctx
      | turn_id: "compact",
        pending: %{},
        turn_error: nil,
        agent_message?: false
    }
  end

  defp ensure_goal_active(%{goal_active: true}, _opts), do: {:ok, true}
  defp ensure_goal_active(%{goal_attempted: true}, _opts), do: {:ok, false}

  defp ensure_goal_active(%{port: port, thread_id: thread_id} = session, opts) do
    section = Map.get(session, :goals_section) || default_goals_section()

    case maybe_set_goal(port, thread_id, Keyword.get(opts, :goal), section) do
      {:ok, goal_state, _goal} -> {:ok, goal_state == :active}
      {:error, reason} -> {:error, reason}
    end
  end

  defp ensure_goal_active(_session, _opts), do: {:ok, false}

  defp validate_goal_request(opts, section) do
    case Keyword.fetch(opts, :goal) do
      :error ->
        :ok

      {:ok, objective} when is_binary(objective) ->
        cond do
          String.trim(objective) == "" -> {:error, {:goal_activation_failed, :empty_objective}}
          not CodexConfig.goals_enabled?(section) -> {:error, {:goal_activation_failed, :goals_disabled}}
          true -> :ok
        end

      {:ok, _invalid} ->
        {:error, {:goal_activation_failed, :invalid_objective}}
    end
  end

  defp max_goal_turns(opts) do
    case Keyword.get(opts, :max_goal_turns, @default_max_goal_turns) do
      value when is_integer(value) and value > 0 -> min(value, @max_goal_turns_cap)
      _value -> @default_max_goal_turns
    end
  end

  defp goal_lifecycle_status(goal) when is_map(goal) do
    case goal |> goal_status_value() |> normalize_goal_lifecycle_status() do
      :active -> :active
      :terminal -> :terminal
      nil -> :ambiguous
    end
  end

  defp goal_lifecycle_status(_goal), do: :ambiguous

  defp normalize_goal_lifecycle_status(status) when is_binary(status) do
    case status |> String.trim() |> String.downcase() do
      value when value in ["active", "running", "starting"] -> :active
      value when value in ["paused", "completed", "blocked", "failed", "budgetlimited", "usagelimited"] -> :terminal
      _other -> nil
    end
  end

  defp normalize_goal_lifecycle_status(_status), do: nil

  defp normalize_goal_status(status) when is_binary(status) do
    status
    |> String.trim()
    |> String.downcase()
    |> case do
      "active" -> :active
      "in_progress" -> :active
      "in-progress" -> :active
      "running" -> :active
      "pending" -> :active
      "completed" -> :completed
      "complete" -> :completed
      "done" -> :completed
      "satisfied" -> :completed
      "blocked" -> :blocked
      "failed" -> :blocked
      "cancelled" -> :blocked
      "canceled" -> :blocked
      _other -> nil
    end
  end

  defp normalize_goal_status(_status), do: nil

  @spec stop_session(session()) :: :ok
  @impl true
  def stop_session(%{port: port}) when is_port(port) do
    stop_port(port)
  end

  def stop_session(_session), do: :ok

  defp validate_workspace_cwd(workspace, opts) when is_binary(workspace) and is_list(opts) do
    workspace_path = Path.expand(workspace)
    workspace_root = opts |> resolve_workspace_root() |> Path.expand()

    root_prefix = workspace_root <> "/"

    cond do
      workspace_path == workspace_root ->
        {:error, {:invalid_workspace_cwd, :workspace_root, workspace_path}}

      not String.starts_with?(workspace_path <> "/", root_prefix) ->
        {:error, {:invalid_workspace_cwd, :outside_workspace_root, workspace_path, workspace_root}}

      true ->
        :ok
    end
  end

  defp resolve_workspace_root(opts) do
    case Keyword.get(opts, :workspace_root) do
      root when is_binary(root) and root != "" -> root
      _ -> Config.workspace_root()
    end
  end

  defp start_port(workspace, codex_section) do
    case System.find_executable("bash") do
      nil ->
        {:error, :bash_not_found}

      bash ->
        command = CodexConfig.command(codex_section)

        port =
          Port.open(
            {:spawn_executable, String.to_charlist(bash)},
            [
              :binary,
              :exit_status,
              :stderr_to_stdout,
              args: [~c"-lc", String.to_charlist(command)],
              cd: String.to_charlist(workspace),
              line: @port_line_bytes
            ]
          )

        {:ok, port}
    end
  end

  defp port_metadata(port) when is_port(port) do
    case :erlang.port_info(port, :os_pid) do
      {:os_pid, os_pid} ->
        %{codex_app_server_pid: to_string(os_pid)}

      _ ->
        %{}
    end
  end

  defp send_initialize(port) do
    payload = %{
      "method" => "initialize",
      "id" => @initialize_id,
      "params" => %{
        "capabilities" => %{
          "experimentalApi" => true
        },
        "clientInfo" => %{
          "name" => "symphony-orchestrator",
          "title" => "Symphony Orchestrator",
          "version" => @version
        }
      }
    }

    send_message(port, payload)

    with {:ok, _} <- await_response(port, @initialize_id) do
      send_message(port, %{"method" => "initialized", "params" => %{}})
      :ok
    end
  end

  defp session_policies(workspace, codex_section, opts) do
    codex_section
    |> apply_execution_mode_section(Keyword.get(opts, :execution_mode), codex_interactive?(opts))
    |> CodexConfig.runtime_settings(workspace)
  end

  # When the operator picks an execution mode, force the codex sandbox onto the
  # mode's ceiling (plan→read-only, build→workspace-write, yolo→danger-full-access)
  # and drop any per-project `turn_sandbox_policy` so the per-turn policy is
  # recomputed from the new sandbox. The approval policy is then overridden per the
  # mode + interactivity (see `ExecutionMode.codex_approval_override/2`): interactive
  # `build` prompts (`on-request`), autonomous `build` and `yolo` pin to `never`
  # (no human to approve), and `plan` honors the project config. Without a mode the
  # project/instance section is honored unchanged.
  defp apply_execution_mode_section(section, mode, interactive?) when is_binary(mode) do
    section
    |> Map.put("thread_sandbox", ExecutionMode.codex_policy(mode).sandbox)
    |> Map.delete("turn_sandbox_policy")
    |> apply_execution_mode_approval(mode, interactive?)
  end

  defp apply_execution_mode_section(section, _mode, _interactive?), do: section

  defp apply_execution_mode_approval(section, mode, interactive?) do
    case ExecutionMode.codex_approval_override(mode, interactive?) do
      {:force, policy} -> Map.put(section, "approval_policy", policy)
      :honor_config -> section
    end
  end

  defp codex_interactive?(opts), do: Keyword.get(opts, :interactive_user_input, false) == true

  # The per-project `codex:` section is threaded via opts at dispatch
  # (`agent_runner`). Fall back to the process-global codex section when absent
  # (e.g. ad-hoc sessions), and normalize to an empty map so callers can rely on
  # `Map.get/2`.
  defp codex_section(opts) do
    case Keyword.get(opts, :codex_config) do
      %{} = section -> section
      _ -> global_codex_section()
    end
  end

  defp global_codex_section do
    SymphonyElixir.InstanceConfig.codex_section()
  end

  # The section that decides Goal mode (`goals_enabled`). The workflow `codex:`
  # section is the base (it preserves `goals_enabled`, unlike the InstanceConfig
  # command fallback that dispatches thread via `:codex_config`). A per-project
  # `codex_config` is merged on top so a project can override the global flag.
  defp goals_section(opts) do
    base = default_goals_section()

    case Keyword.get(opts, :codex_config) do
      %{} = section -> Map.merge(base, section)
      _ -> base
    end
  end

  defp default_goals_section do
    case SymphonyElixir.Config.section("codex") do
      %{} = section -> section
      _ -> %{}
    end
  end

  defp do_start_session(port, workspace, session_policies, opts, section) do
    case send_initialize(port) do
      :ok -> start_or_resume_thread(port, workspace, session_policies, opts, section)
      {:error, reason} -> {:error, reason}
    end
  end

  # Goal-mode runs may resolve the issue's durable Codex thread from the
  # workspace sidecar. Interactive callers can explicitly provide their own
  # persisted thread id. Runs with neither source start a fresh thread.
  defp start_or_resume_thread(port, workspace, session_policies, opts, section) do
    case resumable_thread_id(workspace, opts, section) do
      {:ok, thread_id} ->
        case resume_thread_with_provenance(port, thread_id, session_policies, opts) do
          {:ok, %{thread_id: resumed_id} = thread_context} ->
            Logger.info("Codex resumed thread thread_id=#{resumed_id}")
            {:ok, thread_context, :resumed}

          {:error, reason} ->
            {:error, {:resume_conversation_failed, thread_id, reason}}
        end

      :error ->
        start_fresh_thread(port, workspace, session_policies, opts)
    end
  end

  defp start_fresh_thread(port, workspace, session_policies, opts) do
    case start_thread_with_provenance(port, workspace, session_policies, opts) do
      {:ok, thread_context} -> {:ok, thread_context, :started}
      other -> other
    end
  end

  defp maybe_set_thread_name(_port, _thread_id, nil), do: :ok

  defp maybe_set_thread_name(port, thread_id, name) when is_binary(name) do
    case String.trim(name) do
      "" ->
        :ok

      trimmed ->
        case request_thread_name_set(port, thread_id, trimmed) do
          :ok ->
            :ok

          {:error, reason} ->
            Logger.warning("Codex native thread name sync failed thread_id=#{thread_id}: #{inspect(reason)}")

            :ok
        end
    end
  end

  defp maybe_set_thread_name(_port, _thread_id, _name), do: :ok

  defp request_thread_name_set(port, thread_id, name) do
    send_message(port, %{
      "method" => "thread/name/set",
      "id" => @thread_name_set_id,
      "params" => %{"threadId" => thread_id, "name" => name}
    })

    case await_response(port, @thread_name_set_id) do
      {:ok, _result} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp maybe_archive_on_stop(%{port: port, thread_id: thread_id}, opts) do
    if Keyword.get(opts, :archive_on_stop, false) == true do
      try do
        # The completed turn is authoritative. A server that disconnects while
        # handling this optional request must not take down the linked caller.
        :erlang.unlink(port)

        send_message(port, %{
          "method" => "thread/archive",
          "id" => @thread_archive_id,
          "params" => %{"threadId" => thread_id}
        })

        case await_response(port, @thread_archive_id) do
          {:ok, _result} ->
            :ok

          {:error, reason} ->
            Logger.warning("Codex auxiliary thread archive failed thread_id=#{thread_id}: #{inspect(reason)}")

            :ok
        end
      catch
        kind, reason ->
          Logger.warning("Codex auxiliary thread archive failed thread_id=#{thread_id}: #{inspect({kind, reason})}")

          :ok
      end
    else
      :ok
    end
  end

  # An explicit resume target belongs to the caller and is honored for both
  # interactive and goal-mode runs. Resolving a workspace sidecar remains
  # goal-only so ordinary orchestrator turns still start independent threads.
  defp resumable_thread_id(workspace, opts, section) do
    case Keyword.get(opts, :conversation_ref) do
      %ConversationRef{provider: "codex", conversation_id: conversation_id} ->
        {:ok, conversation_id}

      _ ->
        if goal_opt?(opts) and CodexConfig.goals_enabled?(section),
          do: Session.resolve(workspace, opts),
          else: :error
    end
  end

  defp goal_opt?(opts) do
    Keyword.get(opts, :goal_mode, false) == true or
      case Keyword.get(opts, :goal) do
        goal when is_binary(goal) -> String.trim(goal) != ""
        _ -> false
      end
  end

  defp start_thread(port, workspace, session_policies, opts) do
    with {:ok, %{thread_id: thread_id}} <-
           start_thread_with_provenance(port, workspace, session_policies, opts) do
      {:ok, thread_id}
    end
  end

  defp start_thread_with_provenance(
         port,
         workspace,
         %{approval_policy: approval_policy, thread_sandbox: thread_sandbox},
         opts
       ) do
    params =
      %{
        "approvalPolicy" => approval_policy,
        "sandbox" => thread_sandbox,
        "cwd" => Path.expand(workspace),
        "dynamicTools" => Keyword.get(opts, :dynamic_tools, DynamicTool.coding_agent_tool_specs())
      }
      |> maybe_put_param("model", Keyword.get(opts, :model))
      |> maybe_put_param("developerInstructions", Keyword.get(opts, :developer_instructions))

    send_message(port, %{
      "method" => "thread/start",
      "id" => @thread_start_id,
      "params" => params
    })

    case await_response(port, @thread_start_id) do
      {:ok, %{"thread" => thread_payload} = result} ->
        case thread_payload do
          %{"id" => thread_id} ->
            {:ok,
             %{
               thread_id: thread_id,
               resolved_model: normalize_native_string(Map.get(result, "model")),
               resolved_effort: normalize_native_string(Map.get(result, "reasoningEffort"))
             }}

          _ ->
            {:error, {:invalid_thread_payload, thread_payload}}
        end

      other ->
        other
    end
  end

  # Codex restores persisted dynamicTools on resume when none are supplied, so we
  # intentionally omit them here and reuse the recorded session configuration.
  defp resume_thread(port, thread_id, session_policies, opts) do
    with {:ok, %{thread_id: resumed_id}} <-
           resume_thread_with_provenance(port, thread_id, session_policies, opts) do
      {:ok, resumed_id}
    end
  end

  defp resume_thread_with_provenance(
         port,
         thread_id,
         %{approval_policy: approval_policy, thread_sandbox: thread_sandbox},
         opts
       ) do
    params =
      %{
        "threadId" => thread_id,
        "approvalPolicy" => approval_policy,
        "sandbox" => thread_sandbox
      }
      |> maybe_put_param("model", Keyword.get(opts, :model))
      |> maybe_put_param("developerInstructions", Keyword.get(opts, :developer_instructions))

    send_message(port, %{
      "method" => "thread/resume",
      "id" => @thread_resume_id,
      "params" => params
    })

    case await_response(port, @thread_resume_id) do
      {:ok, %{"thread" => %{"id" => resumed_id}} = result} when is_binary(resumed_id) ->
        {:ok,
         %{
           thread_id: resumed_id,
           resolved_model: normalize_native_string(Map.get(result, "model")),
           resolved_effort: normalize_native_string(Map.get(result, "reasoningEffort"))
         }}

      {:ok, %{"thread" => thread_payload}} ->
        {:error, {:invalid_thread_payload, thread_payload}}

      other ->
        other
    end
  end

  defp normalize_native_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      normalized -> normalized
    end
  end

  defp normalize_native_string(_value), do: nil

  # Goal state is owned by the Codex thread. On a freshly started thread we set
  # the initial objective (the operator's intent). On a resumed thread we read
  # the persisted goal first and only seed an objective when the thread does not
  # already have one — avoiding an accidental objective replacement that would
  # reset native usage accounting.
  # Returns `{goal_state, goal_map_or_nil}`. The goal map is the native goal
  # already returned by the underlying get/set, so callers can mirror it into the
  # session sidecar without issuing an extra `thread/goal/get`.
  defp establish_goal(port, thread_id, :started, opts, section) do
    maybe_set_goal(port, thread_id, Keyword.get(opts, :goal), section)
  end

  defp establish_goal(port, thread_id, :resumed, opts, section) do
    if goal_opt?(opts) do
      case request_goal_get(port, thread_id) do
        {:ok, %{} = goal} ->
          {:ok, goal_state_from_status(goal_status_value(goal)), goal}

        {:ok, nil} ->
          maybe_set_goal(port, thread_id, Keyword.get(opts, :goal), section)

        {:error, reason} ->
          {:error, {:goal_status_failed, reason}}
      end
    else
      {:ok, :not_requested, nil}
    end
  end

  defp maybe_set_goal(_port, _thread_id, nil, _section), do: {:ok, :not_requested, nil}

  defp maybe_set_goal(port, thread_id, goal, section) when is_binary(goal) do
    case String.trim(goal) do
      "" -> {:error, {:goal_activation_failed, :empty_objective}}
      trimmed -> set_goal(port, thread_id, %{objective: trimmed, status: "active"}, section)
    end
  end

  defp maybe_set_goal(_port, _thread_id, _goal, _section),
    do: {:error, {:goal_activation_failed, :invalid_objective}}

  # Session-start goal set: gated on `goals_enabled` and reduced to a
  # `{goal_state, goal_map}` pair for the turn loop and sidecar mirror. Control-
  # plane mutations use `request_goal_set/3`.
  defp set_goal(port, thread_id, attrs, section) do
    if CodexConfig.goals_enabled?(section) do
      case request_goal_set(port, thread_id, attrs) do
        {:ok, goal} ->
          status = goal_status_value(goal) || Map.get(attrs, :status) || "active"
          {:ok, goal_state_from_status(status), goal}

        {:error, reason} ->
          {:error, {:goal_activation_failed, reason}}
      end
    else
      {:error, {:goal_activation_failed, :goals_disabled}}
    end
  end

  defp control_thread_id(workspace, opts) do
    case Keyword.get(opts, :thread_id) do
      id when is_binary(id) and id != "" ->
        {:ok, id}

      _ ->
        case Session.resolve(workspace, opts) do
          {:ok, id} -> {:ok, id}
          :error -> {:error, :no_codex_thread}
        end
    end
  end

  # Resolve and resume the durable control thread, or start a new durable thread
  # only when the issue has none yet. A stale stored identity is an explicit
  # error: replacing it would silently sever the native goal history.
  defp ensure_control_thread(port, workspace, session_policies, opts) do
    case control_thread_id(workspace, opts) do
      {:ok, thread_id} ->
        case resume_thread(port, thread_id, session_policies, opts) do
          {:ok, resumed_id} ->
            {:ok, resumed_id, :resumed}

          {:error, reason} ->
            {:error, {:resume_conversation_failed, thread_id, reason}}
        end

      {:error, :no_codex_thread} ->
        start_control_thread(port, workspace, session_policies, opts)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp start_control_thread(port, workspace, session_policies, opts) do
    case start_thread(port, workspace, session_policies, opts) do
      {:ok, thread_id} -> {:ok, thread_id, :started}
      other -> other
    end
  end

  # Mirror the native goal established for this session into the workspace
  # sidecar so dormant execution views (no live worker) can surface the Codex
  # goal without opening a fresh app-server connection. Reuses the goal already
  # returned by `establish_goal` (no extra RPC). Only writes when a goal exists;
  # explicit clears go through GoalControl / hard reset.
  defp maybe_mirror_session_goal(workspace, %{} = goal), do: Session.put_goal(workspace, goal)
  defp maybe_mirror_session_goal(_workspace, _goal), do: :ok

  # Keep the sidecar goal mirror in sync with control-plane goal operations so
  # dormant display reflects the latest native goal/clear.
  defp mirror_command_result({:ok, %{} = _goal} = result, workspace) do
    Session.put_goal(workspace, elem(result, 1))
    result
  end

  defp mirror_command_result({:ok, :cleared} = result, workspace) do
    Session.put_goal(workspace, nil)
    result
  end

  defp mirror_command_result({:ok, nil} = result, workspace) do
    Session.put_goal(workspace, nil)
    result
  end

  defp mirror_command_result(other, _workspace), do: other

  defp apply_goal_command(port, thread_id, :get, _section), do: request_goal_get(port, thread_id)

  defp apply_goal_command(port, thread_id, :clear, section) do
    if CodexConfig.goals_enabled?(section) do
      case request_goal_clear(port, thread_id) do
        {:ok, _cleared} -> {:ok, :cleared}
        other -> other
      end
    else
      {:error, :goals_disabled}
    end
  end

  defp apply_goal_command(port, thread_id, {:set, attrs}, section) when is_map(attrs) do
    if CodexConfig.goals_enabled?(section) do
      request_goal_set(port, thread_id, attrs)
    else
      {:error, :goals_disabled}
    end
  end

  defp request_goal_set(port, thread_id, attrs) do
    send_message(port, %{
      "method" => "thread/goal/set",
      "id" => @goal_set_id,
      "params" => goal_set_params(thread_id, attrs)
    })

    case await_response(port, @goal_set_id) do
      {:ok, result} -> {:ok, goal_from_result(result)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp request_goal_get(port, thread_id) do
    send_message(port, %{
      "method" => "thread/goal/get",
      "id" => @goal_get_id,
      "params" => %{"threadId" => thread_id}
    })

    case await_response(port, @goal_get_id) do
      {:ok, result} -> {:ok, goal_from_result(result)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp request_goal_clear(port, thread_id) do
    send_message(port, %{
      "method" => "thread/goal/clear",
      "id" => @goal_clear_id,
      "params" => %{"threadId" => thread_id}
    })

    case await_response(port, @goal_clear_id) do
      {:ok, result} when is_map(result) -> {:ok, Map.get(result, "cleared", true)}
      {:ok, _result} -> {:ok, true}
      {:error, reason} -> {:error, reason}
    end
  end

  defp goal_set_params(thread_id, attrs) do
    %{"threadId" => thread_id}
    |> maybe_put_param("objective", Map.get(attrs, :objective))
    |> maybe_put_param("status", Map.get(attrs, :status))
    |> put_token_budget(Map.get(attrs, :token_budget, :omit))
  end

  # `tokenBudget` uses double-option semantics: omit the key to leave it
  # unchanged, send `null` to remove the budget, or an integer to set it.
  defp put_token_budget(params, :omit), do: params
  defp put_token_budget(params, value), do: Map.put(params, "tokenBudget", value)

  defp goal_from_result(result) when is_map(result) do
    case Map.get(result, "goal") do
      %{} = goal -> goal
      _ -> nil
    end
  end

  defp goal_from_result(_result), do: nil

  defp goal_status_value(%{} = goal), do: Map.get(goal, "status") || Map.get(goal, :status)
  defp goal_status_value(_goal), do: nil

  defp goal_state_from_status(status) do
    case normalize_goal_status(status) do
      :active -> :active
      _other -> :inactive
    end
  end

  defp turn_input(prompt, attachments) do
    alias SymphonyElixir.Assistant.Payload

    Payload.turn_input_items(prompt, attachments)
  end

  defp maybe_put_param(params, _key, nil), do: params
  defp maybe_put_param(params, _key, ""), do: params
  defp maybe_put_param(params, key, value), do: Map.put(params, key, value)

  defp reasoning_effort(nil), do: nil
  defp reasoning_effort(effort) when is_binary(effort), do: effort

  defp start_turn(port, thread_id, prompt, issue, workspace, approval_policy, turn_sandbox_policy, opts) do
    attachments = Keyword.get(opts, :attachments, [])

    params =
      %{
        "threadId" => thread_id,
        "input" => turn_input(prompt, attachments),
        "cwd" => Path.expand(workspace),
        "title" => "#{issue.identifier}: #{issue.title}",
        "approvalPolicy" => approval_policy,
        "sandboxPolicy" => turn_sandbox_policy
      }
      |> maybe_put_param("model", Keyword.get(opts, :model))
      |> maybe_put_param("effort", reasoning_effort(Keyword.get(opts, :effort)))

    send_message(port, %{
      "method" => "turn/start",
      "id" => @turn_start_id,
      "params" => params
    })

    case await_response(port, @turn_start_id) do
      {:ok, %{"turn" => %{"id" => turn_id}}} -> {:ok, turn_id}
      other -> other
    end
  end

  defp await_turn_completion(port, on_message, tool_executor, auto_approve_requests, turn_ctx) do
    receive_loop(port, on_message, Config.agent_turn_timeout_ms(), "", tool_executor, auto_approve_requests, turn_ctx)
  end

  defp receive_loop(port, on_message, timeout_ms, pending_line, tool_executor, auto_approve_requests, turn_ctx) do
    receive do
      {^port, {:data, {:eol, chunk}}} ->
        complete_line = pending_line <> to_string(chunk)
        handle_incoming(port, on_message, complete_line, timeout_ms, tool_executor, auto_approve_requests, turn_ctx)

      {^port, {:data, {:noeol, chunk}}} ->
        receive_loop(
          port,
          on_message,
          timeout_ms,
          pending_line <> to_string(chunk),
          tool_executor,
          auto_approve_requests,
          turn_ctx
        )

      {^port, {:exit_status, status}} ->
        {:error, {:port_exit, status}}

      {:codex_steer, input, reply_to} ->
        turn_ctx = send_steer(port, turn_ctx, input, reply_to)
        receive_loop(port, on_message, timeout_ms, pending_line, tool_executor, auto_approve_requests, turn_ctx)

      {:codex_user_input, request_id, answers, reply_to} ->
        send_message(port, %{"id" => request_id, "result" => %{"answers" => answers}})
        if is_pid(reply_to), do: send(reply_to, {:user_input_ok, request_id})
        receive_loop(port, on_message, timeout_ms, pending_line, tool_executor, auto_approve_requests, turn_ctx)

      {:codex_approval, request_id, decision, reply_to} ->
        send_message(port, %{"id" => request_id, "result" => %{"decision" => decision}})
        if is_pid(reply_to), do: send(reply_to, {:approval_ok, request_id})
        receive_loop(port, on_message, timeout_ms, pending_line, tool_executor, auto_approve_requests, turn_ctx)

      {:codex_interrupt} ->
        send_interrupt(port, turn_ctx)
        receive_loop(port, on_message, timeout_ms, pending_line, tool_executor, auto_approve_requests, turn_ctx)

      {:agent_interrupt} ->
        send_interrupt(port, turn_ctx)
        receive_loop(port, on_message, timeout_ms, pending_line, tool_executor, auto_approve_requests, turn_ctx)

      {:kill_tool, _tool_call_id} ->
        kill_port_children(port)
        receive_loop(port, on_message, timeout_ms, pending_line, tool_executor, auto_approve_requests, turn_ctx)
    after
      timeout_ms ->
        {:error, :turn_timeout}
    end
  end

  defp send_steer(port, turn_ctx, input, reply_to) do
    do_send_steer(port, turn_ctx, input, reply_to, false)
  end

  defp do_send_steer(
         port,
         %{thread_id: thread_id, turn_id: turn_id, next_id: next_id, pending: pending} = turn_ctx,
         input,
         reply_to,
         retried?
       ) do
    send_message(port, %{
      "method" => "turn/steer",
      "id" => next_id,
      "params" => %{
        "threadId" => thread_id,
        "expectedTurnId" => turn_id,
        "input" => input
      }
    })

    entry = %{reply_to: reply_to, input: input, retried: retried?}
    %{turn_ctx | next_id: next_id + 1, pending: Map.put(pending, next_id, entry)}
  end

  defp send_interrupt(port, %{thread_id: thread_id, turn_id: turn_id, next_id: next_id}) do
    send_message(port, %{
      "method" => "turn/interrupt",
      "id" => next_id,
      "params" => %{"threadId" => thread_id, "turnId" => turn_id}
    })

    :ok
  end

  defp handle_incoming(port, on_message, data, timeout_ms, tool_executor, auto_approve_requests, turn_ctx) do
    payload_string = to_string(data)

    case Jason.decode(payload_string) do
      {:ok, %{"method" => "turn/completed"} = payload} ->
        case turn_completion_result(payload, turn_ctx) do
          {:ok, payload} ->
            emit_turn_event(on_message, :turn_completed, payload, payload_string, port, payload)

            {:ok,
             %{
               completion_payload: payload,
               goal_update: Map.get(turn_ctx, :latest_goal_update),
               resolved_model: Map.get(turn_ctx, :resolved_model),
               resolved_effort: Map.get(turn_ctx, :resolved_effort)
             }}

          {:error, {:turn_failed, reason}} ->
            Logger.warning(
              "Codex turn reported completed after an error event with no agent output; " <>
                "treating as failed reason=#{inspect(reason)}"
            )

            emit_turn_event(
              on_message,
              :turn_failed,
              payload,
              payload_string,
              port,
              %{"error" => %{"message" => reason}}
            )

            {:error, {:turn_failed, reason}}
        end

      {:ok, %{"method" => "error"} = payload} ->
        emit_message(
          on_message,
          :notification,
          %{payload: payload, raw: payload_string},
          metadata_from_message(port, payload)
        )

        turn_ctx = record_turn_error(turn_ctx, payload)
        receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)

      {:ok, %{"method" => "item/agentMessage/delta"} = payload} ->
        turn_ctx = mark_agent_message(turn_ctx, payload)

        handle_turn_method(
          port,
          on_message,
          payload,
          payload_string,
          "item/agentMessage/delta",
          timeout_ms,
          tool_executor,
          auto_approve_requests,
          turn_ctx
        )

      {:ok, %{"method" => "turn/failed", "params" => _} = payload} ->
        emit_turn_event(
          on_message,
          :turn_failed,
          payload,
          payload_string,
          port,
          Map.get(payload, "params")
        )

        {:error, {:turn_failed, Map.get(payload, "params")}}

      {:ok, %{"method" => "turn/cancelled", "params" => _} = payload} ->
        emit_turn_event(
          on_message,
          :turn_cancelled,
          payload,
          payload_string,
          port,
          Map.get(payload, "params")
        )

        {:error, {:turn_cancelled, Map.get(payload, "params")}}

      {:ok, %{"id" => id} = payload} when is_map_key(turn_ctx.pending, id) ->
        turn_ctx = route_steer_response(port, turn_ctx, id, payload)
        receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)

      {:ok, %{"method" => method} = payload}
      when is_binary(method) ->
        handle_turn_method(
          port,
          on_message,
          payload,
          payload_string,
          method,
          timeout_ms,
          tool_executor,
          auto_approve_requests,
          turn_ctx
        )

      {:ok, payload} ->
        emit_message(
          on_message,
          :other_message,
          %{
            payload: payload,
            raw: payload_string
          },
          metadata_from_message(port, payload)
        )

        receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)

      {:error, _reason} ->
        log_non_json_stream_line(payload_string, "turn stream")

        emit_message(
          on_message,
          :malformed,
          %{
            payload: payload_string,
            raw: payload_string
          },
          metadata_from_message(port, %{raw: payload_string})
        )

        receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)
    end
  end

  defp route_steer_response(port, %{pending: pending} = turn_ctx, id, payload) do
    {entry, rest} = Map.pop(pending, id)
    handle_steer_response(port, %{turn_ctx | pending: rest}, entry, payload)
  end

  # A `turn/steer` rejected with "expected active turn id X but found Y" means our
  # cached `expectedTurnId` is stale relative to the app-server's active turn
  # (a known race at turn boundaries in long sessions). The error carries the
  # server's current turn id, so we resync to it and retry the steer exactly once
  # before surfacing the failure — mirroring the Codex app-server clients.
  defp handle_steer_response(port, turn_ctx, %{reply_to: reply_to, input: input, retried: false}, %{"error" => error}) do
    case steer_turn_mismatch_id(error) do
      actual when is_binary(actual) and actual != "" ->
        Logger.info("Codex turn/steer expectedTurnId stale; resyncing to active turn_id=#{actual} and retrying once")

        turn_ctx
        |> Map.put(:turn_id, actual)
        |> then(&do_send_steer(port, &1, input, reply_to, true))

      _ ->
        notify_steer_reply(reply_to, {:steer_error, error})
        turn_ctx
    end
  end

  defp handle_steer_response(_port, turn_ctx, %{reply_to: reply_to}, %{"error" => error}) do
    notify_steer_reply(reply_to, {:steer_error, error})
    turn_ctx
  end

  defp handle_steer_response(_port, turn_ctx, %{reply_to: reply_to}, %{"result" => result}) do
    notify_steer_reply(reply_to, {:steer_ok, result})
    turn_ctx
  end

  defp handle_steer_response(_port, turn_ctx, _entry, _payload), do: turn_ctx

  defp notify_steer_reply(reply_to, message) when is_pid(reply_to), do: send(reply_to, message)
  defp notify_steer_reply(_reply_to, _message), do: :ok

  defp steer_turn_mismatch_id(%{"message" => message}), do: steer_turn_mismatch_id(message)

  defp steer_turn_mismatch_id(message) when is_binary(message) do
    case Regex.run(~r/expected active turn id `[^`]*` but found `([^`]+)`/, message) do
      [_, actual] -> actual
      _ -> nil
    end
  end

  defp steer_turn_mismatch_id(_), do: nil

  # A Codex turn can emit a top-level `error` notification (transient model/API
  # failure) and still report `turn/completed` with no agent output. Without this
  # guard the orchestrator treats the empty turn as success and immediately fires
  # the next continuation turn, producing a tight zero-token loop. We only fail
  # the turn when an error was seen AND the turn produced no agent message, so a
  # turn that recovered and answered is still treated as completed.
  defp turn_completion_result(_payload, %{turn_error: error, agent_message?: false})
       when is_binary(error) and error != "" do
    {:error, {:turn_failed, error}}
  end

  defp turn_completion_result(payload, _turn_ctx), do: {:ok, payload}

  defp record_turn_error(turn_ctx, payload) do
    message = extract_error_message(payload) || Map.get(turn_ctx, :turn_error) || "codex error"
    Map.put(turn_ctx, :turn_error, message)
  end

  defp extract_error_message(payload) when is_map(payload) do
    [
      ["params", "error", "message"],
      [:params, :error, :message],
      ["params", "message"],
      [:params, :message],
      ["error", "message"],
      [:error, :message],
      ["params", "msg", "message"],
      [:params, :msg, :message]
    ]
    |> Enum.find_value(fn path ->
      case dig(payload, path) do
        value when is_binary(value) and value != "" -> value
        _ -> nil
      end
    end)
  end

  defp extract_error_message(_payload), do: nil

  defp context_window_failure?({:turn_failed, reason}), do: context_window_failure?(reason)
  defp context_window_failure?({:error, reason}), do: context_window_failure?(reason)

  defp context_window_failure?(%{} = reason) do
    context_window_error_code?(codex_error_code(reason)) or
      context_window_failure?(extract_error_message(reason))
  end

  defp context_window_failure?(message) when is_binary(message) do
    normalized = String.downcase(message)

    String.contains?(normalized, "contextwindowexceeded") or
      (String.contains?(normalized, "context window") and
         (String.contains?(normalized, "out of room") or String.contains?(normalized, "exceed")))
  end

  defp context_window_failure?(_reason), do: false

  defp context_window_error_code?("ContextWindowExceeded"), do: true
  defp context_window_error_code?("context_window_exceeded"), do: true
  defp context_window_error_code?(code) when is_binary(code), do: String.downcase(code) == "contextwindowexceeded"
  defp context_window_error_code?(_code), do: false

  defp codex_error_code(reason) when is_map(reason) do
    [
      ["error", "codexErrorInfo", "code"],
      ["error", "codexErrorInfo", "type"],
      ["params", "error", "codexErrorInfo", "code"],
      ["params", "error", "codexErrorInfo", "type"],
      ["codexErrorInfo", "code"],
      ["codexErrorInfo", "type"]
    ]
    |> Enum.find_value(fn path ->
      case dig(reason, path) do
        value when is_binary(value) and value != "" -> value
        _ -> nil
      end
    end)
  end

  defp mark_agent_message(turn_ctx, payload) do
    if agent_message_delta_present?(payload) do
      Map.put(turn_ctx, :agent_message?, true)
    else
      turn_ctx
    end
  end

  defp agent_message_delta_present?(payload) when is_map(payload) do
    [
      ["params", "delta"],
      [:params, :delta],
      ["params", "text"],
      [:params, :text]
    ]
    |> Enum.find_value(false, fn path ->
      case dig(payload, path) do
        value when is_binary(value) and value != "" -> true
        _ -> nil
      end
    end)
  end

  defp agent_message_delta_present?(_payload), do: false

  defp emit_turn_event(on_message, event, payload, payload_string, port, payload_details) do
    emit_message(
      on_message,
      event,
      %{
        payload: payload,
        raw: payload_string,
        details: payload_details
      },
      metadata_from_message(port, payload)
    )
  end

  defp handle_turn_method(
         port,
         on_message,
         payload,
         payload_string,
         method,
         timeout_ms,
         tool_executor,
         auto_approve_requests,
         turn_ctx
       ) do
    metadata = metadata_from_message(port, payload)

    turn_ctx =
      turn_ctx
      |> record_goal_update(method, payload)
      |> record_model_reroute(method, payload)
      |> record_thread_settings(method, payload)

    case maybe_handle_approval_request(
           port,
           method,
           payload,
           payload_string,
           on_message,
           metadata,
           tool_executor,
           auto_approve_requests,
           Map.get(turn_ctx, :interactive_user_input, false)
         ) do
      :input_required ->
        emit_message(
          on_message,
          :turn_input_required,
          %{payload: payload, raw: payload_string},
          metadata
        )

        {:error, {:turn_input_required, payload}}

      :awaiting_user_input ->
        receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)

      :approved ->
        receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)

      :approval_required ->
        emit_message(
          on_message,
          :approval_required,
          %{payload: payload, raw: payload_string},
          metadata
        )

        {:error, {:approval_required, payload}}

      :unhandled ->
        if needs_input?(method, payload) do
          emit_message(
            on_message,
            :turn_input_required,
            %{payload: payload, raw: payload_string},
            metadata
          )

          {:error, {:turn_input_required, payload}}
        else
          emit_message(
            on_message,
            :notification,
            %{
              payload: payload,
              raw: payload_string
            },
            metadata
          )

          Logger.debug("Codex notification: #{inspect(method)}")
          receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)
        end
    end
  end

  defp record_goal_update(turn_ctx, "thread/goal/updated", %{"params" => %{"goal" => %{} = goal}}) do
    Map.put(turn_ctx, :latest_goal_update, goal)
  end

  defp record_goal_update(turn_ctx, _method, _payload), do: turn_ctx

  defp record_model_reroute(
         turn_ctx,
         "model/rerouted",
         %{"params" => %{"toModel" => model}}
       )
       when is_binary(model) do
    Map.put(turn_ctx, :resolved_model, String.trim(model))
  end

  defp record_model_reroute(turn_ctx, _method, _payload), do: turn_ctx

  defp record_thread_settings(
         turn_ctx,
         "thread/settings/updated",
         %{"params" => %{"threadSettings" => settings}}
       )
       when is_map(settings) do
    turn_ctx
    |> maybe_record_native_setting(:resolved_model, Map.get(settings, "model"))
    |> maybe_record_native_setting(:resolved_effort, Map.get(settings, "effort"))
  end

  defp record_thread_settings(turn_ctx, _method, _payload), do: turn_ctx

  defp maybe_record_native_setting(turn_ctx, key, value) when is_binary(value) do
    case String.trim(value) do
      "" -> turn_ctx
      normalized -> Map.put(turn_ctx, key, normalized)
    end
  end

  defp maybe_record_native_setting(turn_ctx, _key, _value), do: turn_ctx

  defp maybe_handle_approval_request(
         port,
         "item/commandExecution/requestApproval",
         %{"id" => id} = payload,
         payload_string,
         on_message,
         metadata,
         _tool_executor,
         auto_approve_requests,
         interactive_user_input
       ) do
    approve_or_require(
      port,
      id,
      "acceptForSession",
      payload,
      payload_string,
      on_message,
      metadata,
      auto_approve_requests,
      interactive_user_input
    )
  end

  defp maybe_handle_approval_request(
         port,
         "item/tool/call",
         %{"id" => id, "params" => params} = payload,
         payload_string,
         on_message,
         metadata,
         tool_executor,
         _auto_approve_requests,
         _interactive_user_input
       ) do
    tool_name = tool_call_name(params)
    arguments = tool_call_arguments(params)

    emit_message(on_message, :tool_call_started, %{payload: payload, raw: payload_string}, metadata)

    result = safe_execute_tool(tool_executor, tool_name, arguments)

    send_message(port, %{
      "id" => id,
      "result" => result
    })

    event =
      case result do
        %{"success" => true} -> :tool_call_completed
        _ when is_nil(tool_name) -> :unsupported_tool_call
        _ -> :tool_call_failed
      end

    emit_message(on_message, event, %{payload: payload, raw: payload_string, result: result}, metadata)

    :approved
  end

  defp maybe_handle_approval_request(
         port,
         "execCommandApproval",
         %{"id" => id} = payload,
         payload_string,
         on_message,
         metadata,
         _tool_executor,
         auto_approve_requests,
         interactive_user_input
       ) do
    approve_or_require(
      port,
      id,
      "approved_for_session",
      payload,
      payload_string,
      on_message,
      metadata,
      auto_approve_requests,
      interactive_user_input
    )
  end

  defp maybe_handle_approval_request(
         port,
         "applyPatchApproval",
         %{"id" => id} = payload,
         payload_string,
         on_message,
         metadata,
         _tool_executor,
         auto_approve_requests,
         interactive_user_input
       ) do
    approve_or_require(
      port,
      id,
      "approved_for_session",
      payload,
      payload_string,
      on_message,
      metadata,
      auto_approve_requests,
      interactive_user_input
    )
  end

  defp maybe_handle_approval_request(
         port,
         "item/fileChange/requestApproval",
         %{"id" => id} = payload,
         payload_string,
         on_message,
         metadata,
         _tool_executor,
         auto_approve_requests,
         interactive_user_input
       ) do
    approve_or_require(
      port,
      id,
      "acceptForSession",
      payload,
      payload_string,
      on_message,
      metadata,
      auto_approve_requests,
      interactive_user_input
    )
  end

  defp maybe_handle_approval_request(
         port,
         "item/tool/requestUserInput",
         %{"id" => id, "params" => params} = payload,
         payload_string,
         on_message,
         metadata,
         _tool_executor,
         auto_approve_requests,
         interactive_user_input
       ) do
    maybe_auto_answer_tool_request_user_input(
      port,
      id,
      params,
      payload,
      payload_string,
      on_message,
      metadata,
      auto_approve_requests,
      interactive_user_input
    )
  end

  defp maybe_handle_approval_request(
         _port,
         _method,
         _payload,
         _payload_string,
         _on_message,
         _metadata,
         _tool_executor,
         _auto_approve_requests,
         _interactive_user_input
       ) do
    :unhandled
  end

  defp approve_or_require(
         port,
         id,
         decision,
         payload,
         payload_string,
         on_message,
         metadata,
         true,
         _interactive_user_input
       ) do
    send_message(port, %{"id" => id, "result" => %{"decision" => decision}})

    emit_message(
      on_message,
      :approval_auto_approved,
      %{payload: payload, raw: payload_string, decision: decision},
      metadata
    )

    :approved
  end

  defp approve_or_require(
         _port,
         _id,
         _decision,
         _payload,
         _payload_string,
         _on_message,
         _metadata,
         false,
         false
       ) do
    :approval_required
  end

  defp approve_or_require(
         _port,
         id,
         decision,
         payload,
         payload_string,
         on_message,
         metadata,
         false,
         true
       ) do
    emit_message(
      on_message,
      :approval_required,
      %{payload: payload, raw: payload_string, request_id: id, decision: decision},
      metadata
    )

    :awaiting_user_input
  end

  defp maybe_auto_answer_tool_request_user_input(
         port,
         id,
         params,
         payload,
         payload_string,
         on_message,
         metadata,
         auto_approve_requests,
         interactive_user_input
       ) do
    approval = tool_request_user_input_approval_answers(params)

    cond do
      auto_approve_requests and match?({:ok, _, _}, approval) ->
        {:ok, answers, decision} = approval
        send_message(port, %{"id" => id, "result" => %{"answers" => answers}})

        emit_message(
          on_message,
          :approval_auto_approved,
          %{payload: payload, raw: payload_string, decision: decision},
          metadata
        )

        :approved

      interactive_user_input ->
        emit_message(
          on_message,
          :user_input_required,
          %{
            payload: payload,
            raw: payload_string,
            request_id: id,
            item_id: Map.get(params, "itemId"),
            questions: Map.get(params, "questions") || []
          },
          metadata
        )

        :awaiting_user_input

      true ->
        reply_with_non_interactive_tool_input_answer(
          port,
          id,
          params,
          payload,
          payload_string,
          on_message,
          metadata
        )
    end
  end

  defp tool_request_user_input_approval_answers(%{"questions" => questions}) when is_list(questions) do
    answers =
      Enum.reduce_while(questions, %{}, fn question, acc ->
        case tool_request_user_input_approval_answer(question) do
          {:ok, question_id, answer_label} ->
            {:cont, Map.put(acc, question_id, %{"answers" => [answer_label]})}

          :error ->
            {:halt, :error}
        end
      end)

    case answers do
      :error -> :error
      answer_map when map_size(answer_map) > 0 -> {:ok, answer_map, "Approve this Session"}
      _ -> :error
    end
  end

  defp tool_request_user_input_approval_answers(_params), do: :error

  defp reply_with_non_interactive_tool_input_answer(
         port,
         id,
         params,
         payload,
         payload_string,
         on_message,
         metadata
       ) do
    case tool_request_user_input_unavailable_answers(params) do
      {:ok, answers} ->
        send_message(port, %{"id" => id, "result" => %{"answers" => answers}})

        emit_message(
          on_message,
          :tool_input_auto_answered,
          %{payload: payload, raw: payload_string, answer: @non_interactive_tool_input_answer},
          metadata
        )

        :approved

      :error ->
        :input_required
    end
  end

  defp tool_request_user_input_unavailable_answers(%{"questions" => questions}) when is_list(questions) do
    answers =
      Enum.reduce_while(questions, %{}, fn question, acc ->
        case tool_request_user_input_question_id(question) do
          {:ok, question_id} ->
            {:cont, Map.put(acc, question_id, %{"answers" => [@non_interactive_tool_input_answer]})}

          :error ->
            {:halt, :error}
        end
      end)

    case answers do
      :error -> :error
      answer_map when map_size(answer_map) > 0 -> {:ok, answer_map}
      _ -> :error
    end
  end

  defp tool_request_user_input_unavailable_answers(_params), do: :error

  defp tool_request_user_input_question_id(%{"id" => question_id}) when is_binary(question_id),
    do: {:ok, question_id}

  defp tool_request_user_input_question_id(_question), do: :error

  defp tool_request_user_input_approval_answer(%{"id" => question_id, "options" => options})
       when is_binary(question_id) and is_list(options) do
    case tool_request_user_input_approval_option_label(options) do
      nil -> :error
      answer_label -> {:ok, question_id, answer_label}
    end
  end

  defp tool_request_user_input_approval_answer(_question), do: :error

  defp tool_request_user_input_approval_option_label(options) do
    options
    |> Enum.map(&tool_request_user_input_option_label/1)
    |> Enum.reject(&is_nil/1)
    |> case do
      labels ->
        Enum.find(labels, &(&1 == "Approve this Session")) ||
          Enum.find(labels, &(&1 == "Approve Once")) ||
          Enum.find(labels, &approval_option_label?/1)
    end
  end

  defp tool_request_user_input_option_label(%{"label" => label}) when is_binary(label), do: label
  defp tool_request_user_input_option_label(_option), do: nil

  defp approval_option_label?(label) when is_binary(label) do
    normalized_label =
      label
      |> String.trim()
      |> String.downcase()

    String.starts_with?(normalized_label, "approve") or String.starts_with?(normalized_label, "allow")
  end

  defp await_response(port, request_id) do
    with_timeout_response(port, request_id, Config.agent_read_timeout_ms(), "")
  end

  defp with_timeout_response(port, request_id, timeout_ms, pending_line) do
    receive do
      {^port, {:data, {:eol, chunk}}} ->
        complete_line = pending_line <> to_string(chunk)
        handle_response(port, request_id, complete_line, timeout_ms)

      {^port, {:data, {:noeol, chunk}}} ->
        with_timeout_response(port, request_id, timeout_ms, pending_line <> to_string(chunk))

      {^port, {:exit_status, status}} ->
        {:error, {:port_exit, status}}
    after
      timeout_ms ->
        {:error, :response_timeout}
    end
  end

  defp handle_response(port, request_id, data, timeout_ms) do
    payload = to_string(data)

    case Jason.decode(payload) do
      {:ok, %{"id" => ^request_id, "error" => error}} ->
        {:error, {:response_error, error}}

      {:ok, %{"id" => ^request_id, "result" => result}} ->
        {:ok, result}

      {:ok, %{"id" => ^request_id} = response_payload} ->
        {:error, {:response_error, response_payload}}

      {:ok, %{} = other} ->
        Logger.debug("Ignoring message while waiting for response: #{inspect(other)}")
        with_timeout_response(port, request_id, timeout_ms, "")

      {:error, _} ->
        log_non_json_stream_line(payload, "response stream")
        with_timeout_response(port, request_id, timeout_ms, "")
    end
  end

  defp log_non_json_stream_line(data, stream_label) do
    text =
      data
      |> to_string()
      |> String.trim()
      |> String.slice(0, @max_stream_log_bytes)

    if text != "" do
      if String.match?(text, ~r/\b(error|warn|warning|failed|fatal|panic|exception)\b/i) do
        Logger.warning("Codex #{stream_label} output: #{text}")
      else
        Logger.debug("Codex #{stream_label} output: #{text}")
      end
    end
  end

  defp issue_context(%{id: issue_id, identifier: identifier}) do
    "issue_id=#{issue_id} issue_identifier=#{identifier}"
  end

  defp stop_port(port) when is_port(port) do
    case :erlang.port_info(port, :os_pid) do
      {:os_pid, os_pid} -> kill_process_group(os_pid)
      _ -> :ok
    end

    close_port(port)
  end

  defp kill_process_group(os_pid) do
    pid_str = to_string(os_pid)

    # Reap the whole Codex subtree before closing the port. pkill -P walks direct
    # children; under an Erlang Port the app-server workload is a child of this pid.
    kill_process_children(pid_str)
    System.cmd("kill", ["-9", pid_str], stderr_to_stdout: true)
    :ok
  end

  defp kill_port_children(port) when is_port(port) do
    case :erlang.port_info(port, :os_pid) do
      {:os_pid, os_pid} ->
        os_pid
        |> to_string()
        |> kill_process_children()

      _ ->
        :ok
    end
  end

  defp kill_process_children(pid_str) when is_binary(pid_str) do
    System.cmd("pkill", ["-9", "-P", pid_str], stderr_to_stdout: true)
    :ok
  end

  defp close_port(port) when is_port(port) do
    case :erlang.port_info(port) do
      :undefined ->
        :ok

      _ ->
        try do
          Port.close(port)
          :ok
        rescue
          ArgumentError ->
            :ok
        catch
          :exit, _reason ->
            :ok
        end
    end
  end

  @spec normalize_event(map()) :: map()
  @impl true
  def normalize_event(event) when is_map(event) do
    event
    |> normalize_usage()
    |> normalize_rate_limits()
  end

  defp normalize_usage(event) do
    payloads = [
      event[:usage],
      Map.get(event, "usage"),
      event[:payload],
      Map.get(event, "payload"),
      event
    ]

    usage =
      Enum.find_value(payloads, &absolute_token_usage/1) ||
        Enum.find_value(payloads, &turn_completed_usage/1) ||
        Enum.find_value(payloads, &direct_token_map/1)

    Map.put(event, :usage, canonicalize_usage(usage))
  end

  defp normalize_rate_limits(event) do
    raw =
      find_rate_limits(event[:rate_limits]) ||
        find_rate_limits(Map.get(event, "rate_limits")) ||
        find_rate_limits(event[:payload]) ||
        find_rate_limits(Map.get(event, "payload")) ||
        find_rate_limits(event)

    Map.put(event, :rate_limits, raw)
  end

  defp absolute_token_usage(payload) when is_map(payload) do
    paths = [
      ["params", "msg", "payload", "info", "total_token_usage"],
      [:params, :msg, :payload, :info, :total_token_usage],
      ["params", "msg", "info", "total_token_usage"],
      [:params, :msg, :info, :total_token_usage],
      ["params", "tokenUsage", "total"],
      [:params, :tokenUsage, :total],
      ["params", "usage"],
      [:params, :usage],
      ["tokenUsage", "total"],
      [:tokenUsage, :total]
    ]

    Enum.find_value(paths, fn path ->
      value = dig(payload, path)
      if is_map(value) and has_token_field?(value), do: value
    end)
  end

  defp absolute_token_usage(_), do: nil

  defp turn_completed_usage(payload) when is_map(payload) do
    method = Map.get(payload, "method") || Map.get(payload, :method)

    if method in ["turn/completed", :turn_completed] do
      direct =
        Map.get(payload, "usage") || Map.get(payload, :usage) ||
          dig(payload, ["params", "usage"]) || dig(payload, [:params, :usage])

      if is_map(direct) and has_token_field?(direct), do: direct
    end
  end

  defp turn_completed_usage(_), do: nil

  defp direct_token_map(payload) when is_map(payload) do
    if has_token_field?(payload), do: payload
  end

  defp direct_token_map(_), do: nil

  defp canonicalize_usage(nil), do: nil

  defp canonicalize_usage(raw) when is_map(raw) do
    input =
      token_value(
        raw,
        ~w(input_tokens prompt_tokens inputTokens promptTokens)a ++
          ~w(input_tokens prompt_tokens inputTokens promptTokens)
      )

    output =
      token_value(
        raw,
        ~w(output_tokens completion_tokens outputTokens completionTokens)a ++
          ~w(output_tokens completion_tokens outputTokens completionTokens)
      )

    total = token_value(raw, ~w(total_tokens total totalTokens)a ++ ~w(total_tokens total totalTokens))

    if input || output || total do
      %{input_tokens: input || 0, output_tokens: output || 0, total_tokens: total || 0}
    end
  end

  defp token_value(map, keys) do
    Enum.find_value(keys, fn key ->
      map |> Map.get(key) |> parse_token_value()
    end)
  end

  defp parse_token_value(v) when is_integer(v) and v >= 0, do: v

  defp parse_token_value(v) when is_binary(v) do
    case Integer.parse(String.trim(v)) do
      {n, _} when n >= 0 -> n
      _ -> nil
    end
  end

  defp parse_token_value(_), do: nil

  defp has_token_field?(map) when is_map(map) do
    token_keys =
      ~w(input_tokens output_tokens total_tokens prompt_tokens completion_tokens
                    inputTokens outputTokens totalTokens promptTokens completionTokens)a ++
        ~w(input_tokens output_tokens total_tokens prompt_tokens completion_tokens
                    inputTokens outputTokens totalTokens promptTokens completionTokens)

    Enum.any?(token_keys, fn key ->
      map |> Map.get(key) |> token_like_value?()
    end)
  end

  defp has_token_field?(_), do: false

  defp token_like_value?(v) when is_integer(v) and v >= 0, do: true

  defp token_like_value?(v) when is_binary(v) do
    case Integer.parse(String.trim(v)) do
      {n, _} when n >= 0 -> true
      _ -> false
    end
  end

  defp token_like_value?(_), do: false

  defp find_rate_limits(payload) when is_map(payload) do
    direct = Map.get(payload, "rate_limits") || Map.get(payload, :rate_limits)

    cond do
      rate_limits_map?(direct) -> direct
      rate_limits_map?(payload) -> payload
      true -> search_rate_limits(payload)
    end
  end

  defp find_rate_limits(_), do: nil

  defp search_rate_limits(payload) when is_map(payload) do
    Enum.find_value(Map.values(payload), fn
      value when is_map(value) -> find_rate_limits(value)
      _ -> nil
    end)
  end

  defp rate_limits_map?(payload) when is_map(payload) do
    has_id =
      !is_nil(
        Map.get(payload, "limit_id") || Map.get(payload, :limit_id) ||
          Map.get(payload, "limit_name") || Map.get(payload, :limit_name)
      )

    has_buckets =
      Enum.any?(
        ["primary", :primary, "secondary", :secondary, "credits", :credits],
        &Map.has_key?(payload, &1)
      )

    has_id and has_buckets
  end

  defp rate_limits_map?(_), do: false

  defp dig(map, []), do: map

  defp dig(map, [key | rest]) when is_map(map) do
    case Map.get(map, key) do
      nil -> nil
      value -> dig(value, rest)
    end
  end

  defp dig(_, _), do: nil

  defp emit_message(on_message, event, details, metadata) when is_function(on_message, 1) do
    message = metadata |> Map.merge(details) |> Map.put(:event, event) |> Map.put(:timestamp, DateTime.utc_now())
    on_message.(message)
  end

  defp metadata_from_message(port, payload) do
    port |> port_metadata() |> maybe_set_usage(payload)
  end

  defp maybe_set_usage(metadata, payload) when is_map(payload) do
    usage = Map.get(payload, "usage") || Map.get(payload, :usage)

    if is_map(usage) do
      Map.put(metadata, :usage, usage)
    else
      metadata
    end
  end

  defp maybe_set_usage(metadata, _payload), do: metadata

  defp default_on_message(_message), do: :ok

  # A client-side tool must never abort the agent run. Any exception, exit, or
  # throw from the executor is converted into a structured tool failure result so
  # Codex receives the error and the agent can record it and try another
  # approach. This mirrors the resilience the Claude/Cursor MCP ToolGateway
  # already provides for those agents.
  defp safe_execute_tool(tool_executor, tool_name, arguments) do
    tool_executor.(tool_name, arguments)
  rescue
    exception ->
      Logger.error(
        "Codex client tool #{inspect(tool_name)} crashed: #{Exception.message(exception)}\n" <>
          Exception.format_stacktrace(__STACKTRACE__)
      )

      tool_crash_result(tool_name, Exception.message(exception))
  catch
    kind, reason ->
      Logger.error(
        "Codex client tool #{inspect(tool_name)} #{kind}: #{inspect(reason)}\n" <>
          Exception.format_stacktrace(__STACKTRACE__)
      )

      tool_crash_result(tool_name, Exception.format(kind, reason, __STACKTRACE__))
  end

  defp tool_crash_result(tool_name, detail) do
    payload = %{
      "error" => %{
        "message" =>
          "Tool #{tool_name || "unknown"} failed with an internal error and was not executed. " <>
            "The failure has been recorded — try a different approach or another tool instead of giving up.",
        "reason" => detail
      }
    }

    %{
      "success" => false,
      "contentItems" => [
        %{"type" => "inputText", "text" => Jason.encode!(payload, pretty: true)}
      ]
    }
  end

  defp tool_call_name(params) when is_map(params) do
    case Map.get(params, "tool") || Map.get(params, :tool) || Map.get(params, "name") || Map.get(params, :name) do
      name when is_binary(name) ->
        case String.trim(name) do
          "" -> nil
          trimmed -> trimmed
        end

      _ ->
        nil
    end
  end

  defp tool_call_name(_params), do: nil

  defp tool_call_arguments(params) when is_map(params) do
    Map.get(params, "arguments") || Map.get(params, :arguments) || %{}
  end

  defp tool_call_arguments(_params), do: %{}

  defp send_message(port, message) do
    line = Jason.encode!(message) <> "\n"
    Port.command(port, line)
  end

  defp needs_input?(method, payload)
       when is_binary(method) and is_map(payload) do
    String.starts_with?(method, "turn/") && input_required_method?(method, payload)
  end

  defp needs_input?(_method, _payload), do: false

  defp input_required_method?(method, payload) when is_binary(method) do
    method in [
      "turn/input_required",
      "turn/needs_input",
      "turn/need_input",
      "turn/request_input",
      "turn/request_response",
      "turn/provide_input",
      "turn/approval_required"
    ] || request_payload_requires_input?(payload)
  end

  defp request_payload_requires_input?(payload) do
    params = Map.get(payload, "params")
    needs_input_field?(payload) || needs_input_field?(params)
  end

  defp needs_input_field?(payload) when is_map(payload) do
    Map.get(payload, "requiresInput") == true or
      Map.get(payload, "needsInput") == true or
      Map.get(payload, "input_required") == true or
      Map.get(payload, "inputRequired") == true or
      Map.get(payload, "type") == "input_required" or
      Map.get(payload, "type") == "needs_input"
  end

  defp needs_input_field?(_payload), do: false
end
