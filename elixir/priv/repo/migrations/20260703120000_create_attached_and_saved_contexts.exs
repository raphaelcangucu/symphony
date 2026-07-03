defmodule SymphonyElixir.Repo.Migrations.CreateAttachedAndSavedContexts do
  use Ecto.Migration

  def change do
    create table(:attached_contexts) do
      add(:scope, :string, null: false)
      add(:project_slug, :string, null: false)
      add(:issue_identifier, :string)
      add(:thread_id, :integer)
      add(:kind, :string, null: false)
      add(:ref_key, :string, null: false)
      add(:title, :string, null: false)
      add(:content_md, :text, null: false)
      add(:metadata, :map, default: %{})
      add(:position, :integer, default: 0)

      timestamps(type: :utc_datetime_usec)
    end

    create(
      unique_index(
        :attached_contexts,
        [:project_slug, :issue_identifier, :kind, :ref_key],
        name: :attached_contexts_execution_unique_ref,
        where: "scope = 'execution'"
      )
    )

    create(
      unique_index(
        :attached_contexts,
        [:thread_id, :kind, :ref_key],
        name: :attached_contexts_assistant_unique_ref,
        where: "scope = 'assistant'"
      )
    )

    create(index(:attached_contexts, [:scope, :project_slug, :issue_identifier]))
    create(index(:attached_contexts, [:scope, :thread_id]))

    create table(:saved_contexts) do
      add(:project_slug, :string, null: false)
      add(:slug, :string, null: false)
      add(:name, :string)
      add(:content_md, :text, null: false)
      add(:source_scope, :string)
      add(:source_issue_identifier, :string)
      add(:source_thread_id, :integer)
      add(:metadata, :map, default: %{})

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:saved_contexts, [:project_slug, :slug]))
  end
end
