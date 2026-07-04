defmodule SymphonyElixir.PromptTemplates.Template do
  @moduledoc "Persisted prompt template definition for Magic Commands."

  use Ecto.Schema

  import Ecto.Changeset

  alias SymphonyElixir.ExecutionMode

  @type t :: %__MODULE__{}

  @castable_fields ~w(
    slug
    name
    description
    category
    body
    agent_kind
    model
    effort
    mode
    scope
    built_in
    enabled
    position
  )a

  @required_fields ~w(slug name body scope)a

  schema "prompt_templates" do
    field(:slug, :string)
    field(:name, :string)
    field(:description, :string)
    field(:category, :string)
    field(:body, :string)
    field(:agent_kind, :string)
    field(:model, :string)
    field(:effort, :string)
    field(:mode, :string)
    field(:scope, :string, default: "global")
    field(:built_in, :boolean, default: false)
    field(:enabled, :boolean, default: true)
    field(:position, :integer, default: 0)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(template, attrs) do
    template
    |> cast(attrs, @castable_fields)
    |> update_change(:slug, &String.trim/1)
    |> update_change(:scope, &String.trim/1)
    |> validate_required(@required_fields)
    |> validate_format(:slug, ~r/\S/, message: "must contain non-whitespace characters")
    |> validate_inclusion(:mode, ExecutionMode.all())
    |> unique_constraint([:scope, :slug])
  end
end
