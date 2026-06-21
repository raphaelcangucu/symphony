defmodule SymphonyElixir.SharedSupervisor do
  @moduledoc """
  Always-on infrastructure subtree: the single SQLite-writing `Repo`, PubSub,
  registries, the shared `Task.Supervisor`, sync engine, and public routing.
  Never restarted by `mix symphony.ctl update`; only torn down on a full daemon
  stop.
  """

  use Supervisor

  alias SymphonyElixir.LocalTracker.Templates

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
      {Phoenix.PubSub, name: SymphonyElixir.PubSub},
      SymphonyElixir.Assistant.GoalRun.registry_child_spec(),
      SymphonyElixir.Claude.AppServer.ToolGateway,
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
      SymphonyElixir.Tracker.Identity.Cache,
      {Task.Supervisor, name: SymphonyElixir.TaskSupervisor},
      SymphonyElixir.GitHub.ReadCache,
      SymphonyElixir.GitHub.RequestGateway,
      SymphonyElixir.Tracker.Sync.Engine,
      SymphonyElixir.PublicRouting
    ] ++ public_tunnel_children()
  end

  defp public_tunnel_children do
    if public_tunnel_enabled?(), do: [SymphonyElixir.Cloudflare.Tunnel], else: []
  end

  defp public_tunnel_enabled? do
    SymphonyElixir.Config.public_tunnel_enabled?()
  rescue
    _ -> false
  end
end
