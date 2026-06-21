# Resilient local boot for the Symphony tracker.
#
# Runs the full OTP application via Mix (`mix run --no-start dev/serve.exs`) so
# it uses the compiled dependencies in `_build`, where native NIFs such as the
# `exqlite` SQLite driver are available. The packaged escript (`bin/symphony`)
# cannot load those NIFs, which is why `make serve` boots through this script.
#
# Inputs (all optional — global-less orchestration boots with process settings only):
#   * $SYMPHONY_TRACKER_PORT  : HTTP port override
#   * $SYMPHONY_TRACKER_TOKEN : bearer token for the tracker API
#
# Per-project behavior is DB-owned (`workflow_markdown`); process settings come
# from `SYMPHONY_*` env. There is no global WORKFLOW.md.

defmodule Symphony.DevServe do
  alias SymphonyElixir.DevServe

  def run do
    DevServe.load_dotenv!()
    ensure_single_instance!()
    override_port!()

    # Migrate before starting the app: the Orchestrator queries the projects
    # table in `init`, so a fresh database must be migrated first.
    migrate_repo!()

    case Application.ensure_all_started(:symphony_elixir) do
      {:ok, _started} ->
        announce_ready()
        Process.sleep(:infinity)

      {:error, reason} ->
        fail("Failed to start Symphony: #{inspect(reason, pretty: true)}")
    end
  end

  defp override_port! do
    case DevServe.resolve_port(System.get_env()) do
      {:ok, nil} -> :ok
      {:ok, port} -> maybe_override_port(port)
      {:error, message} -> fail(message)
    end
  end

  defp ensure_single_instance! do
    case SymphonyElixir.DevServeGuard.acquire(node_name: to_string(node())) do
      :ok ->
        :ok

      {:error, {:already_running, %{"pid" => pid}}} ->
        fail("""
        Another Symphony tracker serve is already running (pid #{pid}).

        Stop the other instance first:

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

  defp announce_ready do
    port = SymphonyElixir.HttpServer.bound_port()
    suffix = if is_integer(port), do: "http://localhost:#{port}/tracker", else: "(HTTP server not bound)"
    IO.puts("\nSymphony tracker is running → #{suffix}")
    IO.puts("Per-project config: DB-owned (no global WORKFLOW.md).")
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
