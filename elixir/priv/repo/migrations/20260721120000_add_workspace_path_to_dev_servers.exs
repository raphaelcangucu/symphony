defmodule SymphonyElixir.Repo.Migrations.AddWorkspacePathToDevServers do
  use Ecto.Migration

  def up do
    execute("DROP INDEX IF EXISTS local_tracker_dev_servers_project_id_issue_identifier_slug_index")

    execute("""
    CREATE TABLE local_tracker_dev_servers_workspace_migration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES local_tracker_projects(id) ON DELETE CASCADE,
      issue_identifier TEXT,
      workspace_path TEXT,
      working_dir TEXT,
      slug TEXT NOT NULL,
      port INTEGER,
      url TEXT,
      status TEXT NOT NULL DEFAULT 'stopped',
      "primary" INTEGER NOT NULL DEFAULT 0,
      session_name TEXT,
      started_at TEXT,
      inserted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT local_tracker_dev_servers_exactly_one_scope CHECK (
        (issue_identifier IS NOT NULL AND workspace_path IS NULL) OR
        (issue_identifier IS NULL AND workspace_path IS NOT NULL)
      )
    )
    """)

    execute("""
    INSERT INTO local_tracker_dev_servers_workspace_migration (
      id, project_id, issue_identifier, workspace_path, working_dir, slug, port,
      url, status, "primary", session_name, started_at, inserted_at, updated_at
    )
    SELECT
      id, project_id, issue_identifier, NULL, working_dir, slug, port,
      url, status, "primary", session_name, started_at, inserted_at, updated_at
    FROM local_tracker_dev_servers
    """)

    execute("DROP TABLE local_tracker_dev_servers")

    execute(
      "ALTER TABLE local_tracker_dev_servers_workspace_migration " <>
        "RENAME TO local_tracker_dev_servers"
    )

    execute(
      "CREATE INDEX local_tracker_dev_servers_project_id_index " <>
        "ON local_tracker_dev_servers (project_id)"
    )

    execute("""
    CREATE UNIQUE INDEX local_tracker_dev_servers_issue_scope_index
    ON local_tracker_dev_servers (project_id, issue_identifier, slug)
    WHERE issue_identifier IS NOT NULL
    """)

    execute("""
    CREATE UNIQUE INDEX local_tracker_dev_servers_workspace_scope_index
    ON local_tracker_dev_servers (project_id, workspace_path, slug)
    WHERE workspace_path IS NOT NULL
    """)
  end

  def down do
    execute("DROP INDEX IF EXISTS local_tracker_dev_servers_workspace_scope_index")
    execute("DROP INDEX IF EXISTS local_tracker_dev_servers_issue_scope_index")
    execute("DROP INDEX IF EXISTS local_tracker_dev_servers_project_id_index")

    execute("""
    CREATE TABLE local_tracker_dev_servers_issue_migration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES local_tracker_projects(id) ON DELETE CASCADE,
      issue_identifier TEXT NOT NULL,
      working_dir TEXT,
      slug TEXT NOT NULL,
      port INTEGER,
      url TEXT,
      status TEXT NOT NULL DEFAULT 'stopped',
      "primary" INTEGER NOT NULL DEFAULT 0,
      session_name TEXT,
      started_at TEXT,
      inserted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """)

    execute("""
    INSERT INTO local_tracker_dev_servers_issue_migration (
      id, project_id, issue_identifier, working_dir, slug, port, url, status,
      "primary", session_name, started_at, inserted_at, updated_at
    )
    SELECT
      id, project_id, issue_identifier, working_dir, slug, port, url, status,
      "primary", session_name, started_at, inserted_at, updated_at
    FROM local_tracker_dev_servers
    WHERE issue_identifier IS NOT NULL
    """)

    execute("DROP TABLE local_tracker_dev_servers")

    execute(
      "ALTER TABLE local_tracker_dev_servers_issue_migration " <>
        "RENAME TO local_tracker_dev_servers"
    )

    execute(
      "CREATE INDEX local_tracker_dev_servers_project_id_index " <>
        "ON local_tracker_dev_servers (project_id)"
    )

    execute("""
    CREATE UNIQUE INDEX local_tracker_dev_servers_project_id_issue_identifier_slug_index
    ON local_tracker_dev_servers (project_id, issue_identifier, slug)
    """)
  end
end
