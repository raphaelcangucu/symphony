defmodule SymphonyElixir.AgentLaunch do
  @moduledoc """
  Immutable executable/account provenance captured once at session admission.
  """

  alias SymphonyElixir.AgentFailover
  alias SymphonyElixir.AgentLifecycle.{Catalog, Resolver}

  @enforce_keys [
    :agent_kind,
    :account_id,
    :account_home,
    :preferred_source,
    :effective_source,
    :executable_path,
    :probed_at,
    :environment,
    :command,
    :resolution,
    :failover
  ]
  defstruct [
    :agent_kind,
    :account_id,
    :account_home,
    :preferred_source,
    :effective_source,
    :executable_path,
    :executable_version,
    :fallback_reason,
    :probed_at,
    :environment,
    :command,
    :resolution,
    :failover
  ]

  @type t :: %__MODULE__{}

  @spec resolve(String.t(), String.t() | nil, String.t() | nil, keyword()) ::
          {:ok, t()} | {:error, term()}
  def resolve(agent, project_override \\ nil, request_override \\ nil, options \\ []) do
    resolver = Keyword.get(options, :resolver, &Resolver.resolve/1)

    account_resolver =
      Keyword.get(options, :account_resolver, fn kind, project, request ->
        AgentFailover.resolve(
          kind,
          project,
          request,
          Keyword.get(options, :failover_options, [])
        )
      end)

    with {:ok, resolution} <- resolver.(agent),
         {:ok, account, failover} <-
           resolve_account(account_resolver, agent, project_override, request_override) do
      {:ok,
       new!(
         agent_kind: agent,
         account_id: account.id,
         account_home: account.home,
         preferred_source: resolution.preferred_source,
         effective_source: resolution.effective_source,
         executable_path: resolution.executable_path,
         executable_version: resolution.version,
         fallback_reason: resolution.fallback_reason,
         probed_at: resolution.probed_at,
         resolution: resolution,
         failover: failover
       )}
    end
  end

  @spec new!(keyword()) :: t()
  def new!(attributes) do
    agent = Keyword.fetch!(attributes, :agent_kind)
    account_home = Keyword.fetch!(attributes, :account_home)
    executable_path = Keyword.fetch!(attributes, :executable_path)
    catalog = Catalog.fetch!(agent)

    resolution =
      Keyword.get(attributes, :resolution, %{
        preferred_source: Keyword.fetch!(attributes, :preferred_source),
        effective_source: Keyword.fetch!(attributes, :effective_source),
        executable_path: executable_path,
        version: Keyword.get(attributes, :executable_version),
        fallback_reason: Keyword.get(attributes, :fallback_reason),
        probed_at: Keyword.fetch!(attributes, :probed_at)
      })

    struct!(__MODULE__,
      agent_kind: agent,
      account_id: Keyword.fetch!(attributes, :account_id),
      account_home: account_home,
      preferred_source: Keyword.fetch!(attributes, :preferred_source),
      effective_source: Keyword.fetch!(attributes, :effective_source),
      executable_path: executable_path,
      executable_version: Keyword.get(attributes, :executable_version),
      fallback_reason: Keyword.get(attributes, :fallback_reason),
      probed_at: Keyword.fetch!(attributes, :probed_at),
      environment: %{catalog.account_home_env => account_home},
      command: Catalog.launch_command(agent, executable_path),
      resolution: resolution,
      failover: Keyword.get(attributes, :failover)
    )
  end

  @spec inject_options(t(), keyword()) :: keyword()
  def inject_options(%__MODULE__{} = launch, options) do
    options
    |> Keyword.put(:agent_env, launch.environment)
    |> Keyword.put(:agent_launch, launch)
    |> put_command(launch)
  end

  @spec with_resolution(t(), map()) :: t()
  def with_resolution(%__MODULE__{} = launch, resolution) do
    new!(
      agent_kind: launch.agent_kind,
      account_id: launch.account_id,
      account_home: launch.account_home,
      preferred_source: resolution.preferred_source,
      effective_source: resolution.effective_source,
      executable_path: resolution.executable_path,
      executable_version: resolution.version,
      fallback_reason: resolution.fallback_reason,
      probed_at: resolution.probed_at,
      resolution: resolution,
      failover: launch.failover
    )
  end

  defp resolve_account(resolver, agent, project, request) do
    case resolver.(agent, project, request) do
      {:ok, account, failover} -> {:ok, account, failover}
      {:ok, account} -> {:ok, account, nil}
      {:error, _reason} = error -> error
    end
  end

  defp put_command(options, %{agent_kind: "codex"} = launch) do
    section = Keyword.get(options, :codex_config, %{})
    Keyword.put(options, :codex_config, Map.put(section, "command", launch.command))
  end

  defp put_command(options, %{agent_kind: "claude"} = launch),
    do: Keyword.put(options, :claude_command, launch.command)

  defp put_command(options, %{agent_kind: "cursor"} = launch),
    do: Keyword.put(options, :cursor_command, launch.command)

  defp put_command(options, %{agent_kind: "opencode"} = launch),
    do: Keyword.put(options, :opencode_command, launch.command)
end
