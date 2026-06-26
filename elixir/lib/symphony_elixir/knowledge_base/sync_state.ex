defmodule SymphonyElixir.KnowledgeBase.SyncState do
  @moduledoc "Per-repository knowledge base sync state (status, PR, last error)."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.Repo

  @type t :: %__MODULE__{}

  @statuses ~w(idle syncing synced open_pr merged conflict checks_failed error)

  schema "kb_sync_states" do
    field(:project_slug, :string)
    field(:repo_slug, :string)
    field(:status, :string, default: "idle")
    field(:pr_number, :integer)
    field(:pr_url, :string)
    field(:last_error, :string)
    field(:last_synced_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @spec statuses() :: [String.t()]
  def statuses, do: @statuses

  @spec get(String.t(), String.t()) :: t()
  def get(project_slug, repo_slug) do
    Repo.get_by(__MODULE__, project_slug: project_slug, repo_slug: repo_slug) ||
      %__MODULE__{project_slug: project_slug, repo_slug: repo_slug, status: "idle"}
  end

  @spec put(String.t(), String.t(), map()) :: {:ok, t()} | {:error, Ecto.Changeset.t()}
  def put(project_slug, repo_slug, attrs) do
    base = get(project_slug, repo_slug)

    base
    |> changeset(Map.merge(%{project_slug: project_slug, repo_slug: repo_slug}, attrs))
    |> Repo.insert_or_update()
  end

  defp changeset(record, attrs) do
    record
    |> cast(attrs, [
      :project_slug,
      :repo_slug,
      :status,
      :pr_number,
      :pr_url,
      :last_error,
      :last_synced_at
    ])
    |> validate_required([:project_slug, :repo_slug, :status])
    |> validate_inclusion(:status, @statuses)
    |> unique_constraint([:project_slug, :repo_slug])
  end
end
