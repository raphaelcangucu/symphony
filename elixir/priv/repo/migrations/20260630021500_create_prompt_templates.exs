defmodule SymphonyElixir.Repo.Migrations.CreatePromptTemplates do
  use Ecto.Migration

  def change do
    create table(:prompt_templates) do
      add(:slug, :string, null: false)
      add(:name, :string, null: false)
      add(:description, :string)
      add(:category, :string)
      add(:body, :text, null: false)
      add(:agent_kind, :string)
      add(:model, :string)
      add(:effort, :string)
      add(:mode, :string)
      add(:scope, :string, null: false, default: "global")
      add(:built_in, :boolean, null: false, default: false)
      add(:enabled, :boolean, null: false, default: true)
      add(:position, :integer, null: false, default: 0)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:prompt_templates, [:scope, :slug]))
  end
end
