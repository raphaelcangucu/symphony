defmodule SymphonyElixir.Tracker.Sync.GroupStatus do
  @moduledoc """
  Helpers for keeping grouped issue statuses aligned across local moves and
  remote sync. Grouping is local-only; Jira columns are independent per issue.
  """

  alias SymphonyElixir.LocalTracker.IssueRecord
  alias SymphonyElixir.Tracker.IssueDTO

  @doc """
  Issue identifiers that should receive a remote status transition when the
  group moves locally (lead plus every member).
  """
  @spec push_identifiers(IssueRecord.t() | IssueDTO.t()) :: [String.t()]
  def push_identifiers(%IssueRecord{identifier: lead, group_members: members}) when is_list(members) do
    [lead | Enum.map(members, & &1.identifier)]
  end

  def push_identifiers(%IssueRecord{identifier: id}), do: [id]

  def push_identifiers(%IssueDTO{identifier: lead, group_member_identifiers: members})
      when is_list(members) do
    [lead | members]
  end

  def push_identifiers(%IssueDTO{identifier: id}), do: [id]
end
