defmodule SymphonyElixir.Repo.Migrations.AddProjectExploreAssistantScope do
  use Ecto.Migration

  def up do
    execute("""
    CREATE UNIQUE INDEX IF NOT EXISTS "assistant_threads_active_project_explore_index"
      ON "assistant_threads" ("project_slug")
      WHERE status = 'active' AND scope = 'project_explore'
    """)
  end

  def down do
    execute(~s|DROP INDEX IF EXISTS "assistant_threads_active_project_explore_index"|)
  end
end
