defmodule SymphonyElixir.CodingAgent do
  @moduledoc """
  Adapter boundary for coding agent backends.
  """

  alias SymphonyElixir.AgentLaunch
  alias SymphonyElixir.AgentLifecycle.RuntimeRegistry
  alias SymphonyElixir.AgentUsage
  alias SymphonyElixir.Config

  @callback start_session(Path.t(), keyword()) :: {:ok, map()} | {:error, term()}
  @callback run_turn(map(), String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  @callback stop_session(map()) :: :ok
  @callback normalize_event(map()) :: map()
  @callback capabilities() :: SymphonyElixir.Agent.BackendCapabilities.t()

  @spec adapter() :: module()
  def adapter, do: adapter_for(Config.agent_kind())

  @spec adapter_for(String.t() | nil) :: module()
  def adapter_for("codex"), do: SymphonyElixir.Codex.CodingAgent
  def adapter_for("claude"), do: SymphonyElixir.Claude.CodingAgent
  def adapter_for("cursor"), do: SymphonyElixir.Cursor.CodingAgent
  def adapter_for("opencode"), do: SymphonyElixir.OpenCode.CodingAgent
  def adapter_for(nil), do: adapter_for(Config.default_agent_kind())

  def adapter_for(agent_kind) do
    raise ArgumentError, "unsupported agent provider: #{inspect(agent_kind)}"
  end

  @spec start_session(Path.t(), String.t() | nil, keyword()) :: {:ok, map()} | {:error, term()}
  def start_session(workspace, agent_kind \\ nil, opts \\ []) do
    kind = resolved_agent_kind(agent_kind)
    launch_resolver = Keyword.get(opts, :agent_launch_resolver, &resolve_launch/3)

    with {:ok, launch} <-
           launch_resolver.(
             kind,
             Keyword.get(opts, :project_account_id),
             Keyword.get(opts, :account_id)
           ),
         {:ok, lease, pinned_resolution} <-
           RuntimeRegistry.acquire(kind, launch.resolution) do
      pinned_launch = AgentLaunch.with_resolution(launch, pinned_resolution)
      adapter_opts = AgentLaunch.inject_options(pinned_launch, opts)

      case adapter_for(kind).start_session(workspace, adapter_opts) do
        {:ok, session} ->
          {:ok,
           session
           |> Map.put(:agent_launch, pinned_launch)
           |> Map.put(:runtime_lease, lease)}

        {:error, reason} ->
          RuntimeRegistry.release(lease)
          {:error, reason}
      end
    end
  end

  @spec run_turn(map(), String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def run_turn(session, prompt, issue, opts \\ []) do
    agent_kind =
      Keyword.get(opts, :agent_kind) ||
        get_in(session, [:agent_launch, Access.key(:agent_kind)]) ||
        Map.get(issue, :agent_kind)

    adapter = adapter_for(agent_kind)
    run_opts = capture_account_usage(opts, session, agent_kind, adapter)
    adapter.run_turn(session, prompt, issue, run_opts)
  end

  @spec stop_session(map(), String.t() | nil) :: :ok
  def stop_session(session, agent_kind \\ nil) do
    kind =
      get_in(session, [:agent_launch, Access.key(:agent_kind)]) ||
        resolved_agent_kind(agent_kind)

    try do
      adapter_for(kind).stop_session(session)
    after
      case Map.get(session, :runtime_lease) do
        lease when is_reference(lease) -> RuntimeRegistry.release(lease)
        _ -> :ok
      end
    end

    :ok
  end

  @spec normalize_event(map(), String.t() | nil) :: map()
  def normalize_event(event, agent_kind \\ nil), do: adapter_for(agent_kind).normalize_event(event)

  @spec capabilities(String.t() | nil) :: SymphonyElixir.Agent.BackendCapabilities.t()
  def capabilities(agent_kind \\ nil), do: adapter_for(agent_kind).capabilities()

  defp resolve_launch(agent_kind, project_account_id, request_account_id) do
    AgentLaunch.resolve(agent_kind, project_account_id, request_account_id)
  end

  defp resolved_agent_kind(nil), do: Config.agent_kind() || Config.default_agent_kind()
  defp resolved_agent_kind(agent_kind), do: agent_kind

  defp capture_account_usage(opts, session, agent_kind, adapter) do
    case get_in(session, [:agent_launch, Access.key(:account_id)]) do
      account_id when is_binary(account_id) ->
        original = Keyword.get(opts, :on_message, fn _message -> :ok end)

        Keyword.put(opts, :on_message, fn message ->
          message
          |> adapter.normalize_event()
          |> then(&AgentUsage.capture_event(agent_kind, account_id, &1))

          original.(message)
        end)

      _ ->
        opts
    end
  end
end
