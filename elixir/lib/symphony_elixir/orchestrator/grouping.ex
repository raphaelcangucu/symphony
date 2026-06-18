defmodule SymphonyElixir.Orchestrator.Grouping do
  @moduledoc """
  Pure helpers for grouped issue dispatch. A *lead* (non-empty
  `group_member_identifiers`) runs its whole group as one unit; *members*
  (`group_lead_identifier` set) never dispatch independently.
  """

  alias SymphonyElixir.Issue

  @spec member?(Issue.t()) :: boolean()
  def member?(%Issue{group_lead_identifier: id}) when is_binary(id) and id != "", do: true
  def member?(_), do: false

  @spec lead?(Issue.t()) :: boolean()
  def lead?(%Issue{group_member_identifiers: ids}) when is_list(ids) and ids != [], do: true
  def lead?(_), do: false

  @spec dispatch_candidates([Issue.t()]) :: [Issue.t()]
  def dispatch_candidates(issues) when is_list(issues), do: Enum.reject(issues, &member?/1)

  @spec members_for(Issue.t(), [Issue.t()]) :: [Issue.t()]
  def members_for(%Issue{group_member_identifiers: ids}, issues) when is_list(ids) and is_list(issues) do
    by_identifier = Map.new(issues, &{&1.identifier, &1})

    Enum.flat_map(ids, fn identifier ->
      case Map.get(by_identifier, identifier) do
        %Issue{} = issue -> [issue]
        _ -> []
      end
    end)
  end

  def members_for(_lead, _issues), do: []

  @spec claim_ids(Issue.t(), [Issue.t()]) :: [String.t()]
  def claim_ids(%Issue{id: lead_id}, members) when is_list(members) do
    [lead_id | Enum.map(members, & &1.id)]
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end
end
