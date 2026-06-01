# Resilient local boot for the Symphony tracker.
#
# Runs the full OTP application via Mix (`mix run --no-start dev/serve.exs`) so
# it uses the compiled dependencies in `_build`, where native NIFs such as the
# `exqlite` SQLite driver are available. The packaged escript (`bin/symphony`)
# cannot load those NIFs, which is why `make serve` boots through this script.
#
# Inputs (all optional):
#   * first CLI argument or $SYMPHONY_WORKFLOW : path to the WORKFLOW.md file
#   * $SYMPHONY_TRACKER_PORT                   : HTTP port override
#   * $SYMPHONY_TRACKER_TOKEN                  : bearer token for the tracker API

defmodule Symphony.DevServe do
  @default_workflow "WORKFLOW.md"

  def run do
    workflow_path = resolve_workflow_path()
    ensure_workflow_exists!(workflow_path)
    ensure_single_instance!(workflow_path)

    :ok = SymphonyElixir.Workflow.set_workflow_file_path(workflow_path)
    maybe_override_port(resolve_port())

    case Application.ensure_all_started(:symphony_elixir) do
      {:ok, _started} ->
        migrate_repo!()
        announce_ready(workflow_path)
        Process.sleep(:infinity)

      {:error, reason} ->
        fail("Failed to start Symphony: #{inspect(reason, pretty: true)}")
    end
  end

  defp resolve_workflow_path do
    raw =
      case System.argv() do
        [path | _] when is_binary(path) and path != "" -> path
        _ -> System.get_env("SYMPHONY_WORKFLOW") || @default_workflow
      end

    Path.expand(raw)
  end

  defp ensure_workflow_exists!(path) do
    unless File.regular?(path) do
      fail("Workflow file not found: #{path}")
    end
  end

  defp ensure_single_instance!(workflow_path) do
    case SymphonyElixir.DevServeGuard.acquire(workflow_path: workflow_path) do
      :ok ->
        :ok

      {:error, {:already_running, %{"pid" => pid} = info}} ->
        running_workflow = Map.get(info, "workflow_path", "(unknown)")

        fail("""
        Another Symphony tracker serve is already running (pid #{pid}, workflow: #{running_workflow}).

        Running two serves with different WORKFLOW files maps the same issue to divergent
        workspaces, which makes authored documents disappear from one view. Stop the other
        instance first:

            make stop

        Then start the serve you want.
        """)
    end
  end

  defp resolve_port do
    case System.get_env("SYMPHONY_TRACKER_PORT") do
      nil ->
        nil

      value ->
        case Integer.parse(String.trim(value)) do
          {port, ""} when port >= 0 -> port
          _ -> fail("Invalid SYMPHONY_TRACKER_PORT: #{inspect(value)}")
        end
    end
  end

  defp maybe_override_port(nil), do: :ok

  defp maybe_override_port(port) when is_integer(port) do
    Application.put_env(:symphony_elixir, :server_port_override, port)
    :ok
  end

  defp migrate_repo! do
    case Ecto.Migrator.with_repo(SymphonyElixir.Repo, fn repo ->
           Ecto.Migrator.run(repo, :up, all: true)
         end) do
      {:ok, _repo, _apps} ->
        :ok

      {:error, reason} ->
        fail("Failed to migrate local tracker database: #{inspect(reason, pretty: true)}")
    end
  end

  defp announce_ready(workflow_path) do
    port = SymphonyElixir.HttpServer.bound_port()
    suffix = if is_integer(port), do: "http://localhost:#{port}/tracker", else: "(HTTP server not bound)"
    IO.puts("\nSymphony tracker is running → #{suffix}")
    IO.puts("Workflow: #{workflow_path}")
    IO.puts("Press Ctrl+C twice to stop.\n")
  end

  defp fail(message) do
    IO.puts(:stderr, message)
    # System.stop/1 flushes IO and shuts down gracefully; System.halt would drop
    # buffered stderr, which is exactly how the escript boot failure hid its error.
    System.stop(1)
    Process.sleep(:infinity)
  end
end

Symphony.DevServe.run()
