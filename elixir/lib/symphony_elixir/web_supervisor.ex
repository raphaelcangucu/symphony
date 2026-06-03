defmodule SymphonyElixir.WebSupervisor do
  @moduledoc """
  Web subtree: the Phoenix/HTTP listener and the terminal status dashboard.
  This is the default `mix symphony.ctl update` target — restarting it recycles
  only the HTTP listener and leaves the orchestrator and editor running.
  """

  use Supervisor

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    Supervisor.init(child_specs(), strategy: :one_for_one)
  end

  @spec child_specs() :: [Supervisor.child_spec() | module()]
  def child_specs do
    [
      SymphonyElixir.HttpServer,
      SymphonyElixir.StatusDashboard
    ]
  end
end
