defmodule SymphonyElixir.Editor.Server do
  @moduledoc """
  Supervises a single `code-server` process and tracks its readiness.

  Started only when `Config.editor_enabled?/0`. On boot it TCP-probes the bind
  address: if a `code-server` is already listening (e.g. one orphaned by a
  previous abrupt shutdown), it reuses that process and reports `:ready`;
  otherwise it spawns `code-server` and probes until the bind address accepts
  connections (`:starting` -> `:ready`). A missing binary or spawn failure marks
  the server `:unavailable` without crashing the orchestrator.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.Config

  @probe_interval_ms 1_000
  @probe_connect_timeout_ms 500
  @vscode_env_prefix "VSCODE_"

  @type status :: :starting | :ready | :unavailable

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @spec status() :: status()
  def status do
    case GenServer.whereis(__MODULE__) do
      nil -> :unavailable
      pid -> status(pid)
    end
  end

  @spec status(pid() | atom()) :: status()
  def status(server), do: GenServer.call(server, :status)

  @impl true
  def init(_opts) do
    Process.flag(:trap_exit, true)
    state = %{port: nil, os_pid: nil, status: :starting}
    {:ok, boot(state)}
  end

  defp boot(state) do
    binary = Config.editor_binary()

    case executable_finder().(binary) do
      nil ->
        Logger.warning("Editor server unavailable: binary not found binary=#{binary}")
        %{state | status: :unavailable}

      executable ->
        reuse_or_spawn(state, executable)
    end
  end

  # A code-server left over from a previous run (e.g. when the BEAM was killed
  # abruptly and `terminate/2` never ran) keeps holding the bind port, so a fresh
  # spawn would hit EADDRINUSE and exit immediately. Reuse the live process
  # instead of dying with `:unavailable`.
  defp reuse_or_spawn(state, executable) do
    case probe().({probe_host(Config.editor_host()), Config.editor_port()}) do
      :ok ->
        Logger.info(
          "Editor server reusing existing code-server host=#{Config.editor_host()} port=#{Config.editor_port()}"
        )

        %{state | status: :ready}

      {:error, _reason} ->
        spawn_code_server(state, executable)
    end
  end

  defp spawn_code_server(state, executable) do
    default_folder = Config.workspace_root() |> Path.expand()

    args = [
      "--bind-addr",
      "#{Config.editor_host()}:#{Config.editor_port()}",
      "--auth",
      Config.editor_auth(),
      "--disable-telemetry",
      default_folder
    ]

    env = build_env(Config.editor_auth(), Config.editor_password())

    case spawner().({executable, args, env}) do
      {:ok, port} ->
        Process.send_after(self(), :probe, @probe_interval_ms)
        %{state | port: port, status: :starting}

      {:error, reason} ->
        Logger.warning("Editor server failed to spawn reason=#{inspect(reason)}")
        %{state | status: :unavailable}
    end
  end

  defp build_env("password", password) when is_binary(password) and password != "" do
    strip_parent_vscode_env() ++ [{~c"PASSWORD", String.to_charlist(password)}]
  end

  defp build_env(_auth, _password), do: strip_parent_vscode_env()

  defp strip_parent_vscode_env do
    System.get_env()
    |> Enum.filter(fn {key, _} -> String.starts_with?(key, @vscode_env_prefix) end)
    |> Enum.map(fn {key, _} -> {String.to_charlist(key), false} end)
  end

  @impl true
  def handle_call(:status, _from, state), do: {:reply, state.status, state}

  @impl true
  def handle_info(:probe, %{port: nil} = state), do: {:noreply, state}

  def handle_info(:probe, %{status: :ready} = state), do: {:noreply, state}

  def handle_info(:probe, state) do
    case probe().({probe_host(Config.editor_host()), Config.editor_port()}) do
      :ok ->
        Logger.info("Editor server ready host=#{Config.editor_host()} port=#{Config.editor_port()}")
        {:noreply, %{state | status: :ready}}

      {:error, _reason} ->
        Process.send_after(self(), :probe, @probe_interval_ms)
        {:noreply, %{state | status: :starting}}
    end
  end

  def handle_info({port, {:exit_status, code}}, %{port: port} = state) do
    Logger.warning("Editor server process exited code=#{code}; marking unavailable")
    {:noreply, %{state | status: :unavailable, port: nil}}
  end

  def handle_info({:EXIT, _from, _reason}, state), do: {:noreply, state}

  def handle_info(_msg, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, %{port: port}) when not is_nil(port) do
    killer().(port)
    :ok
  rescue
    _ -> :ok
  end

  def terminate(_reason, _state), do: :ok

  defp probe_host("0.0.0.0"), do: "127.0.0.1"
  defp probe_host("::"), do: "::1"
  defp probe_host(host), do: host

  defp executable_finder do
    Application.get_env(:symphony_elixir, :editor_executable_finder, &System.find_executable/1)
  end

  defp spawner do
    Application.get_env(:symphony_elixir, :editor_spawner, &default_spawn/1)
  end

  defp probe do
    Application.get_env(:symphony_elixir, :editor_probe, &default_probe/1)
  end

  defp killer do
    Application.get_env(:symphony_elixir, :editor_killer, &default_kill/1)
  end

  defp default_kill(port) when is_port(port) do
    case Port.info(port, :os_pid) do
      {:os_pid, os_pid} -> System.cmd("kill", ["-TERM", Integer.to_string(os_pid)])
      _ -> :ok
    end
  end

  defp default_kill(_port), do: :ok

  defp default_spawn({executable, args, env}) do
    port =
      Port.open(
        {:spawn_executable, String.to_charlist(executable)},
        [
          :binary,
          :exit_status,
          :stderr_to_stdout,
          args: Enum.map(args, &String.to_charlist/1),
          env: env
        ]
      )

    {:ok, port}
  rescue
    error -> {:error, error}
  end

  defp default_probe({host, port}) do
    case :gen_tcp.connect(String.to_charlist(host), port, [:binary, active: false], @probe_connect_timeout_ms) do
      {:ok, socket} ->
        :gen_tcp.close(socket)
        :ok

      {:error, reason} ->
        {:error, reason}
    end
  end
end
