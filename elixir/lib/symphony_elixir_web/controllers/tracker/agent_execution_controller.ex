defmodule SymphonyElixirWeb.Tracker.AgentExecutionController do
  @moduledoc "Exposes current agent execution status for the tracker board."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.AgentExecution
  alias SymphonyElixirWeb.TrackerPresenter

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params) do
    data = Enum.map(AgentExecution.list(), &TrackerPresenter.agent_execution/1)
    json(conn, %{data: data})
  end
end
