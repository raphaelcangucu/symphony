defmodule SymphonyElixir.LocalTracker.WorkspaceTemplate do
  @moduledoc "Reusable multi-repo workspace blueprint."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.WorkspaceTemplateRepository

  @type t :: %__MODULE__{}

  schema "local_tracker_workspace_templates" do
    field(:name, :string)
    field(:slug, :string)
    field(:description, :string)
    field(:workflow_statuses, :map, default: %{})
    field(:validation_commands, :map, default: %{})
    field(:after_create_hook, :string)
    field(:before_run_hook, :string)
    field(:after_run_hook, :string)
    field(:before_remove_hook, :string)
    field(:prompt_template, :string)
    field(:dev_env_markdown, :string)
    field(:metadata, :map, default: %{})

    has_many(:repositories, WorkspaceTemplateRepository,
      foreign_key: :template_id,
      on_delete: :delete_all
    )

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(template, attrs) do
    template
    |> cast(attrs, [
      :name,
      :slug,
      :description,
      :after_create_hook,
      :before_run_hook,
      :after_run_hook,
      :before_remove_hook,
      :prompt_template,
      :dev_env_markdown,
      :metadata
    ])
    |> cast_list(attrs, :workflow_statuses)
    |> cast_list(attrs, :validation_commands)
    |> validate_required([:name, :slug])
    |> unique_constraint(:slug)
  end

  @spec workflow_statuses_list(t()) :: [map()]
  def workflow_statuses_list(%__MODULE__{workflow_statuses: %{"items" => items}}) when is_list(items), do: items
  def workflow_statuses_list(_), do: []

  @spec validation_commands_list(t()) :: [String.t()]
  def validation_commands_list(%__MODULE__{validation_commands: %{"items" => items}}) when is_list(items), do: items
  def validation_commands_list(_), do: []

  defp cast_list(changeset, attrs, field) do
    raw = Map.get(attrs, field) || Map.get(attrs, Atom.to_string(field))

    case raw do
      list when is_list(list) -> put_change(changeset, field, %{"items" => list})
      %{"items" => _} = wrapped -> put_change(changeset, field, wrapped)
      _ -> changeset
    end
  end
end
