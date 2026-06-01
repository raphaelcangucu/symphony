defmodule SymphonyElixir.Tracker.Sync.Merge do
  @moduledoc """
  Field-level last-writer-wins conflict resolution for tracker sync.

  Given a local record's current values, its `dirty_fields` map
  (`field_string => ISO8601 changed_at`), the freshly-pulled remote values,
  and the remote's `updated_at`, returns the attrs to apply locally, the
  remaining dirty fields, and whether any real conflict was resolved in favor
  of the remote.

  Rules per field:

  - Not dirty locally -> take the remote value.
  - Dirty locally and local change is newer-or-equal to remote -> keep local
    (do not include the field in `attrs`; keep it dirty for the next push).
  - Dirty locally but remote changed later -> remote wins; drop the dirty field
    and flag a conflict.
  """

  @type merge_result :: %{attrs: map(), dirty_fields: map(), conflict?: boolean()}

  @spec merge_fields(map(), map(), map(), DateTime.t(), [atom()]) :: merge_result()
  def merge_fields(_local, dirty_fields, remote, %DateTime{} = remote_updated_at, syncable_fields)
      when is_map(dirty_fields) and is_map(remote) and is_list(syncable_fields) do
    Enum.reduce(syncable_fields, %{attrs: %{}, dirty_fields: dirty_fields, conflict?: false}, fn field, acc ->
      reduce_field(field, remote, remote_updated_at, acc)
    end)
  end

  defp reduce_field(field, remote, remote_updated_at, acc) do
    if Map.has_key?(remote, field) do
      apply_field(field, Map.fetch!(remote, field), remote_updated_at, acc)
    else
      acc
    end
  end

  defp apply_field(field, remote_value, remote_updated_at, acc) do
    case Map.fetch(acc.dirty_fields, Atom.to_string(field)) do
      {:ok, changed_at_iso} ->
        resolve_dirty(field, remote_value, remote_updated_at, changed_at_iso, acc)

      :error ->
        %{acc | attrs: Map.put(acc.attrs, field, remote_value)}
    end
  end

  defp resolve_dirty(field, remote_value, remote_updated_at, changed_at_iso, acc) do
    case parse_iso(changed_at_iso) do
      %DateTime{} = local_changed_at ->
        if DateTime.compare(local_changed_at, remote_updated_at) in [:gt, :eq] do
          acc
        else
          %{
            acc
            | attrs: Map.put(acc.attrs, field, remote_value),
              dirty_fields: Map.delete(acc.dirty_fields, Atom.to_string(field)),
              conflict?: true
          }
        end

      _ ->
        %{
          acc
          | attrs: Map.put(acc.attrs, field, remote_value),
            dirty_fields: Map.delete(acc.dirty_fields, Atom.to_string(field))
        }
    end
  end

  defp parse_iso(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, dt, _offset} -> dt
      _ -> nil
    end
  end

  defp parse_iso(_value), do: nil
end
