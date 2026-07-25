defmodule SymphonyElixir.Repo.Migrations.AddModelProvenanceToAssistantThreads do
  use Ecto.Migration

  def up do
    existing_columns = assistant_thread_columns()

    add_column_unless_present(existing_columns, :requested_model)
    add_column_unless_present(existing_columns, :requested_effort)
    add_column_unless_present(existing_columns, :resolved_model)
    add_column_unless_present(existing_columns, :resolved_effort)

    execute("""
    UPDATE assistant_threads
    SET requested_model = trim(json_extract(metadata, '$.model'))
    WHERE (requested_model IS NULL OR trim(requested_model) = '')
      AND typeof(json_extract(metadata, '$.model')) = 'text'
      AND trim(json_extract(metadata, '$.model')) != ''
    """)

    execute("""
    UPDATE assistant_threads
    SET requested_effort = trim(json_extract(metadata, '$.effort'))
    WHERE (requested_effort IS NULL OR trim(requested_effort) = '')
      AND typeof(json_extract(metadata, '$.effort')) = 'text'
      AND trim(json_extract(metadata, '$.effort')) != ''
    """)

    execute("""
    UPDATE assistant_threads
    SET metadata = json_remove(
      COALESCE(metadata, '{}'),
      '$.model',
      '$.effort',
      '$.current_turn.model',
      '$.current_turn.effort'
    )
    """)

    execute("""
    UPDATE assistant_threads
    SET requested_effort = NULL, resolved_effort = NULL
    WHERE agent_kind = 'cursor'
    """)
  end

  def down do
    existing_columns = assistant_thread_columns()

    remove_column_if_present(existing_columns, :requested_model)
    remove_column_if_present(existing_columns, :requested_effort)
    remove_column_if_present(existing_columns, :resolved_model)
    remove_column_if_present(existing_columns, :resolved_effort)
  end

  defp assistant_thread_columns do
    repo().query!("PRAGMA table_info(assistant_threads)").rows
    |> Enum.map(fn [_cid, name | _rest] -> name end)
    |> MapSet.new()
  end

  defp add_column_unless_present(existing_columns, column) do
    unless MapSet.member?(existing_columns, Atom.to_string(column)) do
      alter table(:assistant_threads) do
        add(column, :string)
      end
    end
  end

  defp remove_column_if_present(existing_columns, column) do
    if MapSet.member?(existing_columns, Atom.to_string(column)) do
      alter table(:assistant_threads) do
        remove(column)
      end
    end
  end
end
