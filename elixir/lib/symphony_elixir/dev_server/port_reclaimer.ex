defmodule SymphonyElixir.DevServer.PortReclaimer do
  @moduledoc """
  Forcibly frees a local TCP port so a preview can be (re)started on its
  *canonical* port instead of drifting onto the next free one.

  When a preview is restarted the previous server process (uvicorn / vite / …)
  can be slow to release its listen socket, or a stale process from a crashed
  run can still be squatting the port. In both cases the next allocation sees
  the canonical port as occupied and drifts to a new one, breaking the stable
  port bridge between Symphony, the project preview, and the public tunnel.

  `reclaim/2` finds whoever is listening on `127.0.0.1:port`, sends `SIGTERM`
  (then `SIGKILL` if needed) and waits until the port is bindable again.

  This is intentionally **opt-in per project** (`dev_server.reclaim_ports`)
  because some projects deliberately keep a long-lived resource (e.g. a shared
  docker container) bound to a service's port across restarts and must NOT have
  it killed — see the smart preview port scheme design (§5.5).

  All side-effecting steps (PID discovery, signalling, bindability probe,
  sleeping) are injectable via `opts` so the logic is unit-testable without real
  sockets or processes.
  """

  require Logger

  alias SymphonyElixir.DevServer.PortAllocator

  @default_term_wait_ms 200
  # ~3s graceful window before escalating to SIGKILL
  @default_term_attempts 15
  @default_kill_wait_ms 100
  # ~1s window after SIGKILL
  @default_kill_attempts 10

  @type opts :: [
          list_pids: (pos_integer() -> [pos_integer()]),
          signal: (String.t(), pos_integer() -> :ok),
          bindable?: (pos_integer() -> boolean()),
          sleep: (non_neg_integer() -> any()),
          term_attempts: non_neg_integer(),
          term_wait_ms: non_neg_integer(),
          kill_attempts: non_neg_integer(),
          kill_wait_ms: non_neg_integer()
        ]

  @doc """
  Frees `port` if something is listening on it.

    * `:ok` — the port was already free, or is free after reclaiming.
    * `{:error, :still_bound}` — something is still listening after SIGKILL
      (e.g. a process owned by another user); the caller should fall back to
      drifting onto another port rather than hard-failing.

  Safe to call on a free port (no-op).
  """
  @spec reclaim(pos_integer(), opts()) :: :ok | {:error, :still_bound}
  def reclaim(port, opts \\ []) when is_integer(port) and port > 0 do
    bindable_fun = Keyword.get(opts, :bindable?, &PortAllocator.bindable?/1)

    if bindable_fun.(port) do
      :ok
    else
      do_reclaim(port, opts, bindable_fun)
    end
  end

  defp do_reclaim(port, opts, bindable_fun) do
    list_pids = Keyword.get(opts, :list_pids, &listening_pids/1)
    signal = Keyword.get(opts, :signal, &send_signal/2)
    sleep = Keyword.get(opts, :sleep, &Process.sleep/1)

    term_attempts = Keyword.get(opts, :term_attempts, @default_term_attempts)
    term_wait = Keyword.get(opts, :term_wait_ms, @default_term_wait_ms)
    kill_attempts = Keyword.get(opts, :kill_attempts, @default_kill_attempts)
    kill_wait = Keyword.get(opts, :kill_wait_ms, @default_kill_wait_ms)

    case list_pids.(port) do
      [] ->
        # Bound but no PID we can see (mid-teardown, or a socket we cannot
        # inspect). Give it a brief grace window, then report truthfully.
        wait_bindable(port, bindable_fun, sleep, term_attempts, term_wait)

      pids ->
        Logger.info("[port-reclaim] freeing port #{port}; SIGTERM pids=#{inspect(pids)}")
        Enum.each(pids, &signal.("TERM", &1))

        case wait_bindable(port, bindable_fun, sleep, term_attempts, term_wait) do
          :ok ->
            :ok

          {:error, :still_bound} ->
            remaining = list_pids.(port)

            Logger.warning(
              "[port-reclaim] port #{port} still bound after SIGTERM; SIGKILL pids=#{inspect(remaining)}"
            )

            Enum.each(remaining, &signal.("KILL", &1))
            wait_bindable(port, bindable_fun, sleep, kill_attempts, kill_wait)
        end
    end
  end

  defp wait_bindable(port, bindable_fun, _sleep, 0, _wait_ms) do
    if bindable_fun.(port), do: :ok, else: {:error, :still_bound}
  end

  defp wait_bindable(port, bindable_fun, sleep, attempts, wait_ms) do
    if bindable_fun.(port) do
      :ok
    else
      sleep.(wait_ms)
      wait_bindable(port, bindable_fun, sleep, attempts - 1, wait_ms)
    end
  end

  @doc false
  @spec listening_pids(pos_integer()) :: [pos_integer()]
  def listening_pids(port) when is_integer(port) and port > 0 do
    case pids_via_ss(port) do
      [] -> pids_via_lsof(port)
      pids -> pids
    end
  end

  defp pids_via_ss(port) do
    case System.cmd("ss", ["-ltnp", "sport = :#{port}"], stderr_to_stdout: true) do
      {output, 0} -> parse_pid_field(output)
      _ -> []
    end
  rescue
    _ -> []
  catch
    :exit, _ -> []
  end

  defp pids_via_lsof(port) do
    case System.cmd("lsof", ["-ti", "tcp:#{port}", "-sTCP:LISTEN"], stderr_to_stdout: true) do
      {output, 0} -> parse_int_lines(output)
      _ -> []
    end
  rescue
    _ -> []
  catch
    :exit, _ -> []
  end

  defp parse_pid_field(output) do
    ~r/pid=(\d+)/
    |> Regex.scan(output)
    |> Enum.map(fn [_, pid] -> String.to_integer(pid) end)
    |> Enum.uniq()
  end

  defp parse_int_lines(output) do
    output
    |> String.split(~r/\s+/, trim: true)
    |> Enum.flat_map(fn token ->
      case Integer.parse(token) do
        {pid, ""} -> [pid]
        _ -> []
      end
    end)
    |> Enum.uniq()
  end

  defp send_signal(signal, pid) when is_binary(signal) and is_integer(pid) do
    System.cmd("kill", ["-#{signal}", Integer.to_string(pid)], stderr_to_stdout: true)
    :ok
  rescue
    _ -> :ok
  catch
    :exit, _ -> :ok
  end
end
