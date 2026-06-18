defmodule SymphonyElixir.Tracker.IssueDTO do
  @moduledoc """
  Normalized issue representation returned by every `Tracker.IssueAdapter`.

  Shapes the JSON API payload so the controller + presenter are tracker-agnostic.
  """

  @enforce_keys [:identifier, :title]
  defstruct id: nil,
            identifier: nil,
            title: nil,
            description: nil,
            priority: nil,
            position: nil,
            status: nil,
            labels: [],
            blocked_by: [],
            assignee: nil,
            assignee_remote_id: nil,
            creator: nil,
            agent_goal: nil,
            url: nil,
            project_slug: nil,
            attachments: [],
            created_at: nil,
            updated_at: nil,
            group_lead_identifier: nil,
            group_member_identifiers: []

  @type status :: %{
          name: String.t(),
          category: String.t(),
          position: integer() | nil,
          is_terminal: boolean()
        }

  @type attachment :: %{
          id: String.t(),
          filename: String.t() | nil,
          mime_type: String.t() | nil,
          size: integer() | nil,
          created: String.t() | nil,
          author: String.t() | nil,
          is_image: boolean()
        }

  @type t :: %__MODULE__{
          id: String.t() | nil,
          identifier: String.t(),
          title: String.t(),
          description: String.t() | nil,
          priority: integer() | nil,
          position: integer() | nil,
          status: status() | nil,
          labels: [String.t()],
          blocked_by: [map()],
          assignee: String.t() | nil,
          assignee_remote_id: String.t() | nil,
          creator: String.t() | nil,
          agent_goal: String.t() | nil,
          url: String.t() | nil,
          project_slug: String.t() | nil,
          attachments: [attachment()],
          created_at: String.t() | nil,
          updated_at: String.t() | nil,
          group_lead_identifier: String.t() | nil,
          group_member_identifiers: [String.t()]
        }

  @spec build(map()) :: t()
  def build(attrs) when is_map(attrs) do
    struct!(__MODULE__, normalize(attrs))
  end

  defp normalize(attrs) do
    attrs
    |> Map.new(fn {k, v} -> {to_atom(k), v} end)
    |> normalize_identifier()
    |> Map.put_new(:labels, [])
    |> Map.put_new(:blocked_by, [])
    |> Map.put_new(:attachments, [])
    |> Map.put_new(:group_member_identifiers, [])
  end

  defp normalize_identifier(%{identifier: identifier} = attrs) when is_binary(identifier) do
    Map.put(attrs, :identifier, strip_leading_hash(identifier))
  end

  defp normalize_identifier(attrs), do: attrs

  defp strip_leading_hash(identifier) do
    identifier
    |> String.trim()
    |> case do
      "#" <> rest -> String.trim(rest)
      trimmed -> trimmed
    end
  end

  defp to_atom(key) when is_atom(key), do: key
  defp to_atom(key) when is_binary(key), do: String.to_existing_atom(key)
end
