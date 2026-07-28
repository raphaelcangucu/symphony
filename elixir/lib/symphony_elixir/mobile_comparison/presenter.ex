defmodule SymphonyElixir.MobileComparison.Presenter do
  @moduledoc "Builds the provider-neutral comparison snapshot consumed by mobile."

  alias SymphonyElixir.MobileComparison.Decision

  @terminal_statuses ~w(passed failed blocked saved completed error cancelled canceled)
  @passed_statuses ~w(passed saved completed)
  @failed_statuses ~w(failed blocked error cancelled canceled)

  @spec snapshot(map(), [map()]) :: map()
  def snapshot(parent, cells) when is_map(parent) and is_list(cells) do
    terminal = Enum.count(cells, &(value(&1, :status) in @terminal_statuses))
    passed = Enum.count(cells, &(value(&1, :status) in @passed_statuses))
    failed = Enum.count(cells, &(value(&1, :status) in @failed_statuses))

    %{
      "project_slug" => value(parent, :project_slug),
      "identifier" => value(parent, :identifier),
      "title" => value(parent, :title),
      "status" => if(terminal == length(cells), do: "completed", else: "running"),
      "progress" => %{
        "terminal" => terminal,
        "passed" => passed,
        "failed" => failed,
        "total" => length(cells)
      },
      "cells" => cells,
      "decision" => Decision.get(parent)
    }
  end

  @spec cell(map(), map(), map() | nil, map() | nil, [map()], [map()]) :: map()
  def cell(contract, child, thread, execution, previews, evidence) do
    status = cell_status(contract.path, thread, execution, evidence)

    %{
      "id" => contract.id,
      "path" => Atom.to_string(contract.path),
      "provider" => contract.provider,
      "requested_model" => contract.model,
      "requested_effort" => contract.effort,
      "effective_effort" => contract.effective_effort,
      "resolved_model" => resolved_value(thread, execution, :resolved_model),
      "resolved_effort" => resolved_value(thread, execution, :resolved_effort),
      "status" => status,
      "attempt" => attempt(thread, execution),
      "issue_identifier" => value(child, :identifier),
      "thread_id" => value(thread, :id),
      "execution_session_id" => value(execution, :execution_session_id),
      "latest_message" => resolved_value(thread, execution, :latest_message),
      "error" => presented_error(status, thread, execution),
      "previews" => previews,
      "evidence" => evidence
    }
  end

  defp cell_status(:session, thread, _execution, evidence) do
    durable_status = evidence |> evidence_for_thread(thread) |> evidence_status()

    cond do
      value(thread, :status) in @failed_statuses ->
        value(thread, :status)

      is_binary(durable_status) ->
        durable_status

      completed_without_output?(value(thread, :latest_message)) ->
        "failed"

      true ->
        case value(thread, :status) do
          "active" -> "live"
          "closed" -> "completed"
          "error" -> "error"
          nil -> "starting"
          status -> status
        end
    end
  end

  defp cell_status(:orchestrator, _thread, execution, _evidence),
    do: value(execution, :status) || "starting"

  defp evidence_status(evidence) when is_list(evidence) do
    case Enum.find_value(evidence, fn record ->
           case value(record, :status) do
             status when is_binary(status) -> status
             _other -> nil
           end
         end) do
      status when status in @failed_statuses -> "failed"
      status when status in @passed_statuses -> "passed"
      _other -> nil
    end
  end

  defp evidence_status(_evidence), do: nil

  defp evidence_for_thread(evidence, thread) when is_list(evidence) do
    expected_session_id =
      case value(thread, :id) do
        id when is_integer(id) -> "assistant-thread:#{id}"
        id when is_binary(id) and id != "" -> "assistant-thread:#{id}"
        _other -> nil
      end

    if is_binary(expected_session_id) do
      Enum.filter(evidence, fn record ->
        value(record, :session_id) in [nil, expected_session_id]
      end)
    else
      evidence
    end
  end

  defp evidence_for_thread(evidence, _thread), do: evidence

  defp completed_without_output?(message) when is_binary(message),
    do: String.ends_with?(message, "completed the turn without returning assistant text.")

  defp completed_without_output?(_message), do: false

  defp presented_error(status, thread, execution) when status in @failed_statuses,
    do: resolved_value(thread, execution, :error)

  defp presented_error(_status, _thread, _execution), do: nil

  defp attempt(thread, nil), do: (value(thread, :retry_attempt) || 0) + 1
  defp attempt(_thread, execution), do: (value(execution, :retry_attempt) || 0) + 1

  defp resolved_value(primary, secondary, key),
    do: value(primary, key) || value(secondary, key)

  defp value(nil, _key), do: nil
  defp value(map, key), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))
end
