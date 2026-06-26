defmodule SymphonyElixir.KnowledgeBase.PageRecord do
  @moduledoc "Ecto schema for derived KB page metadata (search index source)."

  use Ecto.Schema
  import Ecto.Changeset

  @type t :: %__MODULE__{}

  schema "kb_pages" do
    field(:project_slug, :string)
    field(:repo_slug, :string)
    field(:path, :string)
    field(:title, :string, default: "")
    field(:body, :string, default: "")
    field(:archived, :boolean, default: false)

    timestamps(type: :utc_datetime_usec)
  end

  @required ~w(project_slug repo_slug path)a
  @optional ~w(title body archived)a

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, @required ++ @optional)
    |> validate_required(@required)
    |> unique_constraint(:path, name: :kb_pages_project_slug_repo_slug_path_index)
  end
end
