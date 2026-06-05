defmodule SymphonyElixir.AgentRunner do
  @moduledoc """
  Executes a single issue in an isolated workspace with the configured coding agent.
  """

  require Logger
  alias SymphonyElixir.{AgentPreference, CodingAgent, Config, InstanceConfig, Issue, ProjectConfig, PromptBuilder, Repo, Tracker, Workspace}
  alias SymphonyElixir.GitHub.Client, as: GitHubClient
  alias SymphonyElixir.GitHub.ReadCache
  alias SymphonyElixir.LocalTracker.Context

  # The open-PR check runs every turn for "In Progress" issues; cache it per
  # repo+issue so a long-running issue does not re-query GitHub each turn.
  @open_pr_cache_ttl_ms 120_000

  @type run_outcome :: :completed | {:incomplete, :max_turns}

  @spec run(map(), pid() | nil, keyword()) :: :ok | no_return()
  def run(issue, codex_update_recipient \\ nil, opts \\ []) do
    opts =
      issue
      |> issue_goal_opts(opts)
      |> Keyword.put_new_lazy(:project_config, fn -> resolve_project_config(issue) end)

    Logger.info("Starting agent run for #{issue_context(issue)}")

    outcome = do_run(issue, codex_update_recipient, opts)
    report_outcome(codex_update_recipient, issue, outcome)
    :ok
  end

  @spec do_run(map(), pid() | nil, keyword()) :: run_outcome() | no_return()
  defp do_run(issue, codex_update_recipient, opts) do
    case Workspace.create_for_issue(issue) do
      {:ok, workspace} ->
        try do
          case Workspace.run_before_run_hook(workspace, issue) do
            :ok ->
              workspace
              |> run_codex_turns(issue, codex_update_recipient, opts)
              |> handle_turns_result(issue)

            {:error, reason} ->
              fail_run(issue, reason)
          end
        after
          Workspace.run_after_run_hook(workspace, issue)
        end

      {:error, reason} ->
        fail_run(issue, reason)
    end
  end

  defp handle_turns_result(:completed, _issue), do: :completed
  defp handle_turns_result({:incomplete, _reason} = outcome, _issue), do: outcome
  defp handle_turns_result({:error, reason}, issue), do: fail_run(issue, reason)

  @spec fail_run(map(), term()) :: no_return()
  defp fail_run(issue, reason) do
    Logger.error("Agent run failed for #{issue_context(issue)}: #{inspect(reason)}")
    raise RuntimeError, "Agent run failed for #{issue_context(issue)}: #{inspect(reason)}"
  end

  defp report_outcome(recipient, %Issue{id: id}, outcome)
       when is_pid(recipient) and is_binary(id) do
    send(recipient, {:agent_outcome, id, outcome})
    :ok
  end

  defp report_outcome(_recipient, _issue, _outcome), do: :ok

  defp codex_message_handler(recipient, issue) do
    agent_kind = issue_agent_kind(issue)

    fn message ->
      normalized = CodingAgent.normalize_event(message, agent_kind)
      send_codex_update(recipient, issue, normalized)
    end
  end

  @spec issue_agent_kind(SymphonyElixir.Issue.t()) :: String.t()
  def issue_agent_kind(%Issue{} = issue) do
    task_kind = AgentPreference.normalize(issue.agent_kind)
    AgentPreference.resolve(task_labels(task_kind), project_agent_kind(issue))
  end

  def issue_agent_kind(_issue), do: AgentPreference.resolve([], nil)

  defp task_labels(nil), do: []
  defp task_labels(kind), do: ["symphony:" <> kind]

  defp project_agent_kind(%Issue{project_slug: slug}) when is_binary(slug) and slug != "" do
    case Context.get_project(slug) do
      {:ok, project} ->
        project |> Repo.preload(:setup) |> ProjectConfig.resolve() |> Map.get(:agent_kind)

      {:error, _reason} ->
        nil
    end
  end

  defp project_agent_kind(_issue), do: nil

  @spec resolve_project_config(Issue.t()) :: ProjectConfig.t() | nil
  defp resolve_project_config(%Issue{project_slug: slug}) when is_binary(slug) do
    case Context.get_project(slug) do
      {:ok, project} -> project |> Repo.preload(:setup) |> ProjectConfig.resolve()
      _ -> nil
    end
  end

  defp resolve_project_config(_issue), do: nil

  defp issue_goal_opts(issue, opts) do
    if Keyword.has_key?(opts, :goal) do
      opts
    else
      maybe_put_issue_goal(opts, issue_agent_kind(issue), Map.get(issue, :agent_goal))
    end
  end

  defp maybe_put_issue_goal(opts, "codex", goal) when is_binary(goal) do
    case String.trim(goal) do
      "" -> opts
      trimmed -> Keyword.put(opts, :goal, trimmed)
    end
  end

  defp maybe_put_issue_goal(opts, _agent_kind, _goal), do: opts

  defp send_codex_update(recipient, %Issue{id: issue_id}, message)
       when is_binary(issue_id) and is_pid(recipient) do
    send(recipient, {:codex_worker_update, issue_id, message})
    :ok
  end

  defp send_codex_update(_recipient, _issue, _message), do: :ok

  defp agent_turn_opts(opts, agent_kind, codex_update_recipient, issue) do
    Keyword.merge(opts, agent_kind: agent_kind, on_message: codex_message_handler(codex_update_recipient, issue))
  end

  defp run_codex_turns(workspace, issue, codex_update_recipient, opts) do
    max_turns = Keyword.get(opts, :max_turns, project_max_turns(Keyword.get(opts, :project_config)))
    issue_state_fetcher = Keyword.get(opts, :issue_state_fetcher, &Tracker.fetch_issue_states_by_ids/1)

    agent_kind = issue_agent_kind(issue)
    workspace_root = Workspace.workspace_root_for(issue)

    session_opts =
      [workspace_root: workspace_root]
      |> maybe_put_codex_config(Keyword.get(opts, :project_config))

    with {:ok, session} <- CodingAgent.start_session(workspace, agent_kind, session_opts) do
      try do
        do_run_codex_turns(
          session,
          workspace,
          issue,
          codex_update_recipient,
          opts,
          issue_state_fetcher,
          agent_kind,
          1,
          max_turns
        )
      after
        CodingAgent.stop_session(session, agent_kind)
      end
    end
  end

  # The turn loop carries session, issue, and injected test dependencies explicitly.
  # credo:disable-for-next-line Credo.Check.Refactor.FunctionArity
  defp do_run_codex_turns(
         app_session,
         workspace,
         issue,
         codex_update_recipient,
         opts,
         issue_state_fetcher,
         agent_kind,
         turn_number,
         max_turns
       ) do
    prompt = build_turn_prompt(issue, opts, workspace, turn_number, max_turns)

    with {:ok, turn_session} <-
           CodingAgent.run_turn(
             app_session,
             prompt,
             issue,
             agent_turn_opts(opts, agent_kind, codex_update_recipient, issue)
           ) do
      Logger.info("Completed agent run for #{issue_context(issue)} session_id=#{turn_session[:session_id]} workspace=#{workspace} turn=#{turn_number}/#{max_turns}")

      case continue_with_issue?(issue, issue_state_fetcher, Keyword.get(opts, :project_config)) do
        {:continue, refreshed_issue} ->
          continue_or_stop_outer_turn_loop(
            app_session,
            workspace,
            refreshed_issue,
            codex_update_recipient,
            opts,
            issue_state_fetcher,
            agent_kind,
            turn_number,
            max_turns
          )

        {:done, _refreshed_issue} ->
          :completed

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp continue_or_stop_outer_turn_loop(
         app_session,
         workspace,
         refreshed_issue,
         codex_update_recipient,
         opts,
         issue_state_fetcher,
         agent_kind,
         turn_number,
         max_turns
       ) do
    cond do
      goal_mode?(opts) ->
        Logger.info("Stopping outer agent turn loop for #{issue_context(refreshed_issue)} because Codex goal mode handles continuation internally")

        :completed

      turn_number < max_turns ->
        Logger.info("Continuing agent run for #{issue_context(refreshed_issue)} after normal turn completion turn=#{turn_number}/#{max_turns}")

        do_run_codex_turns(
          app_session,
          workspace,
          refreshed_issue,
          codex_update_recipient,
          opts,
          issue_state_fetcher,
          agent_kind,
          turn_number + 1,
          max_turns
        )

      true ->
        Logger.info("Reached agent.max_turns for #{issue_context(refreshed_issue)} with issue still active; returning control to orchestrator")

        {:incomplete, :max_turns}
    end
  end

  defp build_turn_prompt(issue, opts, workspace, 1, _max_turns) do
    PromptBuilder.build_prompt(issue, Keyword.put(opts, :workspace, workspace))
  end

  defp build_turn_prompt(_issue, _opts, _workspace, turn_number, max_turns) do
    """
    Continuation guidance:

    - The previous turn completed normally, but the issue is still in an active state.
    - This is continuation turn ##{turn_number} of #{max_turns} for the current agent run.
    - Resume from the current workspace and workpad state instead of restarting from scratch.
    - The original task instructions and prior turn context are already present in this thread, so do not restate them before acting.
    - Focus on the remaining ticket work and do not end the turn while the issue stays active unless you are truly blocked.
    """
  end

  defp continue_with_issue?(%Issue{id: issue_id} = issue, issue_state_fetcher, project_config)
       when is_binary(issue_id) do
    case issue_state_fetcher.([issue_id]) do
      {:ok, [%Issue{} = refreshed_issue | _]} ->
        cond do
          wait_state?(refreshed_issue.state, project_config) ->
            {:done, refreshed_issue}

          open_pr_should_stop_turns?(refreshed_issue, project_config) ->
            Logger.info("Stopping agent turns for #{issue_context(refreshed_issue)}: open pull request while still in In Progress")

            {:done, refreshed_issue}

          active_issue_state?(refreshed_issue.state, project_config) ->
            {:continue, refreshed_issue}

          true ->
            {:done, refreshed_issue}
        end

      {:ok, []} ->
        {:done, issue}

      {:error, reason} ->
        {:error, {:issue_state_refresh_failed, reason}}
    end
  end

  defp continue_with_issue?(issue, _issue_state_fetcher, _project_config), do: {:done, issue}

  defp goal_mode?(opts) do
    case Keyword.get(opts, :goal) do
      goal when is_binary(goal) -> String.trim(goal) != ""
      _goal -> false
    end
  end

  defp wait_state?(state_name, project_config) when is_binary(state_name) do
    normalized_state = normalize_issue_state(state_name)

    project_config
    |> wait_states_for()
    |> Enum.any?(fn wait_state -> normalize_issue_state(wait_state) == normalized_state end)
  end

  defp wait_state?(_state_name, _project_config), do: false

  defp open_pr_should_stop_turns?(%Issue{state: state, identifier: identifier}, project_config)
       when is_binary(state) and is_binary(identifier) do
    project_tracker_kind(project_config) == "github" and
      normalize_issue_state(state) == "in progress" and
      github_issue_has_open_pull_request?(identifier)
  end

  defp open_pr_should_stop_turns?(_issue, _project_config), do: false

  # Thread the project's `codex:` section (from DB workflow_markdown) over instance
  # defaults so dispatch honors per-project command/approval/sandbox settings.
  defp maybe_put_codex_config(opts, %ProjectConfig{codex: project_codex}) when is_map(project_codex) do
    Keyword.put(opts, :codex_config, InstanceConfig.merge_codex_section(project_codex))
  end

  defp maybe_put_codex_config(opts, _project_config) do
    Keyword.put(opts, :codex_config, InstanceConfig.codex_section())
  end

  defp project_max_turns(%ProjectConfig{max_turns: n}) when is_integer(n) and n > 0, do: n
  defp project_max_turns(_project_config), do: Config.agent_max_turns()

  defp active_states_for(%ProjectConfig{active_states: states}) when is_list(states), do: states
  defp active_states_for(_project_config), do: Config.active_states()

  defp wait_states_for(%ProjectConfig{wait_states: states}) when is_list(states), do: states
  defp wait_states_for(_project_config), do: Config.wait_states()

  defp project_tracker_kind(%ProjectConfig{tracker_kind: kind}) when is_binary(kind), do: kind
  defp project_tracker_kind(_project_config), do: Config.tracker_kind()

  defp github_issue_has_open_pull_request?(identifier) do
    key = {:issue_open_pr, SymphonyElixir.GitHub.Config.repo(), identifier}

    result =
      ReadCache.fetch(key, fn -> GitHubClient.issue_has_open_pull_request?(identifier) end, @open_pr_cache_ttl_ms)

    case result do
      {:ok, true} -> true
      _ -> false
    end
  end

  defp active_issue_state?(state_name, project_config) when is_binary(state_name) do
    normalized_state = normalize_issue_state(state_name)

    project_config
    |> active_states_for()
    |> Enum.any?(fn active_state -> normalize_issue_state(active_state) == normalized_state end)
  end

  defp active_issue_state?(_state_name, _project_config), do: false

  defp normalize_issue_state(state_name) when is_binary(state_name) do
    state_name
    |> String.trim()
    |> String.downcase()
  end

  defp issue_context(%Issue{id: issue_id, identifier: identifier}) do
    "issue_id=#{issue_id} issue_identifier=#{identifier}"
  end
end
