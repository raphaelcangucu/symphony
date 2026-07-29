defmodule Mix.Tasks.Symphony.Ctl do
  @shortdoc "Control the Symphony dev daemon (serve | update | stop)"
  @moduledoc """
  Controls the long-lived Symphony dev daemon so subtrees restart independently.

      mix symphony.ctl serve                 # boot/ensure the daemon (all subtrees)
      mix symphony.ctl update                # recompile + restart the web subtree (default)
      mix symphony.ctl update --orchestrator # restart only the orchestrator subtree
      mix symphony.ctl update --all          # restart web + orchestrator + editor
      mix symphony.ctl stop                  # full daemon shutdown (default)
      mix symphony.ctl stop --web            # stop only the web subtree, daemon stays up

  Subtree flags: --web, --orchestrator, --code-server (alias --editor), --all.
  `update` with no flag means --web. `stop` with no flag means a full shutdown.
  """

  use Mix.Task

  @canonical_order [:web, :orchestrator, :editor]

  @switches [
    web: :boolean,
    orchestrator: :boolean,
    editor: :boolean,
    code_server: :boolean,
    all: :boolean
  ]
  @aliases []

  @impl true
  def run(argv) do
    case parse(argv) do
      {:serve, _} -> serve()
      {:update, targets} -> rpc_restart(targets)
      {:stop, :all} -> stop_daemon()
      {:stop, targets} -> rpc_stop_subtrees(targets)
    end
  end

  defp serve do
    env = System.get_env()
    node = SymphonyElixir.Ctl.node_name(env)

    case running_daemon() do
      {:ok, info} ->
        Mix.shell().info("Symphony daemon already running (node #{info["node_name"]}). #{status_line()}")

      :none ->
        boot_detached(node, SymphonyElixir.Ctl.cookie(env))
        wait_until_ready()
        Mix.shell().info("Symphony daemon started (node #{node}). #{status_line()}")
    end
  end

  defp boot_detached(node, cookie) do
    elixir = System.find_executable("elixir") || Mix.raise("`elixir` not found on PATH")
    File.mkdir_p!(".symphony")
    log_path = Path.expand(".symphony/serve.log")

    # The daemon must outlive this Mix invocation. `setsid` is Linux-specific
    # and absent from macOS by default, so use it only when it exists; `nohup`
    # is the portable POSIX fallback. Windows uses `cmd /c start /b` instead of
    # assuming a Unix shell exists. Each path receives .env explicitly.
    case :os.type() do
      {:win32, _} -> boot_windows(elixir, node, cookie, log_path)
      _ -> boot_posix(elixir, node, cookie, log_path)
    end
  end

  defp boot_posix(elixir, node, cookie, log_path) do
    launcher =
      case detached_launch_mode(
             :os.type(),
             System.find_executable("setsid"),
             System.find_executable("nohup")
           ) do
        {:setsid, path} -> shell_escape(path)
        {:nohup, path} -> shell_escape(path)
        :shell_background -> ""
      end

    command =
      [launcher, shell_escape(elixir), "--name", shell_escape(node), "--cookie", shell_escape(cookie), "-S", "mix", "run", "--no-start", "dev/serve.exs"]
      |> Enum.reject(&(&1 == ""))
      |> Enum.join(" ")
      |> then(&"trap '' HUP; #{&1} > #{shell_escape(log_path)} 2>&1 < /dev/null &")

    run_detached("sh", ["-c", command])
  end

  @doc false
  @spec detached_launch_mode({atom(), atom()}, String.t() | nil, String.t() | nil) ::
          {:setsid, String.t()} | {:nohup, String.t()} | :shell_background | :windows_start
  def detached_launch_mode({:win32, _}, _setsid, _nohup), do: :windows_start
  def detached_launch_mode(_os_type, setsid, _nohup) when is_binary(setsid), do: {:setsid, setsid}
  def detached_launch_mode(_os_type, _setsid, nohup) when is_binary(nohup), do: {:nohup, nohup}
  def detached_launch_mode(_os_type, _setsid, _nohup), do: :shell_background

  defp boot_windows(elixir, node, cookie, log_path) do
    command =
      "start \"\" /b #{windows_escape(elixir)} --name #{windows_escape(node)} " <>
        "--cookie #{windows_escape(cookie)} -S mix run --no-start dev/serve.exs " <>
        "> #{windows_escape(log_path)} 2>&1"

    run_detached(System.find_executable("cmd") || "cmd.exe", ["/d", "/s", "/c", command])
  end

  defp run_detached(program, args) do
    case System.cmd(program, args, env: daemon_env(), stderr_to_stdout: true) do
      {_out, 0} -> :ok
      {output, status} -> Mix.raise("Could not start Symphony daemon (exit #{status}): #{output}")
    end
  rescue
    error in ErlangError -> Mix.raise("Could not start Symphony daemon: #{Exception.message(error)}")
  end

  # Accept the portable KEY=value subset that the daemon needs. We deliberately
  # do not shell-evaluate .env: that is unavailable on Windows and evaluating
  # a project configuration as shell code is unnecessary here.
  defp daemon_env do
    case File.read(".env") do
      {:ok, contents} ->
        contents
        |> String.split(~r/\r?\n/, trim: true)
        |> Enum.reduce([], fn line, env ->
          line = line |> String.trim() |> String.replace_prefix("export ", "")

          case String.split(line, "=", parts: 2) do
            [key, value] ->
              if valid_env_key?(key), do: [{key, dotenv_value(value)} | env], else: env

            _ ->
              env
          end
        end)

      {:error, _} ->
        []
    end
  end

  defp dotenv_value(value) do
    value = String.trim(value)

    case value do
      <<quote, rest::binary>> when quote in [?', ?\"] and byte_size(rest) > 0 ->
        if String.ends_with?(rest, <<quote>>), do: String.slice(rest, 0, byte_size(rest) - 1), else: value

      _ ->
        value
    end
  end

  defp valid_env_key?(key) when is_binary(key), do: Regex.match?(~r/^[A-Za-z_][A-Za-z0-9_]*$/, key)

  defp rpc_restart(targets) do
    on_daemon(fn node ->
      case :erpc.call(node, SymphonyElixir.Ctl, :restart, [targets]) do
        {:ok, %{restarted: restarted, reloaded: reloaded}} ->
          Mix.shell().info("restarted: #{inspect(restarted)} (reloaded #{length(reloaded)} module(s))")
      end
    end)
  end

  defp rpc_stop_subtrees(targets) do
    on_daemon(fn node ->
      :ok = :erpc.call(node, SymphonyElixir.Ctl, :stop_subtrees, [targets])
      Mix.shell().info("stopped subtree(s): #{inspect(targets)} (daemon still running)")
    end)
  end

  defp stop_daemon do
    case running_daemon() do
      :none ->
        Mix.shell().info("No running Symphony daemon.")

      {:ok, info} ->
        on_daemon(fn node ->
          _ = :erpc.call(node, :init, :stop, [])
          File.rm(lock_path())
          Mix.shell().info("Symphony daemon stopped (node #{info["node_name"]}).")
        end)
    end
  end

  defp on_daemon(fun) do
    case running_daemon() do
      :none ->
        Mix.raise("No running Symphony daemon. Run `make serve` first.")

      {:ok, _info} ->
        node = String.to_atom(SymphonyElixir.Ctl.node_name())
        ensure_distributed!()
        Node.set_cookie(String.to_atom(SymphonyElixir.Ctl.cookie()))

        case Node.connect(node) do
          true -> fun.(node)
          _ -> Mix.raise("Could not connect to Symphony daemon node #{node}.")
        end
    end
  end

  defp ensure_distributed! do
    if node() == :nonode@nohost do
      ctl_node = :"symphony_ctl_#{:erlang.unique_integer([:positive])}@127.0.0.1"
      {:ok, _} = Node.start(ctl_node, :longnames)
    end

    :ok
  end

  defp running_daemon do
    case SymphonyElixir.DevServeGuard.read(lock_path()) do
      {:ok, %{"pid" => pid} = info} when is_binary(pid) and pid != "" ->
        if os_alive?(pid), do: {:ok, info}, else: :none

      _ ->
        :none
    end
  end

  defp lock_path, do: SymphonyElixir.DevServeGuard.default_lock_path()

  defp os_alive?(pid) do
    case :os.type() do
      {:win32, _} -> windows_pid_alive?(pid)
      _ -> match?({_, 0}, System.cmd("kill", ["-0", pid], stderr_to_stdout: true))
    end
  rescue
    _ -> false
  end

  defp windows_pid_alive?(pid) do
    case System.cmd("tasklist", ["/FI", "PID eq #{pid}", "/FO", "CSV", "/NH"], stderr_to_stdout: true) do
      {output, 0} -> String.contains?(output, ~s(,"#{pid}",))
      _ -> false
    end
  end

  defp wait_until_ready(attempts \\ 60)
  defp wait_until_ready(0), do: Mix.shell().info("(daemon still starting; check .symphony/serve.log)")

  defp wait_until_ready(attempts) do
    case running_daemon() do
      {:ok, _} ->
        :ok

      :none ->
        Process.sleep(500)
        wait_until_ready(attempts - 1)
    end
  end

  defp status_line, do: "Logs: .symphony/serve.log"

  defp shell_escape(value), do: "'" <> String.replace(value, "'", "'\\''") <> "'"

  defp windows_escape(value), do: "\"" <> String.replace(value, "\"", "\\\"") <> "\""

  @doc false
  @spec parse([String.t()]) :: {:serve, :all} | {:update, [atom()]} | {:stop, [atom()] | :all}
  def parse([command | rest]) when command in ~w(serve update stop) do
    {opts, _argv, _invalid} = OptionParser.parse(rest, switches: @switches, aliases: @aliases)
    targets = targets_from_opts(opts)
    build(String.to_atom(command), targets)
  end

  def parse([command | _]),
    do: Mix.raise("unknown command #{inspect(command)} (use serve | update | stop)")

  def parse([]), do: Mix.raise("unknown command (use serve | update | stop)")

  defp build(:serve, _targets), do: {:serve, :all}
  defp build(:update, []), do: {:update, [:web]}
  defp build(:update, targets), do: {:update, targets}
  defp build(:stop, []), do: {:stop, :all}
  defp build(:stop, @canonical_order), do: {:stop, :all}
  defp build(:stop, targets), do: {:stop, targets}

  defp targets_from_opts(opts) do
    if Keyword.get(opts, :all) do
      @canonical_order
    else
      selected =
        opts
        |> Enum.flat_map(fn
          {:web, true} -> [:web]
          {:orchestrator, true} -> [:orchestrator]
          {:editor, true} -> [:editor]
          {:code_server, true} -> [:editor]
          _ -> []
        end)
        |> Enum.uniq()

      Enum.filter(@canonical_order, &(&1 in selected))
    end
  end
end
