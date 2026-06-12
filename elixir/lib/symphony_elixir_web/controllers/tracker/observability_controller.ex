defmodule SymphonyElixirWeb.Tracker.ObservabilityController do
  @moduledoc "JSON API for the global observability aggregate (hub side)."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Observability.Registry
  alias SymphonyElixir.PullRequestMonitor.MonitorState
  alias SymphonyElixir.PullRequestMonitor.Reconciler

  @pr_monitor_recent_limit 50

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params) do
    json(conn, %{data: Registry.list()})
  end

  @spec pr_monitor(Conn.t(), map()) :: Conn.t()
  def pr_monitor(conn, _params) do
    json(conn, %{
      data: %{
        heartbeat: Reconciler.stats(),
        evaluations: MonitorState.recent_summaries(@pr_monitor_recent_limit)
      }
    })
  end

  @spec report(Conn.t(), map()) :: Conn.t()
  def report(conn, params) do
    case Registry.put_report(params) do
      :ok ->
        conn |> put_status(202) |> json(%{data: %{accepted: true}})

      {:error, :missing_runtime_id} ->
        conn
        |> put_status(422)
        |> json(%{error: %{code: "invalid_report", message: "runtime_id is required"}})
    end
  end
end
