defmodule SymphonyElixir.Tracker.Sync.Normalize do
  @moduledoc """
  Converts a remote `Tracker.IssueDTO` into the normalized map consumed by
  `Tracker.Sync.LocalStore.upsert_remote_issue/2`.
  """

  alias SymphonyElixir.Tracker.IssueDTO

  @spec issue(IssueDTO.t(), keyword()) :: map()
  def issue(%IssueDTO{} = dto, opts) when is_list(opts) do
    %{
      remote_id: dto.id || dto.identifier,
      remote_number: parse_int(dto.identifier),
      identifier: to_string(dto.identifier),
      title: dto.title,
      description: dto.description,
      state: status_name(dto.status),
      priority: dto.priority,
      assignee_id: dto.assignee,
      branch_name: nil,
      remote_url: dto.url,
      creator: dto.creator,
      position: dto.position,
      remote_updated_at: parse_dt(dto.updated_at),
      labels: Enum.map(List.wrap(dto.labels), &label/1),
      comments: opts |> Keyword.get(:comments, []) |> Enum.map(&comment/1)
    }
  end

  defp label(name) when is_binary(name), do: %{name: name}
  defp label(%{} = label), do: Map.take(label, [:name, :color, :remote_id])

  # Remote comment maps arrive in the adapter's read shape (`:id`, `:updated_at`,
  # `:kind`); the local store keys on `:remote_id`/`:remote_updated_at` and relies
  # on `:kind` to surface the agent's `## Codex Workpad` note in the issue summary.
  defp comment(%{} = comment) do
    %{
      remote_id: comment[:remote_id] || comment[:id],
      body: comment[:body],
      author: comment[:author],
      kind: comment[:kind] || "comment",
      remote_updated_at: parse_dt(comment[:remote_updated_at] || comment[:updated_at])
    }
  end

  defp status_name(%{name: name}) when is_binary(name), do: name
  defp status_name(_), do: nil

  defp parse_int(value) when is_integer(value), do: value

  defp parse_int(value) when is_binary(value) do
    case Integer.parse(value) do
      {int, _rest} -> int
      :error -> nil
    end
  end

  defp parse_int(_value), do: nil

  defp parse_dt(%DateTime{} = dt), do: dt

  defp parse_dt(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, dt, _offset} -> dt
      _ -> DateTime.utc_now()
    end
  end

  defp parse_dt(_value), do: DateTime.utc_now()
end
