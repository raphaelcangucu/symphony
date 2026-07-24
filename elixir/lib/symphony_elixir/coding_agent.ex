defmodule SymphonyElixir.CodingAgent do
  @moduledoc """
  Adapter boundary for coding agent backends.
  """

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
  def start_session(workspace, agent_kind \\ nil, opts \\ []),
    do: adapter_for(agent_kind).start_session(workspace, opts)

  @spec run_turn(map(), String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def run_turn(session, prompt, issue, opts \\ []) do
    agent_kind = Keyword.get(opts, :agent_kind, Map.get(issue, :agent_kind))
    adapter_for(agent_kind).run_turn(session, prompt, issue, opts)
  end

  @spec stop_session(map(), String.t() | nil) :: :ok
  def stop_session(session, agent_kind \\ nil), do: adapter_for(agent_kind).stop_session(session)

  @spec normalize_event(map(), String.t() | nil) :: map()
  def normalize_event(event, agent_kind \\ nil), do: adapter_for(agent_kind).normalize_event(event)

  @spec capabilities(String.t() | nil) :: SymphonyElixir.Agent.BackendCapabilities.t()
  def capabilities(agent_kind \\ nil), do: adapter_for(agent_kind).capabilities()
end
