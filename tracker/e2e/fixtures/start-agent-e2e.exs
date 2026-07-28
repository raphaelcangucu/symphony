Code.require_file(Path.join(__DIR__, "e2e_installer.exs"))

root = System.fetch_env!("SYMPHONY_AGENT_E2E_ROOT")
database = System.fetch_env!("SYMPHONY_LOCAL_TRACKER_DATABASE")

Application.put_env(:symphony_elixir, :agent_data_dir, Path.join(root, "data"))
Application.put_env(:symphony_elixir, :agent_installer, SymphonyElixir.AgentLifecycle.E2EInstaller)
Application.put_env(:symphony_elixir, :local_tracker_database_pinned?, true)
Application.put_env(:symphony_elixir, SymphonyElixir.Repo, database: database)
Application.put_env(:symphony_elixir, :log_file, Path.join(root, "logs/symphony.log"))
Application.put_env(:symphony_elixir, :sql_log_file, Path.join(root, "logs/symphony.sql.log"))
Application.put_env(:symphony_elixir, :tracker, sync_enabled: false)
Application.put_env(:symphony_elixir, :kb_promote_enabled, false)
Application.put_env(:symphony_elixir, :viewer_persist_enabled, false)
Application.put_env(:symphony_elixir, :tracker_seed_on_empty, false)
Application.put_env(:symphony_elixir, :claude_usage_probe_enabled, false)

{:ok, _applications} = Application.ensure_all_started(:symphony_elixir)
Process.sleep(:infinity)
