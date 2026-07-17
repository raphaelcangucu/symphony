defmodule SymphonyElixir.Repo.Migrations.SeedPerSessionTranscripts do
  @moduledoc """
  Data migration for per-session identity:

  1. Create a historical `issue_execution` Thread for each issue working tree
     that has a shared agent log but no execution session yet.
  2. Seed `.symphony/sessions/<thread_id>/transcript.jsonl` from the shared
     working-tree agent log when that per-session file is missing.

  Idempotent — safe if the mix task already ran, and safe to re-run.
  """

  use Ecto.Migration

  require Logger

  def up do
    result = SymphonyElixir.Agent.SessionLogMigrator.migrate()

    Logger.info(
      "SeedPerSessionTranscripts: created=#{result.created} " <>
        "migrated=#{result.migrated} skipped=#{result.skipped} errors=#{result.errors}"
    )
  end

  def down do
    # Intentionally empty: created sessions and seeded transcript files are
    # retained on rollback so we never delete operator session history.
    :ok
  end
end
