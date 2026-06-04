defmodule SymphonyElixir.Ctl do
  @moduledoc """
  In-daemon control surface invoked over distributed Erlang (`:erpc`) by the
  `mix symphony.ctl` task. Reloads modules whose `.beam` changed on disk, then
  restarts or stops the requested supervision subtrees. Pure helpers
  (`node_name/1`, `cookie/1`) are shared with the CLI for node discovery.
  """

  require Logger

  @type target :: :web | :orchestrator | :editor

  @default_ids %{
    web: SymphonyElixir.WebSupervisor,
    orchestrator: SymphonyElixir.OrchestratorSupervisor,
    editor: SymphonyElixir.EditorSupervisor
  }

  @default_node_name "symphony"
  @default_cookie "symphony-dev-cookie"

  # Assistant tool modules are hot-reloaded on every `make update` so dev edits
  # are picked up even when :code.modified_modules/0 is empty in a long-lived node.
  @assistant_reload_modules [
    SymphonyElixir.Assistant.CodexSession,
    SymphonyElixir.Assistant.DiscoveryTools,
    SymphonyElixir.Assistant.ProjectBoardTools,
    SymphonyElixir.Assistant.PullRequestLookup,
    SymphonyElixir.Assistant.ToolExecutor,
    SymphonyElixir.Assistant.ToolSchema
  ]

  @spec restart([target()], keyword()) :: {:ok, %{reloaded: [module()], restarted: [target()]}}
  def restart(targets, opts \\ []) when is_list(targets) do
    supervisor = Keyword.get(opts, :supervisor, SymphonyElixir.Supervisor)
    ids = Keyword.get(opts, :ids, @default_ids)
    reload_fun = Keyword.get(opts, :reload_fun, &reload_modified_modules/0)

    reloaded = reload_fun.()

    restarted =
      Enum.map(targets, fn target ->
        id = Map.fetch!(ids, target)
        _ = Supervisor.terminate_child(supervisor, id)

        case Supervisor.restart_child(supervisor, id) do
          {:ok, _pid} -> :ok
          {:ok, _pid, _info} -> :ok
          {:error, reason} -> Logger.error("ctl: restart #{inspect(id)} failed: #{inspect(reason)}")
        end

        target
      end)

    {:ok, %{reloaded: reloaded, restarted: restarted}}
  end

  @spec stop_subtrees([target()], keyword()) :: :ok
  def stop_subtrees(targets, opts \\ []) when is_list(targets) do
    supervisor = Keyword.get(opts, :supervisor, SymphonyElixir.Supervisor)
    ids = Keyword.get(opts, :ids, @default_ids)

    Enum.each(targets, fn target ->
      id = Map.fetch!(ids, target)
      _ = Supervisor.terminate_child(supervisor, id)
    end)

    :ok
  end

  @spec reload_modified_modules() :: [module()]
  def reload_modified_modules do
    (:code.modified_modules() ++ @assistant_reload_modules)
    |> Enum.uniq()
    |> Enum.filter(&:code.which/1)
    |> Enum.map(&reload_module/1)
  end

  defp reload_module(module) do
    :code.purge(module)
    :code.load_file(module)
    module
  end

  @spec node_name(map()) :: String.t()
  def node_name(env \\ System.get_env()) do
    base = Map.get(env, "SYMPHONY_NODE_NAME", @default_node_name)
    "#{base}@127.0.0.1"
  end

  @spec cookie(map()) :: String.t()
  def cookie(env \\ System.get_env()) do
    Map.get(env, "SYMPHONY_NODE_COOKIE", @default_cookie)
  end
end
