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
