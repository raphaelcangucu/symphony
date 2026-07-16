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
        merge_pending(existing, attrs)

      nil ->
        insert_pending_or_coalesce(attrs, key)
    end
  end

  def enqueue(attrs), do: insert_entry(attrs)

  @spec claim_pending(integer(), pos_integer()) :: [OutboxEntry.t()]
  def claim_pending(project_id, limit \\ 50) when is_integer(limit) and limit > 0 do
    Repo.transaction(fn ->
      ids =
        OutboxEntry
        |> where([e], e.project_id == ^project_id and e.status == "pending")
        |> order_by([e], asc: e.inserted_at, asc: e.id)
        |> limit(^limit)
        |> select([e], e.id)
        |> Repo.all()

      if ids == [] do
        []
      else
        # Mark the whole claimed batch `in_flight` in one statement instead of one
        # UPDATE per entry, then reload them in claim order.
        OutboxEntry
        |> where([e], e.id in ^ids)
        |> Repo.update_all(set: [status: "in_flight", updated_at: DateTime.utc_now()])

        OutboxEntry
        |> where([e], e.id in ^ids)
        |> order_by([e], asc: e.inserted_at, asc: e.id)
        |> Repo.all()
      end
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

    entry
    |> OutboxEntry.changeset(%{status: status, attempts: attempts, last_error: error})
    |> Repo.update()
    |> case do
      {:error, %Ecto.Changeset{} = changeset} when status == "pending" ->
        coalesce_requeue_conflict(entry, changeset)

      result ->
        result
    end
  end

  # Requeueing a failed `in_flight` entry back to `pending` can collide with the
  # partial unique index when a newer write enqueued a `pending` sibling for the
  # same `dedup_key` while this entry was in flight (the index only forbids two
  # *pending* rows per key, so the enqueue was allowed). That sibling already
  # represents — and supersedes — this logical write, so fold this attempt's
  # payload into it (sibling values win, mirroring `enqueue/1` coalescing) and
  # drop the now-redundant row instead of letting the constraint error crash the
  # sync pass. Any non-dedup error still bubbles unchanged.
  defp coalesce_requeue_conflict(%OutboxEntry{} = entry, changeset) do
    with true <- dedup_conflict?(changeset),
         %OutboxEntry{} = pending <- pending_by_dedup(entry.project_id, entry.dedup_key) do
      merged_payload = Map.merge(entry.payload || %{}, pending.payload || %{})

      case pending |> OutboxEntry.changeset(%{payload: merged_payload, status: "pending"}) |> Repo.update() do
        {:ok, kept} ->
          Repo.delete(entry)
          {:ok, kept}

        {:error, _changeset} = error ->
          error
      end
    else
      _ -> {:error, changeset}
    end
  end

  @spec pending_count(integer()) :: non_neg_integer()
  def pending_count(project_id) do
    OutboxEntry
    |> where([e], e.project_id == ^project_id and e.status == "pending")
    |> Repo.aggregate(:count)
  end

  @doc """
  Drops pending/in-flight outbox entries for a locally deleted comment that never
  reached the remote (no `remote_id` yet).
  """
  @spec discard_comment_entries(integer(), integer()) :: :ok
  def discard_comment_entries(project_id, comment_id) when is_integer(project_id) and is_integer(comment_id) do
    OutboxEntry
    |> where(
      [e],
      e.project_id == ^project_id and e.entity_type == "comment" and e.status in ["pending", "in_flight"] and
        fragment("json_extract(?, '$.comment_id') = ?", e.payload, ^comment_id)
    )
    |> Repo.delete_all()

    :ok
  end

  @doc """
  Requeues failed `issue:create` entries for local issues that still need a
  remote issue. This is intentionally narrow: board loads can safely retry
  creates that were blocked by transient credentials/rate-limit failures without
  replaying stale comments or status moves out of order.
  """
  @spec requeue_failed_issue_creates(integer(), [String.t()]) :: non_neg_integer()
  def requeue_failed_issue_creates(project_id, identifiers) when is_integer(project_id) and is_list(identifiers) do
    requeue_issue_creates(project_id, identifiers, ["failed"])
  end

  @doc """
  Requeues failed or stuck `in_flight` `issue:create` entries so an on-demand
  two-way sync can push local-only drafts that never reached the remote.
  """
  @spec requeue_issue_creates(integer(), [String.t()]) :: non_neg_integer()
  def requeue_issue_creates(project_id, identifiers) when is_integer(project_id) and is_list(identifiers) do
    requeue_issue_creates(project_id, identifiers, ["failed", "in_flight"])
  end

  defp requeue_issue_creates(project_id, identifiers, statuses)
       when is_integer(project_id) and is_list(identifiers) and is_list(statuses) do
    dedup_keys =
      identifiers
      |> Enum.filter(&(is_binary(&1) and String.trim(&1) != ""))
      |> Enum.map(&"issue:create:#{project_id}:#{String.trim(&1)}")
      |> Enum.uniq()

    case dedup_keys do
      [] ->
        0

      keys ->
        {count, _rows} =
          OutboxEntry
          |> where(
            [e],
            e.project_id == ^project_id and e.entity_type == "issue" and e.operation == "create" and
              e.status in ^statuses and e.dedup_key in ^keys
          )
          |> Repo.update_all(
            set: [
              status: "pending",
              attempts: 0,
              last_error: nil,
              updated_at: DateTime.utc_now()
            ]
          )

        count
    end
  end

  @doc """
  Requeues the latest failed entry for each dedup key unless that key already has
  a pending entry. This lets a board load recover current dirty writes after a
  credentials outage without replaying every historical failed attempt.
  """
  @spec requeue_latest_failed_by_dedup_keys(integer(), [String.t()]) :: non_neg_integer()
  def requeue_latest_failed_by_dedup_keys(project_id, dedup_keys) when is_integer(project_id) and is_list(dedup_keys) do
    keys =
      dedup_keys
      |> Enum.filter(&(is_binary(&1) and String.trim(&1) != ""))
      |> Enum.map(&String.trim/1)
      |> Enum.uniq()

    case keys do
      [] ->
        0

      keys ->
        pending_keys =
          OutboxEntry
          |> where([e], e.project_id == ^project_id and e.status == "pending" and e.dedup_key in ^keys)
          |> select([e], e.dedup_key)
          |> Repo.all()
          |> MapSet.new()

        failed_ids =
          OutboxEntry
          |> where([e], e.project_id == ^project_id and e.status == "failed" and e.dedup_key in ^keys)
          |> order_by([e], desc: e.updated_at, desc: e.id)
          |> Repo.all()
          |> Enum.reduce({MapSet.new(), []}, fn entry, {seen, ids} ->
            cond do
              MapSet.member?(pending_keys, entry.dedup_key) ->
                {seen, ids}

              MapSet.member?(seen, entry.dedup_key) ->
                {seen, ids}

              true ->
                {MapSet.put(seen, entry.dedup_key), [entry.id | ids]}
            end
          end)
          |> elem(1)

        requeue_failed_entries(failed_ids)
    end
  end

  defp requeue_failed_entries([]), do: 0

  defp requeue_failed_entries(ids) do
    {count, _rows} =
      OutboxEntry
      |> where([e], e.id in ^ids)
      |> Repo.update_all(
        set: [
          status: "pending",
          attempts: 0,
          last_error: nil,
          updated_at: DateTime.utc_now()
        ]
      )

    count
  end

  defp merge_pending(%OutboxEntry{} = existing, attrs) do
    existing
    |> OutboxEntry.changeset(%{
      payload: Map.merge(existing.payload, Map.get(attrs, :payload, %{})),
      status: "pending"
    })
    |> Repo.update()
  end

  # `pending_by_dedup/2` followed by `insert_entry/1` is not atomic. A concurrent
  # `enqueue/1` (e.g. a grouped status move) or a sync-engine requeue
  # (`record_failed` flips an entry `in_flight -> pending`) can create the pending
  # row for this dedup_key between our lookup and insert. The partial unique index
  # then rejects our insert. Recover by coalescing into whatever pending row now
  # exists instead of bubbling an `Ecto.ConstraintError` up as an HTTP 500.
  defp insert_pending_or_coalesce(attrs, key) do
    case insert_entry(attrs) do
      {:error, %Ecto.Changeset{} = changeset} = error ->
        if dedup_conflict?(changeset) do
          case pending_by_dedup(attrs.project_id, key) do
            %OutboxEntry{} = existing -> merge_pending(existing, attrs)
            nil -> error
          end
        else
          error
        end

      result ->
        result
    end
  end

  defp dedup_conflict?(%Ecto.Changeset{errors: errors}), do: Keyword.has_key?(errors, :dedup_key)

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
