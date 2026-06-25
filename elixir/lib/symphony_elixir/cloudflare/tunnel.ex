defmodule SymphonyElixir.Cloudflare.Tunnel do
  @moduledoc """
  Tracks and (re)starts the Cloudflare named tunnel that fronts the public
  preview hosts.

  Always supervised under `SharedSupervisor` when process-level
  `Config.public_tunnel_enabled?/0` is true. Project-level `public_tunnel.enabled`
  in workflow markdown controls whether preview UI exposes tunnel controls; process-level
  config still gates fallback host routing in `PublicHostPlug`. The tunnel itself is an
  external `cloudflared` process launched detached by `scripts/public-tunnel.sh`
  (the same process `make tunnel-bg` starts), so this server never owns the OS
  process: liveness is derived on demand by matching the running command line,
  which means a tunnel started from a shell is detected too.

  `status/0` reports `:running | :stopped | :disabled` (`:disabled` when the
  feature is off and the server is not started). `start_tunnel/0` is idempotent:
  it is a no-op when the tunnel is already running.
  """

  use GenServer

  require Logger

  # Matches the symphony-launched tunnel command line, mirroring the
  # `make tunnel-stop` pkill pattern (`cloudflared tunnel --config ...`).
  @match_pattern "cloudflared tunnel --config"
  @log_path "/tmp/symphony-cloudflared.log"
  @script_relpath "scripts/public-tunnel.sh"

  @type status :: :running | :stopped | :disabled

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @doc """
  Current tunnel status. Returns `:disabled` when the server is not running
  (the public tunnel feature is off).
  """
  @spec status() :: status()
  def status do
    case GenServer.whereis(__MODULE__) do
      nil -> :disabled
      pid -> GenServer.call(pid, :status)
    end
  end

  @doc """
  A presentation-friendly snapshot of the tunnel: whether the feature is enabled
  (the server is running) and whether the `cloudflared` process is up.
  """
  @spec summary() :: %{enabled: boolean(), running: boolean()}
  def summary do
    case status() do
      :running -> %{enabled: true, running: true}
      :stopped -> %{enabled: true, running: false}
      :disabled -> %{enabled: false, running: false}
    end
  end

  @doc """
  Tunnel snapshot for a project issue preview. `enabled` reflects the project's
  `public_tunnel.enabled` workflow flag; `running` reflects the live `cloudflared`
  process regardless of process-level WORKFLOW settings.
  """
  @spec summary_for_project(String.t()) :: %{enabled: boolean(), running: boolean()}
  def summary_for_project(project_slug) when is_binary(project_slug) do
    %{
      enabled: SymphonyElixir.DevServer.Manager.project_public_tunnel_enabled?(project_slug),
      running: cloudflared_running?()
    }
  end

  @spec running?() :: boolean()
  def running?, do: cloudflared_running?()

  @doc """
  Starts the tunnel if it is not already running. Idempotent. Works even when the
  Tunnel GenServer is not supervised (for example, when only a project enables
  public previews).
  """
  @spec start_tunnel() :: {:ok, status()} | {:error, term()}
  def start_tunnel do
    cond do
      cloudflared_running?() ->
        {:ok, :running}

      true ->
        case GenServer.whereis(__MODULE__) do
          nil -> do_start_tunnel()
          pid -> GenServer.call(pid, :start_tunnel)
        end
    end
  end

  @impl true
  def init(_opts) do
    Process.flag(:trap_exit, true)
    {:ok, %{}}
  end

  @impl true
  def handle_call(:status, _from, state) do
    {:reply, current_status(), state}
  end

  def handle_call(:start_tunnel, _from, state) do
    {:reply, do_start_tunnel(), state}
  end

  @impl true
  def handle_info({:EXIT, _from, _reason}, state), do: {:noreply, state}
  def handle_info(_message, state), do: {:noreply, state}

  defp current_status do
    if cloudflared_running?(), do: :running, else: :stopped
  end

  defp cloudflared_running?, do: checker().()

  defp do_start_tunnel do
    if cloudflared_running?() do
      {:ok, :running}
    else
      case spawner().(spawn_spec()) do
        :ok ->
          Logger.info("Public tunnel start requested via #{@script_relpath}")
          {:ok, :running}

        {:error, reason} = error ->
          Logger.warning("Public tunnel start failed reason=#{inspect(reason)}")
          error
      end
    end
  end

  defp spawn_spec do
    %{script: script_path(), log: @log_path}
  end

  defp script_path do
    Path.expand(@script_relpath, File.cwd!())
  end

  defp checker do
    Application.get_env(:symphony_elixir, :cloudflare_tunnel_checker, &default_running?/0)
  end

  defp spawner do
    Application.get_env(:symphony_elixir, :cloudflare_tunnel_spawner, &default_spawn/1)
  end

  defp default_running? do
    case System.cmd("pgrep", ["-f", @match_pattern], stderr_to_stdout: true) do
      {_out, 0} -> true
      _ -> false
    end
  rescue
    _ -> false
  end

  defp default_spawn(%{script: script, log: log}) do
    if File.exists?(script) do
      command = "nohup bash #{script} > #{log} 2>&1 &"

      case System.cmd("bash", ["-c", command], cd: Path.dirname(Path.dirname(script)), stderr_to_stdout: true) do
        {_out, 0} -> :ok
        {out, code} -> {:error, {:spawn_failed, code, out}}
      end
    else
      {:error, {:script_missing, script}}
    end
  rescue
    error -> {:error, error}
  end
end
