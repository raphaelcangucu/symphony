defmodule SymphonyElixir.Daemon.Lifecycle do
  @moduledoc "Idempotent lifecycle operations for the installed user service."

  alias SymphonyElixir.Daemon.{Paths, Status, Systemd}

  @spec start(keyword()) :: {:ok, term()} | {:error, term()}
  def start(opts \\ []) do
    deps = deps(opts)

    case deps.status.() do
      {:ok, %{state: :healthy}} ->
        {:ok, :already_healthy}

      {:ok, %{state: :uninstalled}} ->
        {:error, :not_installed}

      _ ->
        with :ok <- deps.systemd_start.(),
             {:ok, status} <- deps.wait_healthy.() do
          {:ok, status}
        end
    end
  end

  @spec stop(keyword()) :: :ok | {:error, term()}
  def stop(opts \\ []) do
    deps = deps(opts)

    case deps.status.() do
      {:ok, %{active?: false}} -> :ok
      {:ok, %{state: :uninstalled}} -> :ok
      _ -> deps.systemd_stop.()
    end
  end

  @spec restart(keyword()) :: {:ok, term()} | {:error, term()}
  def restart(opts \\ []) do
    deps = deps(opts)
    action = if Keyword.get(opts, :force, false), do: deps.force_restart, else: deps.restart

    with :ok <- action.(),
         {:ok, status} <- deps.wait_healthy.() do
      {:ok, status}
    end
  end

  @spec status(keyword()) :: {:ok, map()} | {:error, term()}
  def status(opts \\ []), do: deps(opts).status.()

  defp deps(opts) do
    paths = Keyword.get_lazy(opts, :paths, &Paths.resolve/0)
    status_opts = Keyword.get(opts, :status_opts, [])
    systemd_opts = Keyword.get(opts, :systemd_opts, [])

    defaults = %{
      status: fn -> Status.inspect(paths, status_opts) end,
      systemd_start: fn -> Systemd.start(paths.unit_name, systemd_opts) end,
      systemd_stop: fn -> Systemd.stop(paths.unit_name, systemd_opts) end,
      restart: fn -> Systemd.restart(paths.unit_name, systemd_opts) end,
      force_restart: fn -> Systemd.force_restart(paths.unit_name, systemd_opts) end,
      wait_healthy: fn -> wait_healthy(paths, status_opts) end
    }

    Map.merge(defaults, Map.new(Keyword.get(opts, :deps, %{})))
  end

  defp wait_healthy(paths, status_opts) do
    deadline = System.monotonic_time(:millisecond) + 30_000
    do_wait_healthy(paths, status_opts, deadline)
  end

  defp do_wait_healthy(paths, status_opts, deadline) do
    case Status.inspect(paths, status_opts) do
      {:ok, %{state: :healthy} = status} ->
        {:ok, status}

      {:ok, status} ->
        if System.monotonic_time(:millisecond) >= deadline do
          {:error, {:health_timeout, status}}
        else
          Process.sleep(250)
          do_wait_healthy(paths, status_opts, deadline)
        end
    end
  end
end
