defmodule SymphonyElixir.Repo.Migrations.AddAgentFieldsToAssistantThreads do
  use Ecto.Migration

  def up do
    alter table(:assistant_threads) do
      add(:agent_kind, :string)
      add(:agent_thread_ids, :map)
    end

    execute("""
    UPDATE assistant_threads
    SET agent_thread_ids = json_object('codex', codex_thread_id)
    WHERE codex_thread_id IS NOT NULL
    """)

    execute("""
    UPDATE assistant_threads
    SET agent_thread_ids = '{}'
    WHERE agent_thread_ids IS NULL
    """)
  end

  def down do
    alter table(:assistant_threads) do
      remove(:agent_kind)
      remove(:agent_thread_ids)
    end
  end
end
