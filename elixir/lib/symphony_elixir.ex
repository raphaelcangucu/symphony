defmodule SymphonyElixir do
  @moduledoc """
  Entry point for the Symphony orchestrator.
  """

  @doc """
  Start the orchestrator in the current BEAM node.
  """
  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    SymphonyElixir.Orchestrator.start_link(opts)
  end
end

defmodule SymphonyElixir.Application do
  @moduledoc """
  OTP application entrypoint that starts core supervisors and workers.
  """

  use Application

  @impl true
  def start(_type, _args) do
    :ok = SymphonyElixir.LogFile.configure()

    Supervisor.start_link(
      root_children(),
      strategy: :one_for_one,
      name: SymphonyElixir.Supervisor
    )
  end

  @impl true
  def stop(_state) do
    SymphonyElixir.StatusDashboard.render_offline_status()
    :ok
  end

  @doc """
  The four restartable sub-supervisors that make up the running daemon, in boot
  order. `:shared` must start before the others (it owns Repo/PubSub/registries).
  """
  @spec root_children() :: [module()]
  def root_children do
    [
      SymphonyElixir.SharedSupervisor,
      SymphonyElixir.OrchestratorSupervisor,
      SymphonyElixir.WebSupervisor,
      SymphonyElixir.EditorSupervisor
    ]
  end
end
