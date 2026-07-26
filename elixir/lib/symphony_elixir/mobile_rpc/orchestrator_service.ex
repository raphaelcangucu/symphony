defmodule SymphonyElixir.MobileRpc.OrchestratorService do
  @moduledoc "Projects real host orchestrator executions into the encrypted mobile RPC surface."

  alias SymphonyElixir.AgentExecution
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixirWeb.TrackerPresenter

  @spec list_executions() :: [map()]
  def list_executions do
    AgentExecution.list()
    |> Enum.map(&TrackerPresenter.agent_execution/1)
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
end
