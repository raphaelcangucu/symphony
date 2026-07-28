defmodule SymphonyElixir.MobileRpc.OrchestratorService do
  @moduledoc "Projects real host orchestrator executions into the encrypted mobile RPC surface."

  alias SymphonyElixir.AgentExecution
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixirWeb.TrackerPresenter

  @spec list_executions() :: [map()]
  def list_executions do
    executions =
      AgentExecution.list()
      |> Enum.map(&TrackerPresenter.agent_execution/1)

    History.list_threads(scope: "issue_execution", include_archived: true, limit: 10_000)
    |> Enum.filter(&(&1.status in ["active", "closed", "error"]))
    |> Enum.uniq_by(& &1.issue_identifier)
    |> Enum.reduce(executions, &attach_execution_thread/2)
  end

  @spec session_context(pos_integer()) ::
          {:ok, %{project_slug: String.t()}} | {:error, :not_found}
  def session_context(execution_session_id)
      when is_integer(execution_session_id) and execution_session_id > 0 do
    with {:ok, thread} <- History.get_thread(execution_session_id),
         "issue_execution" <- thread.scope,
         project_slug when is_binary(project_slug) and project_slug != "" <- thread.project_slug do
      {:ok, %{project_slug: project_slug}}
    else
      _reason -> {:error, :not_found}
    end
  end

  defp attach_execution_thread(thread, executions) do
    case Enum.find_index(executions, fn execution ->
           execution.issue_identifier == thread.issue_identifier and
             is_nil(execution.execution_session_id)
         end) do
      index when is_integer(index) ->
        List.update_at(executions, index, fn execution ->
          execution
          |> Map.put(:execution_session_id, thread.id)
          |> Map.update(:agent_kind, thread.agent_kind, &(&1 || thread.agent_kind))
          |> Map.update(:model, thread.resolved_model, &(&1 || thread.resolved_model))
        end)

      nil ->
        if Enum.any?(executions, &(&1.execution_session_id == thread.id)) do
          executions
        else
          [thread_execution(thread) | executions]
        end
    end
  end

  defp thread_execution(thread) do
    %{
      issue_id: nil,
      issue_identifier: thread.issue_identifier,
      status: thread_status(thread.status),
      agent_kind: thread.agent_kind,
      model: thread.resolved_model,
      session_id: nil,
      execution_session_id: thread.id,
      last_event: nil,
      last_message: nil,
      last_event_at: nil,
      turn_count: 0,
      runtime_seconds: 0,
      started_at: nil,
      retry_attempt: 0,
      error: history_only_error(thread.status),
      goal: nil,
      long_running: false,
      long_running_kind: nil,
      long_running_label: nil,
      parent_identifier: nil,
      bundle_role: "standalone",
      unit_id: nil,
      repo: nil,
      child_identifiers: [],
      tokens: %{input: 0, output: 0, total: 0}
    }
  end

  defp thread_status("active"), do: "error"
  defp thread_status("closed"), do: "saved"
  defp thread_status("error"), do: "error"

  defp history_only_error("active"),
    do: "Execution is not active on this host. Retry to recover."

  defp history_only_error(_status), do: nil
end
