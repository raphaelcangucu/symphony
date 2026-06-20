defmodule SymphonyElixir.Orchestrator.RunnerSupervisor do
  @moduledoc """
  Pairs the `Orchestrator` GenServer with its Codex `Task.Supervisor` under a
  `:one_for_all` strategy so the two live and die together.

  If the orchestrator crashes it loses its in-memory `running`/`claimed` state;
  restarting the `Task.Supervisor` alongside it tears down any in-flight workers,
  so a rebooted orchestrator never re-dispatches an issue whose previous worker
  is still alive (the CDE-1139 duplicate-agent incident). The `Task.Supervisor`
  is started first so it is available before the orchestrator's first dispatch.
  """

  use Supervisor

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    Supervisor.init(child_specs(), strategy: :one_for_all)
  end

  @spec child_specs() :: [Supervisor.child_spec() | {module(), term()} | module()]
  def child_specs do
    [
      {Task.Supervisor, name: SymphonyElixir.Orchestrator.TaskSupervisor},
      SymphonyElixir.Orchestrator
    ]
  end
end
