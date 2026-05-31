defmodule SymphonyElixir.AgentRunner do
  @moduledoc """
  Executes a single issue in an isolated workspace with the configured coding agent.
  """

  require Logger
  alias SymphonyElixir.{CodingAgent, Config, Issue, PromptBuilder, Tracker, Workspace}
  alias SymphonyElixir.GitHub.Client, as: GitHubClient

  @spec run(map(), pid() | nil, keyword()) :: :ok | no_return()
  def run(issue, codex_update_recipient \\ nil, opts \\ []) do
    Logger.info("Starting agent run for #{issue_context(issue)}")

    case Workspace.create_for_issue(issue) do
      {:ok, workspace} ->
        try do
          with :ok <- Workspace.run_before_run_hook(workspace, issue),
               :ok <- run_codex_turns(workspace, issue, codex_update_recipient, opts) do
            :ok
          else
            {:error, reason} ->
              Logger.error("Agent run failed for #{issue_context(issue)}: #{inspect(reason)}")
              raise RuntimeError, "Agent run failed for #{issue_context(issue)}: #{inspect(reason)}"
          end
        after
          Workspace.run_after_run_hook(workspace, issue)
        end

      {:error, reason} ->
        Logger.error("Agent run failed for #{issue_context(issue)}: #{inspect(reason)}")
        raise RuntimeError, "Agent run failed for #{issue_context(issue)}: #{inspect(reason)}"
    end
  end

  defp codex_message_handler(recipient, issue) do
    agent_kind = issue_agent_kind(issue)

    fn message ->
      normalized = CodingAgent.normalize_event(message, agent_kind)
      send_codex_update(recipient, issue, normalized)
    end
  end

  defp issue_agent_kind(%Issue{agent_kind: kind}) when is_binary(kind) and kind != "", do: kind
  defp issue_agent_kind(_issue), do: Config.default_agent_kind()

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
    max_turns = Keyword.get(opts, :max_turns, Config.agent_max_turns())
    issue_state_fetcher = Keyword.get(opts, :issue_state_fetcher, &Tracker.fetch_issue_states_by_ids/1)

    agent_kind = issue_agent_kind(issue)

    with {:ok, session} <- CodingAgent.start_session(workspace, agent_kind) do
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

      case continue_with_issue?(issue, issue_state_fetcher) do
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
          :ok

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

        :ok

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

        :ok
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

  defp continue_with_issue?(%Issue{id: issue_id} = issue, issue_state_fetcher) when is_binary(issue_id) do
    case issue_state_fetcher.([issue_id]) do
      {:ok, [%Issue{} = refreshed_issue | _]} ->
        cond do
          wait_state?(refreshed_issue.state) ->
            {:done, refreshed_issue}

          open_pr_should_stop_turns?(refreshed_issue) ->
            Logger.info("Stopping agent turns for #{issue_context(refreshed_issue)}: open pull request while still in In Progress")

            {:done, refreshed_issue}

          active_issue_state?(refreshed_issue.state) ->
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

  defp continue_with_issue?(issue, _issue_state_fetcher), do: {:done, issue}

  defp goal_mode?(opts) do
    case Keyword.get(opts, :goal) do
      goal when is_binary(goal) -> String.trim(goal) != ""
      _goal -> false
    end
  end

  defp wait_state?(state_name) when is_binary(state_name) do
    normalized_state = normalize_issue_state(state_name)

    Config.wait_states()
    |> Enum.any?(fn wait_state -> normalize_issue_state(wait_state) == normalized_state end)
  end

  defp wait_state?(_state_name), do: false

  defp open_pr_should_stop_turns?(%Issue{state: state, identifier: identifier})
       when is_binary(state) and is_binary(identifier) do
    Config.tracker_kind() == "github" and
      normalize_issue_state(state) == "in progress" and
      github_issue_has_open_pull_request?(identifier)
  end

  defp open_pr_should_stop_turns?(_issue), do: false

  defp github_issue_has_open_pull_request?(identifier) do
    case GitHubClient.issue_has_open_pull_request?(identifier) do
      {:ok, true} -> true
      _ -> false
    end
  end

  defp active_issue_state?(state_name) when is_binary(state_name) do
    normalized_state = normalize_issue_state(state_name)

    Config.active_states()
    |> Enum.any?(fn active_state -> normalize_issue_state(active_state) == normalized_state end)
  end

  defp active_issue_state?(_state_name), do: false

  defp normalize_issue_state(state_name) when is_binary(state_name) do
    state_name
    |> String.trim()
    |> String.downcase()
  end

  defp issue_context(%Issue{id: issue_id, identifier: identifier}) do
    "issue_id=#{issue_id} issue_identifier=#{identifier}"
  end
end
