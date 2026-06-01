defmodule SymphonyElixir.Assistant.History do
  @moduledoc "Persistence boundary for project assistant threads and messages."

  import Ecto.Query

  alias SymphonyElixir.Assistant.{Message, Thread}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @type attrs :: map()

  @spec ensure_thread(String.t(), attrs()) :: {:ok, Thread.t()} | {:error, term()}
  def ensure_thread(project_slug, attrs \\ %{}) when is_binary(project_slug) and is_map(attrs) do
    with {:ok, normalized_slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, _project} <- Context.get_project(normalized_slug) do
      case active_thread(normalized_slug) do
        %Thread{} = thread -> {:ok, thread}
        nil -> create_thread(normalized_slug, attrs)
      end
    end
  end

  @spec ensure_issue_thread(String.t(), String.t(), attrs()) :: {:ok, Thread.t()} | {:error, term()}
  def ensure_issue_thread(project_slug, issue_identifier, attrs \\ %{})
      when is_binary(project_slug) and is_binary(issue_identifier) and is_map(attrs) do
    with {:ok, slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, identifier} <- normalize_required_string(issue_identifier, :issue_identifier),
         {:ok, _project} <- Context.get_project(slug) do
      case active_issue_thread(slug, identifier) do
        %Thread{} = thread -> {:ok, thread}
        nil -> create_issue_thread(slug, identifier, attrs)
      end
    end
  end

  @doc """
  Returns the workspace path recorded on the active issue thread for `issue_identifier`.

  This is the durable source of truth for an issue's authoring working tree: both the
  document viewer (read) and the authoring turn (write) resolve to this path so they keep
  agreeing even if the workspace-path computation later changes. Returns nil when there is
  no active issue thread or when the persistence layer is unavailable.
  """
  @spec issue_workspace_path(String.t()) :: String.t() | nil
  def issue_workspace_path(issue_identifier) when is_binary(issue_identifier) do
    case String.trim(issue_identifier) do
      "" ->
        nil

      identifier ->
        Thread
        |> Repo.get_by(issue_identifier: identifier, scope: "issue", status: "active")
        |> case do
          %Thread{workspace_path: path} when is_binary(path) and path != "" -> path
          _ -> nil
        end
    end
  rescue
    _error -> nil
  catch
    :exit, _reason -> nil
  end

  @doc """
  Promotes the active project-scoped thread into the issue-scoped thread for `issue_identifier`.

  The `/assistant/new-issue` chat lives in the project's active thread until a draft issue is
  created. At that point the same thread must become the issue's authoring thread (spec D1) so it
  is reachable at `/projects/:slug/assistant/issue/:id` and never lingers as an orphan project
  chat in the recents sidebar. Behaviour:

    * no active issue thread yet → upgrade the active project thread in place;
    * an active issue thread already exists → fold the project chat into it and close the orphan;
    * no active project thread → return/create the issue thread.
  """
  @spec promote_project_thread_to_issue(String.t(), String.t(), attrs()) ::
          {:ok, Thread.t()} | {:error, term()}
  def promote_project_thread_to_issue(project_slug, issue_identifier, attrs \\ %{})
      when is_binary(project_slug) and is_binary(issue_identifier) and is_map(attrs) do
    with {:ok, slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, identifier} <- normalize_required_string(issue_identifier, :issue_identifier),
         {:ok, _project} <- Context.get_project(slug) do
      promote_active_project_thread(slug, identifier, attrs)
    end
  end

  @doc """
  Repairs legacy orphan project threads that already produced a draft issue.

  Earlier builds copied the chat into a new issue thread but left the project thread active, so it
  surfaced in recents pointing to the project assistant instead of the issue assistant. This scans
  active project threads, and for any whose history contains a successful `create_draft_issue`,
  promotes it via `promote_project_thread_to_issue/3`. Idempotent and safe to run repeatedly.
  """
  @spec repair_lingering_issue_drafts() :: :ok
  def repair_lingering_issue_drafts do
    Thread
    |> where([t], t.scope == "project" and t.status == "active")
    |> Repo.all()
    |> Enum.each(fn %Thread{project_slug: slug} = thread ->
      case draft_identifier_from_thread(thread.id) do
        nil ->
          :ok

        identifier ->
          promote_project_thread_to_issue(slug, identifier, %{workspace_path: thread.workspace_path})
      end
    end)

    :ok
  end

  @spec set_mode(Thread.t(), String.t()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def set_mode(%Thread{metadata: metadata} = thread, mode) when is_binary(mode) do
    next = Map.put(metadata || %{}, "mode", mode)
    update_thread(thread, %{metadata: next})
  end

  @spec update_thread(Thread.t(), attrs()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def update_thread(%Thread{} = thread, attrs) when is_map(attrs) do
    thread
    |> Thread.changeset(attrs)
    |> Repo.update()
  end

  @spec list_messages(String.t()) :: {:ok, [Message.t()]} | {:error, term()}
  def list_messages(project_slug) when is_binary(project_slug) do
    with {:ok, normalized_slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, _project} <- Context.get_project(normalized_slug) do
      messages =
        case active_thread(normalized_slug) do
          %Thread{id: thread_id} -> messages_for_thread(thread_id)
          nil -> []
        end

      {:ok, messages}
    end
  end

  @spec append_message(Thread.t(), attrs()) :: {:ok, Message.t()} | {:error, Ecto.Changeset.t()}
  def append_message(%Thread{id: thread_id} = thread, attrs) when is_integer(thread_id) and is_map(attrs) do
    append_message_with_retry(thread, attrs, 3)
  end

  @spec copy_messages_to_empty_thread(Thread.t(), [Message.t() | map()]) :: {:ok, Thread.t()} | {:error, term()}
  def copy_messages_to_empty_thread(%Thread{id: thread_id} = target_thread, messages)
      when is_integer(thread_id) and is_list(messages) do
    case list_messages_for_thread(thread_id) do
      [] -> copy_messages(target_thread, messages)
      _existing_messages -> {:ok, target_thread}
    end
  end

  @spec create_freeform_thread(attrs()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def create_freeform_thread(attrs) when is_map(attrs) do
    attrs
    |> Map.put(:scope, "freeform")
    |> Map.delete(:project_slug)
    |> Map.put_new(:status, "active")
    |> then(&Thread.changeset(%Thread{}, &1))
    |> Repo.insert()
  end

  @spec get_thread(integer()) :: {:ok, Thread.t()} | {:error, :not_found}
  def get_thread(id) when is_integer(id) do
    case Repo.get(Thread, id) do
      %Thread{} = thread -> {:ok, thread}
      nil -> {:error, :not_found}
    end
  end

  @spec list_threads(keyword()) :: [Thread.t()]
  def list_threads(opts \\ []) when is_list(opts) do
    Thread
    |> filter_scope(Keyword.get(opts, :scope))
    |> filter_project(Keyword.get(opts, :project_slug))
    |> order_by([t], desc: t.updated_at, desc: t.id)
    |> limit(^Keyword.get(opts, :limit, 50))
    |> Repo.all()
  end

  @spec latest_message(integer()) :: map() | nil
  def latest_message(thread_id) when is_integer(thread_id) do
    Message
    |> where([m], m.thread_id == ^thread_id)
    |> order_by([m], desc: m.sequence)
    |> limit(1)
    |> Repo.one()
    |> case do
      nil -> nil
      %Message{} = message -> message_payload(message)
    end
  end

  @spec list_messages_for_thread(integer()) :: [Message.t()]
  def list_messages_for_thread(thread_id) when is_integer(thread_id) do
    Message
    |> where([m], m.thread_id == ^thread_id)
    |> order_by([m], asc: m.sequence)
    |> Repo.all()
  end

  @spec message_payload(Message.t()) :: map()
  def message_payload(%Message{} = message) do
    %{
      id: message.id,
      role: message.role,
      content: message.content,
      sequence: message.sequence,
      turn_id: message.turn_id,
      tool_calls: tool_calls(message),
      metadata: message.metadata || %{},
      inserted_at: message.inserted_at
    }
  end

  defp active_thread(project_slug) do
    Repo.get_by(Thread, project_slug: project_slug, scope: "project", status: "active")
  end

  defp active_issue_thread(slug, identifier) do
    Repo.get_by(Thread,
      project_slug: slug,
      issue_identifier: identifier,
      scope: "issue",
      status: "active"
    )
  end

  defp create_issue_thread(slug, identifier, attrs) do
    attrs
    |> Map.put(:scope, "issue")
    |> Map.put(:project_slug, slug)
    |> Map.put(:issue_identifier, identifier)
    |> Map.put_new(:status, "active")
    |> then(&Thread.changeset(%Thread{}, &1))
    |> Repo.insert()
  end

  defp promote_active_project_thread(slug, identifier, attrs) do
    case {active_issue_thread(slug, identifier), active_thread(slug)} do
      {%Thread{} = issue_thread, %Thread{} = project_thread} ->
        fold_project_thread_into_issue(issue_thread, project_thread)

      {%Thread{} = issue_thread, nil} ->
        {:ok, issue_thread}

      {nil, %Thread{} = project_thread} ->
        upgrade_thread_to_issue(project_thread, identifier, attrs)

      {nil, nil} ->
        create_issue_thread(slug, identifier, attrs)
    end
  end

  defp fold_project_thread_into_issue(%Thread{} = issue_thread, %Thread{} = project_thread) do
    project_messages = list_messages_for_thread(project_thread.id)

    with {:ok, _filled} <- copy_messages_to_empty_thread(issue_thread, project_messages),
         {:ok, _closed} <- close_thread(project_thread) do
      {:ok, issue_thread}
    end
  end

  defp upgrade_thread_to_issue(%Thread{} = project_thread, identifier, attrs) do
    workspace_path = Map.get(attrs, :workspace_path) || project_thread.workspace_path

    project_thread
    |> Thread.changeset(%{
      scope: "issue",
      issue_identifier: identifier,
      workspace_path: workspace_path
    })
    |> Repo.update()
  end

  defp close_thread(%Thread{} = thread) do
    thread
    |> Thread.changeset(%{status: "closed"})
    |> Repo.update()
  end

  defp draft_identifier_from_thread(thread_id) when is_integer(thread_id) do
    Message
    |> where([m], m.thread_id == ^thread_id)
    |> order_by([m], desc: m.sequence)
    |> Repo.all()
    |> Enum.find_value(&draft_identifier_from_message/1)
  end

  defp draft_identifier_from_message(%Message{} = message) do
    message
    |> tool_calls()
    |> Enum.find_value(fn call ->
      if draft_tool_call?(call) and tool_call_succeeded?(call) do
        draft_identifier_from_call(call)
      end
    end)
  end

  @issue_authoring_tools ~w(create_draft_issue create_issue)

  defp draft_tool_call?(call) when is_map(call) do
    nested_tool = call |> field_any("result") |> field_any("tool")

    field_any(call, "name") in @issue_authoring_tools or
      field_any(call, "tool") in @issue_authoring_tools or
      nested_tool in @issue_authoring_tools
  end

  defp draft_tool_call?(_call), do: false

  defp tool_call_succeeded?(call) when is_map(call) do
    field_any(call, "status") in [nil, "complete", "completed", "ok"]
  end

  defp tool_call_succeeded?(_call), do: false

  defp draft_identifier_from_call(call), do: identifier_from(call)

  # Walks the assorted shapes Codex app-server / runner emit for a tool result:
  # `data.identifier`, `result.toolResult.data.identifier`, or a JSON blob inside
  # `contentItems[].text`.
  defp identifier_from(value) when is_map(value) do
    direct =
      field_any(value, "identifier") || field_any(value, "issue_identifier") ||
        field_any(value, "issueIdentifier")

    case normalize_identifier(direct) do
      {:ok, identifier} ->
        identifier

      :error ->
        identifier_from(field_any(value, "data")) ||
          identifier_from(field_any(value, "result")) ||
          identifier_from(field_any(value, "toolResult")) ||
          identifier_from(field_any(value, "issue")) ||
          identifier_from_content(field_any(value, "contentItems"))
    end
  end

  defp identifier_from(_value), do: nil

  defp identifier_from_content(items) when is_list(items) do
    Enum.find_value(items, fn item ->
      item |> field_any("text") |> decode_identifier_text()
    end)
  end

  defp identifier_from_content(_items), do: nil

  defp decode_identifier_text(text) when is_binary(text) do
    case Jason.decode(text) do
      {:ok, decoded} -> identifier_from(decoded)
      _ -> nil
    end
  end

  defp decode_identifier_text(_text), do: nil

  defp normalize_identifier(value) when is_binary(value) do
    case String.trim(value) do
      "" -> :error
      trimmed -> {:ok, trimmed}
    end
  end

  defp normalize_identifier(_value), do: :error

  defp field_any(map, key) when is_map(map) and is_binary(key) do
    Map.get(map, key) || Map.get(map, safe_existing_atom(key))
  end

  defp field_any(_map, _key), do: nil

  defp safe_existing_atom(key) do
    String.to_existing_atom(key)
  rescue
    ArgumentError -> nil
  end

  defp filter_scope(query, nil), do: query
  defp filter_scope(query, scope) when is_binary(scope), do: where(query, [t], t.scope == ^scope)

  defp filter_project(query, nil), do: query
  defp filter_project(query, slug) when is_binary(slug), do: where(query, [t], t.project_slug == ^slug)

  defp append_message_with_retry(thread, attrs, attempts_left) do
    case append_message_once(thread, attrs) do
      {:error, changeset} when attempts_left > 1 ->
        if unique_sequence_error?(changeset) do
          append_message_with_retry(thread, attrs, attempts_left - 1)
        else
          {:error, changeset}
        end

      result ->
        result
    end
  end

  defp append_message_once(%Thread{id: thread_id} = thread, attrs) do
    Repo.transaction(fn ->
      next_sequence = next_sequence(thread)

      attrs
      |> normalize_message_attrs()
      |> Map.merge(%{thread_id: thread_id, sequence: next_sequence})
      |> insert_message()
      |> case do
        {:ok, message} -> message
        {:error, changeset} -> Repo.rollback(changeset)
      end
    end)
  end

  defp create_thread(project_slug, attrs) do
    attrs
    |> Map.put(:project_slug, project_slug)
    |> Map.put_new(:status, "active")
    |> then(&Thread.changeset(%Thread{}, &1))
    |> Repo.insert()
  end

  defp messages_for_thread(thread_id) do
    Message
    |> where([message], message.thread_id == ^thread_id)
    |> order_by([message], asc: message.sequence)
    |> Repo.all()
    |> Enum.map(&public_message/1)
  end

  defp next_sequence(%Thread{id: thread_id}) do
    Message
    |> where([message], message.thread_id == ^thread_id)
    |> select([message], max(message.sequence))
    |> Repo.one()
    |> case do
      nil -> 1
      sequence -> sequence + 1
    end
  end

  defp insert_message(attrs) do
    %Message{}
    |> Message.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, message} -> {:ok, public_message(message)}
      {:error, changeset} -> {:error, changeset}
    end
  end

  defp public_message(%Message{} = message), do: %{message | tool_calls: tool_calls(message)}

  defp copy_messages(target_thread, messages) do
    Enum.reduce_while(messages, {:ok, target_thread}, fn message, {:ok, thread} ->
      case append_message(thread, copy_message_attrs(message)) do
        {:ok, _message} -> {:cont, {:ok, thread}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp copy_message_attrs(%Message{} = message) do
    %{
      role: message.role,
      content: message.content,
      metadata: message.metadata || %{},
      tool_calls: tool_calls(message),
      turn_id: message.turn_id
    }
  end

  defp copy_message_attrs(message) when is_map(message) do
    %{
      role: Map.get(message, :role) || Map.get(message, "role"),
      content: Map.get(message, :content) || Map.get(message, "content"),
      metadata: Map.get(message, :metadata) || Map.get(message, "metadata") || %{},
      tool_calls: Map.get(message, :tool_calls) || Map.get(message, "tool_calls") || [],
      turn_id: Map.get(message, :turn_id) || Map.get(message, "turn_id")
    }
  end

  defp unique_sequence_error?(%Ecto.Changeset{errors: errors}) do
    Enum.any?(errors, fn
      {:sequence, {_message, opts}} -> opts[:constraint] == :unique
      _ -> false
    end)
  end

  defp normalize_message_attrs(attrs) do
    tool_calls = Map.get(attrs, :tool_calls, Map.get(attrs, "tool_calls", []))

    attrs
    |> Map.delete(:tool_calls)
    |> Map.delete("tool_calls")
    |> Map.put(:tool_calls, normalize_tool_calls(tool_calls))
  end

  defp normalize_tool_calls(tool_calls) when is_list(tool_calls), do: %{"calls" => tool_calls}
  defp normalize_tool_calls(%{"calls" => calls}) when is_list(calls), do: %{"calls" => calls}
  defp normalize_tool_calls(%{calls: calls}) when is_list(calls), do: %{"calls" => calls}
  defp normalize_tool_calls(_tool_calls), do: %{"calls" => []}

  defp tool_calls(%Message{tool_calls: %{"calls" => calls}}) when is_list(calls), do: calls
  defp tool_calls(%Message{tool_calls: %{calls: calls}}) when is_list(calls), do: calls
  defp tool_calls(_message), do: []

  defp normalize_required_string(value, field) when is_binary(value) do
    case String.trim(value) do
      "" -> {:error, {:missing_required_field, field}}
      trimmed -> {:ok, trimmed}
    end
  end

  defp normalize_required_string(_value, field), do: {:error, {:missing_required_field, field}}
end
