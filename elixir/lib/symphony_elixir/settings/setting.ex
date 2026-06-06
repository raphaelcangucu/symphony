defmodule SymphonyElixir.Settings.Setting do
  @moduledoc "One stored setting value, keyed by (group, name) — spatie/laravel-settings model."

  use Ecto.Schema
  import Ecto.Changeset

  @type t :: %__MODULE__{}

  schema "settings" do
    field(:group, :string)
    field(:name, :string)
    field(:payload, :map, default: %{})

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(setting, attrs) do
    setting
    |> cast(attrs, [:group, :name, :payload])
    |> validate_required([:group, :name, :payload])
    |> unique_constraint([:group, :name])
  end
end
