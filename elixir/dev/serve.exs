# Resilient local boot for the Symphony tracker.
#
# Runs the full OTP application via Mix (`mix run --no-start dev/serve.exs`) so
# it uses the compiled dependencies in `_build`, where native NIFs such as the
# `exqlite` SQLite driver are available. The packaged escript (`bin/symphony`)
# cannot load those NIFs, which is why `make serve` boots through this script.
#
# Inputs (all optional — global-less orchestration boots with process settings only):
#   * first CLI argument or $SYMPHONY_WORKFLOW : optional path to a WORKFLOW.md file
#                                                (backward compat; not required)
#   * $SYMPHONY_TRACKER_PORT                   : HTTP port override
#   * $SYMPHONY_TRACKER_TOKEN                  : bearer token for the tracker API

defmodule Symphony.DevServe do
  alias SymphonyElixir.DevServe

  def run do
    workflow_path = resolve_workflow_path()
    ensure_single_instance!(workflow_path)
    maybe_set_workflow(workflow_path)
    override_port!()

    # Migrate before starting the app: the Orchestrator queries the projects
    # table in `init`, so a fresh database must be migrated first.
    migrate_repo!()

    case Application.ensure_all_started(:symphony_elixir) do
      {:ok, _started} ->
        maybe_discover_projects()
        announce_ready(workflow_path)
        Process.sleep(:infinity)

      {:error, reason} ->
        fail("Failed to start Symphony: #{inspect(reason, pretty: true)}")
    end
  end

  # Optional: create missing projects from WORKFLOW.<slug>.md files in the scan
  # directory. Never overwrites DB-owned config. Runs post-start (the
  # orchestrator re-lists projects each poll, so freshly discovered projects are
  # picked up on the next cycle).
  defp maybe_discover_projects do
    case DevServe.discovery_dir(System.get_env()) do
      {:ok, dir} ->
        summary = SymphonyElixir.WorkflowDiscovery.discover(dir)

        case summary.discovered do
          [] -> :ok
          slugs -> IO.puts("Discovered projects from WORKFLOW.<slug>.md: #{Enum.join(slugs, ", ")}")
        end

      :disabled ->
        :ok
    end
  end

  # Returns the optional workflow path (or nil). Boot no longer requires a
  # workflow file; per-project config is DB-owned.
  defp resolve_workflow_path do
    case DevServe.resolve_workflow_source(System.argv(), System.get_env()) do
      {:ok, path} -> path
      :none -> nil
      {:missing, path} -> fail("Workflow file not found: #{path}")
    end
  end

  defp maybe_set_workflow(nil), do: :ok

  defp maybe_set_workflow(path) when is_binary(path) do
    :ok = SymphonyElixir.Workflow.set_workflow_file_path(path)
  end

  defp override_port! do
    case DevServe.resolve_port(System.get_env()) do
      {:ok, nil} -> :ok
      {:ok, port} -> maybe_override_port(port)
      {:error, message} -> fail(message)
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
    IO.puts("Workflow: #{workflow_path || "(none — per-project config from DB)"}")
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
