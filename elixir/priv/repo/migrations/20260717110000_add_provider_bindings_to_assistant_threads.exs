defmodule SymphonyElixir.Repo.Migrations.AddProviderBindingsToAssistantThreads do
  use Ecto.Migration

  def up do
    alter table(:assistant_threads) do
      add(:provider_bindings, :map, null: false, default: %{})
    end

    execute("""
    UPDATE assistant_threads
    SET provider_bindings = COALESCE(
      (
        SELECT json_group_object(key, value)
        FROM json_each(COALESCE(assistant_threads.agent_thread_ids, '{}'))
        WHERE value IS NOT NULL AND value != ''
      ),
      '{}'
    )
    """)

    execute("""
    UPDATE assistant_threads
    SET provider_bindings = json_set(
      COALESCE(provider_bindings, '{}'),
      '$.codex',
      codex_thread_id
    )
    WHERE codex_thread_id IS NOT NULL
      AND codex_thread_id != ''
      AND json_extract(COALESCE(provider_bindings, '{}'), '$.codex') IS NULL
    """)
  end

  def down do
    alter table(:assistant_threads) do
      remove(:provider_bindings)
    end
  end
end
