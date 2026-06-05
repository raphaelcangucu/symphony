defmodule SymphonyElixir.Repo.Migrations.CreateSettings do
  use Ecto.Migration

  def change do
    create table(:settings) do
      add(:group, :string, null: false)
      add(:name, :string, null: false)
      add(:payload, :map, null: false, default: %{})

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:settings, [:group, :name]))
  end
end
