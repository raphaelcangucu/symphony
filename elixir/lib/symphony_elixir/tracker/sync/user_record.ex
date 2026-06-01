defmodule SymphonyElixir.Tracker.Sync.UserRecord do
  @moduledoc "Cached tracker user (assignee/author) for local display and `assignee: me`."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}

  schema "tracker_users" do
    field(:remote_id, :string)
    field(:login, :string)
    field(:name, :string)
    field(:avatar_url, :string)

    belongs_to(:project, Project)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(user, attrs) do
    user
    |> cast(attrs, [:project_id, :remote_id, :login, :name, :avatar_url])
    |> validate_required([:project_id, :login])
    |> unique_constraint([:project_id, :login])
  end
end
