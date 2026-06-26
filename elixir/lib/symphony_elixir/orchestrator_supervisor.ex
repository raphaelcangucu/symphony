defmodule SymphonyElixir.OrchestratorSupervisor do
  @moduledoc """
  Orchestrator subtree. Owns `Orchestrator.TaskSupervisor` (the Codex turn
  tasks/Ports), the orchestrator itself, dev-server management, and the
  observability reporter. Restarted by `mix symphony.ctl update --orchestrator`;
  untouched by a `--web` restart so in-flight Codex turns survive.
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

  @spec child_specs() :: [Supervisor.child_spec() | {module(), term()} | module()]
  def child_specs do
    [
      SymphonyElixir.Orchestrator.RunnerSupervisor,
      SymphonyElixir.DevServer.Manager,
      SymphonyElixir.DevServer.Reconciler,
      SymphonyElixir.PullRequestMonitor.Reconciler,
      SymphonyElixir.KnowledgeBase.DailyPromoter,
      SymphonyElixir.Observability.Reporter
    ]
  end
end
