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

    # The detached daemon does not inherit a parent shell's `source .env`; load
    # elixir/.env here so SYMPHONY_TRACKER_TOKEN and other secrets are always
    # present regardless of how `mix symphony.ctl serve` was invoked.
    command =
      env_prefix() <>
        "setsid #{shell_escape(elixir)} --name #{node} --cookie #{cookie} " <>
        "-S mix run --no-start dev/serve.exs " <>
        "> .symphony/serve.log 2>&1 < /dev/null &"

    {_out, 0} = System.cmd("sh", ["-c", command])
    :ok
  end

  defp env_prefix do
    if File.exists?(".env"), do: "set -a && . ./.env && set +a && ", else: ""
  end

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
    match?({_, 0}, System.cmd("kill", ["-0", pid], stderr_to_stdout: true))
  rescue
    _ -> false
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
