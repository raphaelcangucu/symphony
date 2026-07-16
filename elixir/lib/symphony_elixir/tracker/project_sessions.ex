defmodule SymphonyElixir.Tracker.ProjectSessions do
  @moduledoc """
  Produces lightweight, cursor-paginated session rows for a tracker project.
  """

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.LocalTracker.Context

  @default_limit 20
  @max_limit 50
  # Include legacy `project` scope so older project chats still appear in the
  # flat Project → Session sidebar (they still show on the Workspaces page via recents).
  @thread_scopes ~w(project project_session project_explore issue issue_session workspace_session)

  @type row :: %{
          id: String.t(),
          title: String.t() | nil,
          kind: String.t(),
          href: String.t(),
          updated_at: String.t(),
          aggregate_status: String.t() | nil,
          agent_kind: String.t() | nil,
          issue_identifier: String.t() | nil,
          workspace_path: String.t() | nil,
          workspace_id: String.t() | nil,
          pinned: boolean(),
          archived: boolean()
        }

  @spec list(String.t(), keyword()) :: {:ok, %{data: [row()], meta: map()}} | {:error, term()}
  def list(project_slug, opts \\ [])

  def list(project_slug, opts) when is_binary(project_slug) and is_list(opts) do
    with {:ok, normalized_slug} <- normalize_project_slug(project_slug),
         {:ok, _project} <- Context.get_project(normalized_slug),
         {:ok, limit} <- normalize_limit(Keyword.get(opts, :limit, @default_limit)),
         {:ok, cursor} <- decode_cursor(Keyword.get(opts, :cursor)),
         {:ok, include_archived?} <- normalize_boolean(Keyword.get(opts, :include_archived, false), :include_archived) do
      fetch_limit = fetch_window(limit)

      rows =
        normalized_slug
        |> session_rows(include_archived?, fetch_limit)
        |> dedupe_by_id()
        |> sort_rows()

      project_activity_at = rows |> List.first() |> row_updated_at()
      page = rows |> apply_cursor(cursor) |> Enum.take(limit)

      {:ok,
       %{
         data: Enum.map(page, &public_row/1),
         meta: %{
           next_cursor: next_cursor(rows, page, cursor, limit),
           project_activity_at: project_activity_at
         }
       }}
    end
  end

  def list(_project_slug, _opts), do: {:error, :invalid_arguments}

  defp fetch_window(limit), do: min(limit * 3, @max_limit * 3)

  defp session_rows(project_slug, include_archived?, fetch_limit) do
    # Sidebar sessions are assistant/chat threads only. Board issues are not
    # sessions — including them flooded Advising with Jira tickets and broke
    # click-to-open (wrong destinations).
    thread_rows(project_slug, include_archived?, fetch_limit)
  end

  defp thread_rows(project_slug, include_archived?, fetch_limit) do
    History.list_threads(
      project_slug: project_slug,
      scopes: @thread_scopes,
      include_archived: include_archived?,
      limit: fetch_limit
    )
    |> Enum.map(&thread_row/1)
  end

  defp thread_row(thread) do
    metadata = thread.metadata || %{}

    %{
      id: "thread:#{thread.id}",
      title: thread.title,
      kind: thread_kind(thread.scope),
      href: "/projects/#{thread.project_slug}/workspaces/#{thread.id}",
      updated_at: format_datetime(thread.updated_at),
      aggregate_status: thread.status,
      agent_kind: thread.agent_kind,
      issue_identifier: thread.issue_identifier,
      workspace_path: thread.workspace_path,
      workspace_id: metadata_value(metadata, "workspace_id"),
      pinned: metadata_boolean(metadata, "pinned"),
      archived: thread.status == "archived",
      _cursor_updated_at: thread.updated_at
    }
  end

  defp thread_kind("project"), do: "chat"
  defp thread_kind("project_session"), do: "workspace_session"
  defp thread_kind("project_explore"), do: "chat"
  defp thread_kind("issue"), do: "authoring"
  defp thread_kind("issue_session"), do: "execution"
  defp thread_kind("workspace_session"), do: "workspace_session"
  defp thread_kind(scope), do: scope

  defp dedupe_by_id(rows) do
    {_, deduplicated_rows} =
      Enum.reduce(rows, {MapSet.new(), []}, fn row, {ids, acc} ->
        if MapSet.member?(ids, row.id) do
          {ids, acc}
        else
          {MapSet.put(ids, row.id), [row | acc]}
        end
      end)

    Enum.reverse(deduplicated_rows)
  end

  defp sort_rows(rows) do
    Enum.sort(rows, fn left, right ->
      case DateTime.compare(left._cursor_updated_at, right._cursor_updated_at) do
        :gt -> true
        :lt -> false
        :eq -> left.id >= right.id
      end
    end)
  end

  defp apply_cursor(rows, nil), do: rows

  defp apply_cursor(rows, %{updated_at: cursor_updated_at, id: cursor_id}) do
    Enum.filter(rows, fn row ->
      case DateTime.compare(row._cursor_updated_at, cursor_updated_at) do
        :lt -> true
        :eq -> row.id < cursor_id
        :gt -> false
      end
    end)
  end

  defp next_cursor(_rows, [], _cursor, _limit), do: nil

  defp next_cursor(rows, page, cursor, limit) do
    remaining_rows = apply_cursor(rows, cursor)

    if length(remaining_rows) > limit do
      page |> List.last() |> encode_cursor()
    else
      nil
    end
  end

  defp encode_cursor(row) do
    %{updated_at: format_datetime(row._cursor_updated_at), id: row.id}
    |> Jason.encode!()
    |> Base.url_encode64(padding: false)
  end

  defp decode_cursor(nil), do: {:ok, nil}
  defp decode_cursor(""), do: {:ok, nil}

  defp decode_cursor(cursor) when is_binary(cursor) do
    with {:ok, encoded} <- Base.url_decode64(cursor, padding: false),
         {:ok, %{"updated_at" => updated_at, "id" => id}} <- Jason.decode(encoded),
         {:ok, parsed_updated_at, _offset} <- DateTime.from_iso8601(updated_at),
         true <- is_binary(id) and id != "" do
      {:ok, %{updated_at: parsed_updated_at, id: id}}
    else
      _ -> {:error, :invalid_cursor}
    end
  end

  defp decode_cursor(_cursor), do: {:error, :invalid_cursor}

  defp public_row(row), do: Map.drop(row, [:_cursor_updated_at])

  defp row_updated_at(nil), do: nil
  defp row_updated_at(row), do: row.updated_at

  defp normalize_project_slug(project_slug) do
    case String.trim(project_slug) do
      "" -> {:error, :invalid_project_slug}
      normalized_slug -> {:ok, normalized_slug}
    end
  end

  defp normalize_limit(limit) when is_integer(limit) and limit > 0, do: {:ok, min(limit, @max_limit)}
  defp normalize_limit(_limit), do: {:error, :invalid_limit}

  defp normalize_boolean(value, _name) when is_boolean(value), do: {:ok, value}
  defp normalize_boolean(_value, name), do: {:error, {:invalid_option, name}}

  defp metadata_value(metadata, "workspace_id"), do: Map.get(metadata, "workspace_id") || Map.get(metadata, :workspace_id)
  defp metadata_value(metadata, "pinned"), do: Map.get(metadata, "pinned") || Map.get(metadata, :pinned)

  defp metadata_boolean(metadata, key), do: metadata_value(metadata, key) == true

  defp format_datetime(%DateTime{} = datetime), do: DateTime.to_iso8601(datetime)
end
