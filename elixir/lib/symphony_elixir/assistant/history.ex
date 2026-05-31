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
    Repo.get_by(Thread, project_slug: project_slug, status: "active")
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
