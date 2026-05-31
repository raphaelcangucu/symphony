defmodule SymphonyElixir.Repo.Migrations.CreateAssistantChatHistory do
  use Ecto.Migration

  def change do
    create table(:assistant_threads) do
      add(:project_slug, :string, null: false)
      add(:codex_thread_id, :string)
      add(:workspace_path, :text, null: false)
      add(:status, :string, null: false, default: "active")
      add(:metadata, :map, null: false, default: %{})

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:assistant_threads, [:project_slug], where: "status = 'active'", name: :assistant_threads_active_project_slug_index))
    create(index(:assistant_threads, [:project_slug]))

    create table(:assistant_messages) do
      add(:thread_id, references(:assistant_threads, on_delete: :delete_all), null: false)
      add(:sequence, :integer, null: false)
      add(:role, :string, null: false)
      add(:content, :text, null: false)
      add(:turn_id, :string)
      add(:tool_calls, :map, null: false, default: %{"calls" => []})
      add(:metadata, :map, null: false, default: %{})

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:assistant_messages, [:thread_id, :sequence]))
    create(index(:assistant_messages, [:thread_id]))
  end
end
