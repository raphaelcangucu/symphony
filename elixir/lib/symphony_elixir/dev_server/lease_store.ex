defmodule SymphonyElixir.DevServer.LeaseStore do
  @moduledoc """
  DB-backed leasing of preview port bands (per project) and slots (per issue).

  Band leases are permanent once assigned; slot leases are released on stop and
  reclaimed by the reconciler GC. Lowest-free assignment is used for both. The
  caller (`DevServer.Manager`) serializes acquisition under a global lock; the
  unique constraints + a single recompute-and-retry guard against the rare race.
  """

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.{PreviewBand, PreviewIssueSlot}
  alias SymphonyElixir.Repo

  @spec ensure_band(integer(), non_neg_integer()) ::
          {:ok, non_neg_integer()} | {:error, :no_free_band}
  def ensure_band(project_id, max_bands) when is_integer(project_id) and is_integer(max_bands) do
    case existing_band(project_id) do
      index when is_integer(index) -> {:ok, index}
      nil -> assign_band(project_id, max_bands)
    end
  end

  @spec ensure_slot(integer(), String.t(), non_neg_integer()) ::
          {:ok, non_neg_integer()} | {:error, :no_free_slot}
  def ensure_slot(project_id, identifier, slots)
      when is_integer(project_id) and is_binary(identifier) and is_integer(slots) do
    case existing_slot(project_id, identifier) do
      index when is_integer(index) -> {:ok, index}
      nil -> assign_slot(project_id, identifier, slots)
    end
  end

  @spec release_slot(integer(), String.t()) :: :ok
  def release_slot(project_id, identifier)
      when is_integer(project_id) and is_binary(identifier) do
    Repo.delete_all(
      from(s in PreviewIssueSlot,
        where: s.project_id == ^project_id and s.issue_identifier == ^identifier
      )
    )

    :ok
  end

  @spec slot_for_issue(integer(), String.t()) :: {:ok, non_neg_integer()} | :error
  def slot_for_issue(project_id, identifier)
      when is_integer(project_id) and is_binary(identifier) do
    case existing_slot(project_id, identifier) do
      index when is_integer(index) -> {:ok, index}
      nil -> :error
    end
  end

  @spec leased_issue_slots() :: [{integer(), String.t(), DateTime.t()}]
  def leased_issue_slots do
    Repo.all(from(s in PreviewIssueSlot, select: {s.project_id, s.issue_identifier, s.inserted_at}))
  end

  defp existing_band(project_id) do
    Repo.one(from(b in PreviewBand, where: b.project_id == ^project_id, select: b.band_index))
  end

  defp existing_slot(project_id, identifier) do
    Repo.one(
      from(s in PreviewIssueSlot,
        where: s.project_id == ^project_id and s.issue_identifier == ^identifier,
        select: s.slot_index
      )
    )
  end

  defp assign_band(_project_id, max_bands) when max_bands <= 0, do: {:error, :no_free_band}

  defp assign_band(project_id, max_bands) do
    used = MapSet.new(Repo.all(from(b in PreviewBand, select: b.band_index)))

    case Enum.find(0..(max_bands - 1)//1, &(not MapSet.member?(used, &1))) do
      nil ->
        {:error, :no_free_band}

      index ->
        case Repo.insert(PreviewBand.changeset(%PreviewBand{}, %{project_id: project_id, band_index: index})) do
          {:ok, _record} -> {:ok, index}
          {:error, _changeset} -> ensure_band(project_id, max_bands)
        end
    end
  end

  defp assign_slot(_project_id, _identifier, slots) when slots <= 0, do: {:error, :no_free_slot}

  defp assign_slot(project_id, identifier, slots) do
    used =
      MapSet.new(Repo.all(from(s in PreviewIssueSlot, where: s.project_id == ^project_id, select: s.slot_index)))

    case Enum.find(0..(slots - 1)//1, &(not MapSet.member?(used, &1))) do
      nil ->
        {:error, :no_free_slot}

      index ->
        attrs = %{project_id: project_id, issue_identifier: identifier, slot_index: index}

        case Repo.insert(PreviewIssueSlot.changeset(%PreviewIssueSlot{}, attrs)) do
          {:ok, _record} -> {:ok, index}
          {:error, _changeset} -> ensure_slot(project_id, identifier, slots)
        end
    end
  end
end
