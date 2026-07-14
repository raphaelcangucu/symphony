defmodule SymphonyElixirWeb.WorktreeInventoryPresenter do
  @moduledoc false

  @spec entry_json(map()) :: map()
  def entry_json(entry), do: entry_json(entry, %{})

  @spec entry_json(map(), %{optional(String.t()) => String.t()}) :: map()
  def entry_json(entry, aliases) when is_map(aliases) do
    %{
      path: entry.path,
      display_name: Map.get(aliases, entry.path),
      kind: Atom.to_string(entry.kind),
      issue_identifier: entry.issue_identifier,
      name: entry.name,
      classification: Atom.to_string(entry.classification),
      reclaimable: entry.reclaimable,
      work_present: entry.work_present,
      execution_status: entry.execution_status && Atom.to_string(entry.execution_status),
      removable: entry.removable,
      size_bytes: entry.size_bytes,
      repos: entry.repos,
      child_worktrees: entry.child_worktrees
    }
  end

  @spec totals_json(map()) :: map()
  def totals_json(totals) do
    %{
      count: totals.count,
      size_bytes: totals.size_bytes,
      reclaimable_bytes: totals.reclaimable_bytes
    }
  end
end
