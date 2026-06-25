defmodule SymphonyElixir.LocalTracker.IssueMapper do
  @moduledoc """
  Maps local tracker records into the tracker-agnostic issue struct.
  """

  alias Ecto.Association.NotLoaded
  alias SymphonyElixir.{AgentRouting, Issue}
  alias SymphonyElixir.LocalTracker.{Comment, IssueRecord, IssueRelation, Label, Project, WorkflowStatus}

  @spec to_issue(IssueRecord.t()) :: Issue.t()
  def to_issue(%IssueRecord{} = record) do
    label_names = label_names(record)

    agent_kind = AgentRouting.label_agent_kind(label_names)

    %Issue{
      id: to_string(record.id),
      identifier: record.identifier,
      project_slug: project_slug(record),
      title: record.title,
      description: record.description,
      priority: record.priority,
      state: status_name(record.status),
      branch_name: record.branch_name,
      url: record.url,
      assignee_id: record.assignee_id,
      agent_goal: record.agent_goal,
      agent_session_id: record.agent_session_id,
      labels: visible_labels(label_names),
      comments: comments(record.comments),
      blocked_by: blockers(record.source_relations),
      agent_kind: agent_kind,
      assigned_to_worker: AgentRouting.routable?(label_names),
      created_at: record.inserted_at,
      updated_at: record.updated_at,
      group_lead_identifier: group_lead_identifier(record.group_lead),
      group_member_identifiers: group_member_identifiers(record.group_members),
      parent_identifier: subtask_parent_identifier(record.source_relations)
    }
  end

  @spec to_issues([IssueRecord.t()]) :: [Issue.t()]
  def to_issues(records) when is_list(records), do: Enum.map(records, &to_issue/1)

  defp label_names(labels_or_record)

  defp label_names(%IssueRecord{labels: labels}), do: label_names(labels)

  defp label_names(labels) when is_list(labels) do
    labels
    |> Enum.map(fn
      %Label{name: name} when is_binary(name) -> String.downcase(String.trim(name))
      _label -> nil
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp label_names(%NotLoaded{}), do: []
  defp label_names(_labels), do: []

  defp visible_labels(label_names) do
    label_names
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp comments(comments) when is_list(comments) do
    Enum.map(comments, fn
      %Comment{} = comment ->
        %{
          author: comment.author,
          body: comment.body,
          created_at: comment.inserted_at,
          kind: comment.kind,
          source: "local"
        }

      _comment ->
        nil
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp comments(%NotLoaded{}), do: []
  defp comments(_comments), do: []

  defp blockers(relations) when is_list(relations) do
    relations
    |> Enum.flat_map(fn
      %IssueRelation{type: "blocked_by", target_issue: %IssueRecord{} = blocker} ->
        [%{id: to_string(blocker.id), identifier: blocker.identifier, state: status_name(blocker.status)}]

      _relation ->
        []
    end)
  end

  defp blockers(%NotLoaded{}), do: []
  defp blockers(_relations), do: []

  defp subtask_parent_identifier(relations) when is_list(relations) do
    subtask_type = IssueRelation.subtask_type()

    Enum.find_value(relations, fn
      %IssueRelation{type: ^subtask_type, target_issue: %IssueRecord{identifier: identifier}} -> identifier
      _relation -> nil
    end)
  end

  defp subtask_parent_identifier(_relations), do: nil

  defp status_name(%WorkflowStatus{name: name}), do: name
  defp status_name(%NotLoaded{}), do: nil
  defp status_name(_status), do: nil

  defp project_slug(%IssueRecord{project: %Project{slug: slug}}), do: slug
  defp project_slug(_record), do: nil

  defp group_lead_identifier(%IssueRecord{identifier: identifier}) when is_binary(identifier), do: identifier
  defp group_lead_identifier(_), do: nil

  defp group_member_identifiers(members) when is_list(members) do
    Enum.flat_map(members, fn
      %IssueRecord{identifier: identifier} when is_binary(identifier) -> [identifier]
      _ -> []
    end)
  end

  defp group_member_identifiers(_), do: []
end
