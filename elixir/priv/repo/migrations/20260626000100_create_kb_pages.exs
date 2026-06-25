defmodule SymphonyElixir.Repo.Migrations.CreateKbPages do
  use Ecto.Migration

  def change do
    create table(:kb_pages) do
      add(:project_slug, :string, null: false)
      add(:repo_slug, :string, null: false)
      add(:path, :string, null: false)
      add(:title, :string, null: false, default: "")
      add(:body, :text, null: false, default: "")
      add(:archived, :boolean, null: false, default: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:kb_pages, [:project_slug, :repo_slug, :path]))
    create(index(:kb_pages, [:project_slug]))
  end
end
