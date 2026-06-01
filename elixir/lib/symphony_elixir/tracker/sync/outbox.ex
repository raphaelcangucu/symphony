defmodule SymphonyElixir.Tracker.Sync.Outbox do
  @moduledoc """
  Durable queue of local tracker writes awaiting push to the remote source.

  - `enqueue/1` inserts a pending entry, coalescing by `dedup_key`: if a
    pending entry with the same key exists, its payload is merged and reused
    instead of inserting a duplicate.
  - `claim_pending/2` returns the oldest pending entries for a project and marks
    them `in_flight` so a single sync pass owns them.
  - `mark_done/2` / `mark_failed/3` close out an entry.
  - `pending_count/1` powers force-sync decisions and observability.
  """

  import Ecto.Query

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.OutboxEntry

  @spec enqueue(map()) :: {:ok, OutboxEntry.t()} | {:error, Ecto.Changeset.t()}
  def enqueue(%{dedup_key: key} = attrs) when is_binary(key) do
    case pending_by_dedup(attrs.project_id, key) do
      %OutboxEntry{} = existing ->
        existing
        |> OutboxEntry.changeset(%{payload: Map.merge(existing.payload, Map.get(attrs, :payload, %{})), status: "pending"})
        |> Repo.update()

      nil ->
        insert_entry(attrs)
    end
  end

  def enqueue(attrs), do: insert_entry(attrs)

  @spec claim_pending(integer(), pos_integer()) :: [OutboxEntry.t()]
  def claim_pending(project_id, limit \\ 50) when is_integer(limit) and limit > 0 do
    Repo.transaction(fn ->
      entries =
        OutboxEntry
        |> where([e], e.project_id == ^project_id and e.status == "pending")
        |> order_by([e], asc: e.inserted_at, asc: e.id)
        |> limit(^limit)
        |> Repo.all()

      Enum.map(entries, fn entry ->
        {:ok, claimed} = entry |> OutboxEntry.changeset(%{status: "in_flight"}) |> Repo.update()
        claimed
      end)
    end)
    |> case do
      {:ok, claimed} -> claimed
      {:error, _} -> []
    end
  end

  @spec mark_done(OutboxEntry.t(), String.t() | nil) :: {:ok, OutboxEntry.t()} | {:error, Ecto.Changeset.t()}
  def mark_done(%OutboxEntry{} = entry, remote_id \\ nil) do
    entry |> OutboxEntry.changeset(%{status: "done", remote_id: remote_id}) |> Repo.update()
  end

  @spec mark_failed(OutboxEntry.t(), String.t(), pos_integer()) ::
          {:ok, OutboxEntry.t()} | {:error, Ecto.Changeset.t()}
  def mark_failed(%OutboxEntry{} = entry, error, max_attempts) when is_integer(max_attempts) do
    attempts = entry.attempts + 1
    status = if attempts >= max_attempts, do: "failed", else: "pending"
    entry |> OutboxEntry.changeset(%{status: status, attempts: attempts, last_error: error}) |> Repo.update()
  end

  @spec pending_count(integer()) :: non_neg_integer()
  def pending_count(project_id) do
    OutboxEntry
    |> where([e], e.project_id == ^project_id and e.status == "pending")
    |> Repo.aggregate(:count)
  end

  defp pending_by_dedup(project_id, key) do
    OutboxEntry
    |> where([e], e.project_id == ^project_id and e.dedup_key == ^key and e.status == "pending")
    |> limit(1)
    |> Repo.one()
  end

  defp insert_entry(attrs) do
    %OutboxEntry{} |> OutboxEntry.changeset(attrs) |> Repo.insert()
  end
end
