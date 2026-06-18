defmodule SymphonyElixir.Issue do
  @moduledoc """
  Normalized issue representation used across all tracker backends.
  """

  defstruct [
    :id,
    :identifier,
    :title,
    :description,
    :priority,
    :state,
    :branch_name,
    :url,
    :assignee_id,
    :agent_goal,
    :project_slug,
    blocked_by: [],
    labels: [],
    comments: [],
    agent_kind: nil,
    assigned_to_worker: true,
    created_at: nil,
    updated_at: nil,
    group_lead_identifier: nil,
    group_member_identifiers: []
  ]

  @type t :: %__MODULE__{
          id: String.t() | nil,
          identifier: String.t() | nil,
          title: String.t() | nil,
          description: String.t() | nil,
          priority: integer() | nil,
          state: String.t() | nil,
          branch_name: String.t() | nil,
          url: String.t() | nil,
          assignee_id: String.t() | nil,
          agent_goal: String.t() | nil,
          project_slug: String.t() | nil,
          labels: [String.t()],
          comments: [map()],
          agent_kind: String.t() | nil,
          assigned_to_worker: boolean(),
          created_at: DateTime.t() | nil,
          updated_at: DateTime.t() | nil,
          group_lead_identifier: String.t() | nil,
          group_member_identifiers: [String.t()]
        }

  @spec label_names(t()) :: [String.t()]
  def label_names(%__MODULE__{labels: labels}) do
    labels
  end
end
