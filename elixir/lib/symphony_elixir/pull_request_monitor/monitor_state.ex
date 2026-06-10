defmodule SymphonyElixir.PullRequestMonitor.MonitorState do
  @moduledoc """
  Per issue+PR bookkeeping for the PR follow-up monitor: which head SHA /
  checks fingerprint / review marker was already evaluated, how many automatic
  Rework transitions happened, and what the monitor last did (for the UI).
  """

  use Ecto.Schema

  import Ecto.Changeset
  import Ecto.Query

  alias SymphonyElixir.Repo

  @type t :: %__MODULE__{}

  schema "pull_request_monitor_states" do
    field(:project_slug, :string)
    field(:identifier, :string)
    field(:pr_url, :string)
    field(:last_head_sha, :string)
    field(:last_checks_fingerprint, :string)
    field(:last_review_marker, :string)
    field(:auto_rework_count, :integer, default: 0)
    field(:last_classification, :map, default: %{})
    field(:last_action, :string)
    field(:last_action_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @updatable ~w(last_head_sha last_checks_fingerprint last_review_marker auto_rework_count last_classification last_action last_action_at)a

  @spec get(String.t(), String.t(), String.t()) :: t() | nil
  def get(project_slug, identifier, pr_url) do
    Repo.get_by(__MODULE__,
      project_slug: project_slug,
      identifier: identifier,
      pr_url: pr_url
    )
  end

  @spec upsert(String.t(), String.t(), String.t(), map()) ::
          {:ok, t()} | {:error, Ecto.Changeset.t()}
  def upsert(project_slug, identifier, pr_url, attrs) when is_map(attrs) do
    base =
      get(project_slug, identifier, pr_url) ||
        %__MODULE__{project_slug: project_slug, identifier: identifier, pr_url: pr_url}

    base
    |> cast(attrs, @updatable)
    |> validate_required([:project_slug, :identifier, :pr_url])
    |> validate_number(:auto_rework_count, greater_than_or_equal_to: 0)
    |> unique_constraint([:project_slug, :identifier, :pr_url])
    |> Repo.insert_or_update()
  end

  @spec max_rework_count(String.t(), String.t()) :: non_neg_integer()
  def max_rework_count(project_slug, identifier) do
    from(s in __MODULE__,
      where: s.project_slug == ^project_slug and s.identifier == ^identifier,
      select: max(s.auto_rework_count)
    )
    |> Repo.one()
    |> case do
      count when is_integer(count) -> count
      _ -> 0
    end
  end

  @spec attach([map()], String.t(), String.t()) :: [map()]
  def attach(prs, project_slug, identifier) when is_list(prs) do
    rows =
      from(s in __MODULE__,
        where: s.project_slug == ^project_slug and s.identifier == ^identifier
      )
      |> Repo.all()
      |> Map.new(&{&1.pr_url, &1})

    Enum.map(prs, fn pr ->
      Map.put(pr, :monitor, monitor_payload(Map.get(rows, Map.get(pr, :url) || Map.get(pr, "url"))))
    end)
  end

  defp monitor_payload(nil), do: nil

  defp monitor_payload(%__MODULE__{} = row) do
    %{
      last_action: row.last_action,
      summary: Map.get(row.last_classification || %{}, "summary"),
      auto_rework_count: row.auto_rework_count,
      last_action_at: row.last_action_at
    }
  end
end
