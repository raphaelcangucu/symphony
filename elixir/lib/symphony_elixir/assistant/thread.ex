defmodule SymphonyElixir.Assistant.Thread do
  @moduledoc "Persistent Codex-backed assistant thread for one tracker project."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.Assistant.Message

  @type t :: %__MODULE__{}

  schema "assistant_threads" do
    field(:project_slug, :string)
    field(:codex_thread_id, :string)
    field(:workspace_path, :string)
    field(:status, :string, default: "active")
    field(:metadata, :map, default: %{})

    has_many(:messages, Message, foreign_key: :thread_id)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(thread, attrs) when is_map(attrs) do
    thread
    |> cast(attrs, [:project_slug, :codex_thread_id, :workspace_path, :status, :metadata])
    |> validate_required([:project_slug, :workspace_path, :status])
    |> validate_inclusion(:status, ["active", "closed", "error"])
    |> normalize_project_slug()
    |> unique_constraint(:project_slug, name: :assistant_threads_active_project_slug_index)
  end

  defp normalize_project_slug(changeset) do
    case get_change(changeset, :project_slug) do
      project_slug when is_binary(project_slug) -> put_change(changeset, :project_slug, String.trim(project_slug))
      _ -> changeset
    end
  end
end
