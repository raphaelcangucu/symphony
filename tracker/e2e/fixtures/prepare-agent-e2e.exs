database = System.fetch_env!("SYMPHONY_LOCAL_TRACKER_DATABASE")
Application.put_env(:symphony_elixir, SymphonyElixir.Repo, database: database)
Application.put_env(:symphony_elixir, :local_tracker_database_pinned?, true)

migrations = Application.app_dir(:symphony_elixir, "priv/repo/migrations")

{:ok, _, _} =
  Ecto.Migrator.with_repo(SymphonyElixir.Repo, fn repo ->
    Ecto.Migrator.run(repo, migrations, :up, all: true)
  end)
