defmodule SymphonyElixir.AgentLifecycle.Maintenance do
  @moduledoc """
  Periodically updates Symphony-managed agent CLIs.

  Providers without a managed installation are ignored, each provider can opt
  out independently, and activation is deferred while a session holds a lease.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.AgentLifecycle.{Catalog, Installer, ReleaseSource}
  alias SymphonyElixir.Settings.AgentCli

  @fallback_interval_ms 21_600_000
  @fallback_initial_delay_ms 30_000

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @doc "Runs an automatic-update cycle immediately."
  @spec update_now(GenServer.server(), timeout()) :: map()
  def update_now(server \\ __MODULE__, timeout \\ 120_000) do
    GenServer.call(server, :update_now, timeout)
  end

  @doc false
  @spec run_once(keyword()) :: map()
  def run_once(options \\ []) do
    agents = Keyword.get(options, :agents, Catalog.kinds())
    current = Keyword.get(options, :current, &Installer.current/1)
    release_source = Keyword.get(options, :release_source, &ReleaseSource.latest/2)
    install = Keyword.get(options, :install, &Installer.install/3)

    Map.new(agents, fn agent ->
      {agent, maintain(agent, current, release_source, install)}
    end)
  end

  @impl true
  def init(options) do
    if enabled?(), do: Process.send_after(self(), :tick, initial_delay_ms())
    {:ok, %{options: options}}
  end

  @impl true
  def handle_call(:update_now, _from, state) do
    {:reply, run_once(state.options), state}
  end

  @impl true
  def handle_info(:tick, state) do
    state.options
    |> run_once()
    |> Enum.each(fn
      {agent, {:error, reason}} ->
        Logger.warning("Managed agent CLI update failed agent=#{agent} reason=#{inspect(reason)}")

      _result ->
        :ok
    end)

    Process.send_after(self(), :tick, interval_ms())
    {:noreply, state}
  end

  @impl true
  def handle_info(_message, state), do: {:noreply, state}

  defp maintain(agent, current, release_source, install) do
    if get_in(AgentCli.for(agent), ["auto_update"]) == true do
      with {:ok, manifest} <- current.(agent),
           {:ok, release} <- release_source.(agent, []) do
        if same_version?(manifest, release),
          do: :current,
          else: install.(agent, release, [])
      else
        {:error, :not_installed} -> :not_installed
        {:error, reason} -> {:error, reason}
      end
    else
      :disabled
    end
  end

  defp same_version?(manifest, release) do
    current_version = manifest["version"] || manifest[:version]
    release_version = release[:version] || release["version"]
    current_version == release_version
  end

  defp enabled?,
    do: Application.get_env(:symphony_elixir, :agent_maintenance_enabled, true)

  defp interval_ms,
    do: positive_milliseconds(:agent_maintenance_interval_ms, @fallback_interval_ms)

  defp initial_delay_ms,
    do: positive_milliseconds(:agent_maintenance_initial_delay_ms, @fallback_initial_delay_ms)

  defp positive_milliseconds(key, fallback) do
    case Application.get_env(:symphony_elixir, key, fallback) do
      value when is_integer(value) and value > 0 -> value
      _invalid -> fallback
    end
  end
end
