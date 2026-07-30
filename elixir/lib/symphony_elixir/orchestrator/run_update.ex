defmodule SymphonyElixir.Orchestrator.RunUpdate do
  @moduledoc """
  Folds a live agent update into a running entry.

  Given the current running entry and a decoded agent update, `integrate/2`
  returns the updated entry (new timestamps, last message/event, session id,
  goal, app-server pid, turn count and accumulated token totals) alongside the
  `t:SymphonyElixir.Orchestrator.TokenDelta.t/0` for that update so the caller
  can drive token-progress side effects.

  Pure: composes `GoalState` and `TokenDelta`, no orchestrator state and no
  side effects.
  """

  alias SymphonyElixir.Orchestrator.{GoalState, TokenDelta}

  @doc """
  Merges `update` into `running_entry`, returning `{updated_entry, token_delta}`.
  """
  @spec integrate(map(), map()) :: {map(), TokenDelta.t()}
  def integrate(running_entry, %{event: event, timestamp: timestamp} = update) do
    token_delta = TokenDelta.for_update(running_entry, update)
    agent_input_tokens = Map.get(running_entry, :agent_input_tokens, 0)
    agent_output_tokens = Map.get(running_entry, :agent_output_tokens, 0)
    agent_total_tokens = Map.get(running_entry, :agent_total_tokens, 0)
    codex_app_server_pid = Map.get(running_entry, :codex_app_server_pid)
    last_reported_input = Map.get(running_entry, :codex_last_reported_input_tokens, 0)
    last_reported_output = Map.get(running_entry, :codex_last_reported_output_tokens, 0)
    last_reported_total = Map.get(running_entry, :codex_last_reported_total_tokens, 0)
    turn_count = Map.get(running_entry, :turn_count, 0)

    {
      Map.merge(running_entry, %{
        last_codex_timestamp: timestamp,
        last_codex_message: summarize_codex_update(update),
        session_id: session_id_for_update(running_entry.session_id, update),
        last_codex_event: event,
        goal: GoalState.for_update(running_entry, update),
        codex_app_server_pid: codex_app_server_pid_for_update(codex_app_server_pid, update),
        agent_input_tokens: agent_input_tokens + token_delta.input_tokens,
        agent_output_tokens: agent_output_tokens + token_delta.output_tokens,
        agent_total_tokens: agent_total_tokens + token_delta.total_tokens,
        codex_last_reported_input_tokens: max(last_reported_input, token_delta.input_reported),
        codex_last_reported_output_tokens: max(last_reported_output, token_delta.output_reported),
        codex_last_reported_total_tokens: max(last_reported_total, token_delta.total_reported),
        turn_count: turn_count_for_update(turn_count, running_entry.session_id, update)
      }),
      token_delta
    }
  end

  defp codex_app_server_pid_for_update(_existing, %{codex_app_server_pid: pid})
       when is_binary(pid),
       do: pid

  defp codex_app_server_pid_for_update(_existing, %{codex_app_server_pid: pid})
       when is_integer(pid),
       do: Integer.to_string(pid)

  defp codex_app_server_pid_for_update(_existing, %{codex_app_server_pid: pid}) when is_list(pid),
    do: to_string(pid)

  defp codex_app_server_pid_for_update(existing, _update), do: existing

  defp session_id_for_update(_existing, %{session_id: session_id}) when is_binary(session_id),
    do: session_id

  defp session_id_for_update(_existing, %{conversation_id: conversation_id})
       when is_binary(conversation_id),
       do: conversation_id

  defp session_id_for_update(existing, _update), do: existing

  defp turn_count_for_update(existing_count, _existing_session_id, %{event: :session_started})
       when is_integer(existing_count),
       do: existing_count + 1

  defp turn_count_for_update(existing_count, _existing_session_id, _update)
       when is_integer(existing_count),
       do: existing_count

  defp turn_count_for_update(_existing_count, _existing_session_id, _update), do: 0

  defp summarize_codex_update(update) do
    %{
      event: update[:event],
      message: update[:payload] || update[:raw],
      timestamp: update[:timestamp]
    }
  end
end
