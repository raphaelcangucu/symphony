defmodule SymphonyElixir.Repo.Migrations.CanonicalizeAssistantIdentity do
  use Ecto.Migration

  def up do
    execute("""
    UPDATE assistant_threads
    SET provider_bindings = json_patch(
      COALESCE(agent_thread_ids, '{}'),
      COALESCE(provider_bindings, '{}')
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
      AND trim(codex_thread_id) != ''
      AND json_extract(COALESCE(provider_bindings, '{}'), '$.codex') IS NULL
    """)

    execute("""
    UPDATE assistant_threads
    SET provider_bindings = COALESCE(
      (
        SELECT json_group_object(provider, conversation_id)
        FROM (
          SELECT
            provider,
            COALESCE(
              MAX(CASE WHEN original_provider = provider THEN conversation_id END),
              MAX(conversation_id)
            ) AS conversation_id
          FROM (
            SELECT
              key AS original_provider,
              lower(trim(key)) AS provider,
              CASE
                WHEN type = 'object' THEN COALESCE(
                  json_extract(value, '$.conversation_id'),
                  json_extract(value, '$.external_id')
                )
                ELSE value
              END AS conversation_id
            FROM json_each(COALESCE(assistant_threads.provider_bindings, '{}'))
            WHERE lower(trim(key)) IN ('codex', 'claude', 'cursor', 'opencode')
          )
          WHERE typeof(conversation_id) = 'text'
            AND trim(conversation_id) != ''
          GROUP BY provider
        )
      ),
      '{}'
    )
    """)

    execute("""
    UPDATE assistant_threads
    SET agent_kind = CASE
      WHEN lower(trim(agent_kind)) IN ('codex', 'claude', 'cursor', 'opencode')
      THEN lower(trim(agent_kind))
      ELSE NULL
    END
    WHERE agent_kind IS NOT NULL
    """)

    execute("""
    UPDATE assistant_threads
    SET metadata = json_set(
      COALESCE(metadata, '{}'),
        '$.current_turn.provider',
        COALESCE(
          CASE
            WHEN lower(trim(json_extract(metadata, '$.current_turn.provider')))
              IN ('codex', 'claude', 'cursor', 'opencode')
            THEN lower(trim(json_extract(metadata, '$.current_turn.provider')))
          END,
          CASE
            WHEN lower(trim(json_extract(metadata, '$.current_turn.agent_kind')))
              IN ('codex', 'claude', 'cursor', 'opencode')
            THEN lower(trim(json_extract(metadata, '$.current_turn.agent_kind')))
          END,
          CASE
            WHEN json_extract(metadata, '$.current_turn.codex_thread_id') IS NOT NULL
            THEN 'codex'
          END
        )
    )
    WHERE json_type(metadata, '$.current_turn') = 'object'
    """)

    execute("""
    UPDATE assistant_threads
    SET metadata = json_remove(
      json_set(
        COALESCE(metadata, '{}'),
        '$.current_turn.conversation_id',
        COALESCE(
          json_extract(metadata, '$.current_turn.conversation_id'),
          CASE
            WHEN json_extract(metadata, '$.current_turn.provider') = 'codex'
            THEN json_extract(metadata, '$.current_turn.codex_thread_id')
          END,
          json_extract(
            COALESCE(provider_bindings, '{}'),
            '$.' || json_extract(metadata, '$.current_turn.provider')
          )
        ),
        '$.current_turn.run_id',
        COALESCE(
          json_extract(metadata, '$.current_turn.run_id'),
          json_extract(metadata, '$.current_turn.turn_id')
        ),
        '$.current_turn.execution_id',
        COALESCE(
          json_extract(metadata, '$.current_turn.execution_id'),
          json_extract(metadata, '$.current_turn.generation'),
          json_extract(metadata, '$.current_turn.session_id')
        )
      ),
      '$.current_turn.codex_thread_id',
      '$.current_turn.turn_id',
      '$.current_turn.session_id',
      '$.current_turn.agent_kind',
      '$.current_turn.generation'
    )
    WHERE json_type(metadata, '$.current_turn') = 'object'
    """)

    execute("""
    UPDATE assistant_threads
    SET metadata = json_set(
      COALESCE(metadata, '{}'),
      '$.pending_turns',
      json(
        COALESCE(
          (
            SELECT json_group_array(
              json(
                json_remove(
                  json_set(
                    pending.value,
                    '$.provider',
                    lower(
                      trim(
                        COALESCE(
                          CASE
                            WHEN lower(trim(json_extract(pending.value, '$.provider')))
                              IN ('codex', 'claude', 'cursor', 'opencode')
                            THEN json_extract(pending.value, '$.provider')
                          END,
                          CASE
                            WHEN lower(trim(json_extract(pending.value, '$.agent_kind')))
                              IN ('codex', 'claude', 'cursor', 'opencode')
                            THEN json_extract(pending.value, '$.agent_kind')
                          END,
                          assistant_threads.agent_kind
                        )
                      )
                    )
                  ),
                  '$.agent_kind'
                )
              )
            )
            FROM json_each(metadata, '$.pending_turns') AS pending
            WHERE lower(trim(json_extract(pending.value, '$.provider')))
                    IN ('codex', 'claude', 'cursor', 'opencode')
               OR lower(trim(json_extract(pending.value, '$.agent_kind')))
                    IN ('codex', 'claude', 'cursor', 'opencode')
               OR assistant_threads.agent_kind IN ('codex', 'claude', 'cursor', 'opencode')
          ),
          '[]'
        )
      )
    )
    WHERE json_type(metadata, '$.pending_turns') = 'array'
    """)

    rename(table(:assistant_messages), :turn_id, to: :run_id)

    alter table(:assistant_threads) do
      remove(:agent_thread_ids)
      remove(:codex_thread_id)
    end

    execute("""
    UPDATE gateway_bindings
    SET default_agent_kind = CASE
      WHEN lower(trim(default_agent_kind)) IN ('codex', 'claude', 'cursor', 'opencode')
      THEN lower(trim(default_agent_kind))
      ELSE 'codex'
    END
    """)

    execute("""
    CREATE TRIGGER gateway_bindings_require_default_agent_kind_insert
    BEFORE INSERT ON gateway_bindings
    WHEN NEW.default_agent_kind IS NULL
      OR NEW.default_agent_kind NOT IN ('codex', 'claude', 'cursor', 'opencode')
    BEGIN
      SELECT RAISE(ABORT, 'gateway binding provider is required');
    END
    """)

    execute("""
    CREATE TRIGGER gateway_bindings_require_default_agent_kind_update
    BEFORE UPDATE OF default_agent_kind ON gateway_bindings
    WHEN NEW.default_agent_kind IS NULL
      OR NEW.default_agent_kind NOT IN ('codex', 'claude', 'cursor', 'opencode')
    BEGIN
      SELECT RAISE(ABORT, 'gateway binding provider is required');
    END
    """)
  end

  def down do
    execute("DROP TRIGGER IF EXISTS gateway_bindings_require_default_agent_kind_update")
    execute("DROP TRIGGER IF EXISTS gateway_bindings_require_default_agent_kind_insert")

    alter table(:assistant_threads) do
      add(:codex_thread_id, :string)
      add(:agent_thread_ids, :map)
    end

    execute("""
    UPDATE assistant_threads
    SET agent_thread_ids = COALESCE(provider_bindings, '{}'),
        codex_thread_id = json_extract(COALESCE(provider_bindings, '{}'), '$.codex')
    """)

    rename(table(:assistant_messages), :run_id, to: :turn_id)
  end
end
