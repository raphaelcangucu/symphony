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
            creator: nil,
            url: nil,
            project_slug: nil,
            created_at: nil,
            updated_at: nil

  @type status :: %{
          name: String.t(),
          category: String.t(),
          position: integer() | nil,
          is_terminal: boolean()
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
          creator: String.t() | nil,
          url: String.t() | nil,
          project_slug: String.t() | nil,
          created_at: String.t() | nil,
          updated_at: String.t() | nil
        }

  @spec build(map()) :: t()
  def build(attrs) when is_map(attrs) do
    struct!(__MODULE__, normalize(attrs))
  end

  defp normalize(attrs) do
    attrs
    |> Map.new(fn {k, v} -> {to_atom(k), v} end)
    |> Map.put_new(:labels, [])
    |> Map.put_new(:blocked_by, [])
  end

  defp to_atom(key) when is_atom(key), do: key
  defp to_atom(key) when is_binary(key), do: String.to_existing_atom(key)
end
