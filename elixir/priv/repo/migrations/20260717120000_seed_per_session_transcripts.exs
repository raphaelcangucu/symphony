defmodule SymphonyElixir.Repo.Migrations.SeedPerSessionTranscripts do
  @moduledoc """
  Data migration: seed `.symphony/sessions/<thread_id>/transcript.jsonl` from
  each Thread's shared working-tree agent log when the per-session file is
  missing.

  Idempotent — safe if the mix task already ran, and safe to re-run.
  """

  use Ecto.Migration

  require Logger

  def up do
    result = SymphonyElixir.Agent.SessionLogMigrator.migrate()

    Logger.info(
      "SeedPerSessionTranscripts: migrated=#{result.migrated} " <>
        "skipped=#{result.skipped} errors=#{result.errors}"
    )
  end

  def down do
    # Intentionally empty: seeded transcript files are retained on rollback so
    # we never delete operator session history.
    :ok
  end
end
