defmodule SymphonyElixir.Repo.Migrations.ExtendAssistantThreadsScope do
  use Ecto.Migration

  # SQLite does not support `ALTER TABLE ... ALTER COLUMN`, so making
  # `project_slug` nullable requires the documented "create new table, copy,
  # drop, rename" rebuild. Three SQLite caveats are handled explicitly:
  #
  #   * `assistant_messages.thread_id` references `assistant_threads` with
  #     `ON DELETE CASCADE`, so dropping the old table with foreign keys enabled
  #     would silently cascade-delete every message. Foreign keys must be OFF for
  #     the rebuild, and `PRAGMA foreign_keys` is a no-op inside a transaction,
  #     hence `@disable_ddl_transaction true`.
  #   * Renaming the rebuilt table back to `assistant_threads` triggers SQLite's
  #     modern rename behavior, which tries to rewrite the foreign-key reference
  #     in `assistant_messages` and fails with "there is already another table or
  #     index with this name". `PRAGMA legacy_alter_table = ON` restores the
  #     simple rename semantics so the reference keeps pointing at the new table.
  #   * `PRAGMA`s are connection-scoped. Without a DDL transaction, each `execute`
  #     may run on a different pooled connection, so the pragmas would not apply
  #     to the statement that needs them. We therefore pin a single connection
  #     with `repo().checkout/1` and run the whole rebuild on it.
  @disable_ddl_transaction true

  def up do
    rebuild(&up_statements/1)
  end

  def down do
    rebuild(&down_statements/1)
  end

  defp rebuild(statements_fun) do
    repo().checkout(fn ->
      run_sql("PRAGMA foreign_keys = OFF")
      run_sql("PRAGMA legacy_alter_table = ON")

      statements_fun.(&run_sql/1)

      run_sql("PRAGMA legacy_alter_table = OFF")
      run_sql("PRAGMA foreign_keys = ON")
    end)
  end

  defp run_sql(sql) do
    Ecto.Adapters.SQL.query!(repo(), sql, [])
  end

  defp up_statements(sql) do
    sql.("""
    CREATE TABLE "assistant_threads_new" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "project_slug" TEXT,
      "codex_thread_id" TEXT,
      "workspace_path" TEXT NOT NULL,
      "status" TEXT DEFAULT 'active' NOT NULL,
      "metadata" TEXT DEFAULT ('{}') NOT NULL,
      "scope" TEXT DEFAULT 'project' NOT NULL,
      "issue_identifier" TEXT,
      "title" TEXT,
      "inserted_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL
    )
    """)

    sql.("""
    INSERT INTO "assistant_threads_new"
      ("id", "project_slug", "codex_thread_id", "workspace_path", "status",
       "metadata", "scope", "issue_identifier", "title", "inserted_at", "updated_at")
    SELECT
      "id", "project_slug", "codex_thread_id", "workspace_path", "status",
      "metadata", 'project', NULL, NULL, "inserted_at", "updated_at"
    FROM "assistant_threads"
    """)

    sql.(~s|DROP TABLE "assistant_threads"|)
    sql.(~s|ALTER TABLE "assistant_threads_new" RENAME TO "assistant_threads"|)

    sql.(~s|CREATE INDEX "assistant_threads_project_slug_index" ON "assistant_threads" ("project_slug")|)

    sql.("""
    CREATE UNIQUE INDEX "assistant_threads_active_project_index"
      ON "assistant_threads" ("project_slug")
      WHERE status = 'active' AND scope = 'project'
    """)

    sql.("""
    CREATE UNIQUE INDEX "assistant_threads_active_issue_index"
      ON "assistant_threads" ("project_slug", "issue_identifier")
      WHERE status = 'active' AND scope = 'issue'
    """)
  end

  defp down_statements(sql) do
    sql.("""
    CREATE TABLE "assistant_threads_old" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "project_slug" TEXT NOT NULL,
      "codex_thread_id" TEXT,
      "workspace_path" TEXT NOT NULL,
      "status" TEXT DEFAULT 'active' NOT NULL,
      "metadata" TEXT DEFAULT ('{}') NOT NULL,
      "inserted_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL
    )
    """)

    # Freeform rows (null project_slug) cannot satisfy the restored NOT NULL
    # constraint, so they are intentionally dropped on rollback.
    sql.("""
    INSERT INTO "assistant_threads_old"
      ("id", "project_slug", "codex_thread_id", "workspace_path", "status",
       "metadata", "inserted_at", "updated_at")
    SELECT
      "id", "project_slug", "codex_thread_id", "workspace_path", "status",
      "metadata", "inserted_at", "updated_at"
    FROM "assistant_threads"
    WHERE "project_slug" IS NOT NULL
    """)

    sql.(~s|DROP TABLE "assistant_threads"|)
    sql.(~s|ALTER TABLE "assistant_threads_old" RENAME TO "assistant_threads"|)

    sql.(~s|CREATE INDEX "assistant_threads_project_slug_index" ON "assistant_threads" ("project_slug")|)

    sql.("""
    CREATE UNIQUE INDEX "assistant_threads_active_project_slug_index"
      ON "assistant_threads" ("project_slug")
      WHERE status = 'active'
    """)

    # Dropping freeform threads above orphans any messages that referenced them,
    # since the rebuild runs with foreign keys disabled (no cascade fires).
    # Delete those orphans so referential integrity holds once foreign keys are
    # re-enabled.
    sql.(~s|DELETE FROM "assistant_messages" WHERE "thread_id" NOT IN (SELECT "id" FROM "assistant_threads")|)
  end
end
