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

  alias SymphonyElixir.LocalTracker.Templates

  @impl true
  def start(_type, _args) do
    :ok = SymphonyElixir.LogFile.configure()

    base_children = [
      {Phoenix.PubSub, name: SymphonyElixir.PubSub},
      SymphonyElixir.Observability.Registry,
      SymphonyElixir.Repo,
      SymphonyElixir.LocalTracker.CloneSupervisor,
      %{
        id: :seed_builtin_templates,
        start:
          {Task, :start_link,
           [
             fn ->
               try do
                 Templates.import_builtins()
               rescue
                 _ -> :ok
               end
             end
           ]},
        restart: :temporary
      },
      SymphonyElixir.LocalTracker.Viewer.Server,
      {Task.Supervisor, name: SymphonyElixir.TaskSupervisor},
      SymphonyElixir.GitHub.ReadCache,
      SymphonyElixir.WorkflowStore,
      SymphonyElixir.Orchestrator,
      SymphonyElixir.PublicRouting,
      SymphonyElixir.DevServer.Manager,
      SymphonyElixir.DevServer.Reconciler,
      SymphonyElixir.Observability.Reporter,
      SymphonyElixir.HttpServer,
      SymphonyElixir.StatusDashboard
    ]

    children = base_children ++ editor_children()

    Supervisor.start_link(
      children,
      strategy: :one_for_one,
      name: SymphonyElixir.Supervisor
    )
  end

  @impl true
  def stop(_state) do
    SymphonyElixir.StatusDashboard.render_offline_status()
    :ok
  end

  defp editor_children do
    if editor_enabled?() do
      [SymphonyElixir.Editor.Server]
    else
      []
    end
  end

  defp editor_enabled? do
    SymphonyElixir.Config.editor_enabled?()
  rescue
    _ -> false
  end
end
