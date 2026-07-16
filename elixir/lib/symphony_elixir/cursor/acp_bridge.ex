defmodule SymphonyElixir.Cursor.AcpBridge do
  @moduledoc """
  Maps Cursor ACP server messages onto Symphony bridge notifications and
  interactive callbacks (approval / user input / create_plan).
  """

  @type callbacks :: %{
          required(:on_event) => (map() -> any()),
          required(:on_approval_required) => (map() -> any()),
          required(:on_user_input_required) => (map() -> any()),
          required(:on_create_plan_required) => (map() -> any()),
          required(:respond) => (term(), map() -> :ok)
        }

  @spec handle_server_message(map(), callbacks()) :: :ok
  def handle_server_message(%{"method" => "session/update", "params" => params}, callbacks)
      when is_map(params) do
    handle_session_update(Map.get(params, "update") || %{}, callbacks)
  end

  def handle_server_message(%{"method" => "session/request_permission"} = msg, callbacks) do
    id = Map.get(msg, "id")
    params = Map.get(msg, "params") || %{}
    request_id = to_string(id || generate_request_id())

    callbacks.on_approval_required.(%{
      request_id: request_id,
      agent: "cursor",
      tool_name: Map.get(params, "toolName") || Map.get(params, "tool_name") || "tool",
      command: inspect(params),
      cwd: Map.get(params, "cwd"),
      input: params,
      reason: "Cursor requested permission",
      acp_id: id,
      respond: fn action ->
        option =
          case action do
            :approve -> "allow-once"
            :deny -> "reject-once"
            "approve" -> "allow-once"
            "cancel" -> "reject-once"
            other when is_binary(other) -> other
            _ -> "reject-once"
          end

        callbacks.respond.(id, %{"outcome" => %{"outcome" => "selected", "optionId" => option}})
      end
    })

    :ok
  end

  def handle_server_message(%{"method" => "cursor/ask_question"} = msg, callbacks) do
    id = Map.get(msg, "id")
    params = Map.get(msg, "params") || %{}
    request_id = to_string(id || generate_request_id())
    questions = normalize_questions(Map.get(params, "questions") || [])

    callbacks.on_user_input_required.(%{
      request_id: request_id,
      questions: questions,
      acp_id: id,
      respond: fn answers ->
        callbacks.respond.(id, %{
          "outcome" => %{
            "outcome" => "answered",
            "answers" => answers_for_acp(answers, questions)
          }
        })
      end
    })

    :ok
  end

  def handle_server_message(%{"method" => "cursor/task", "params" => params}, callbacks)
      when is_map(params) do
    callbacks.on_event.(%{
      "method" => "item/created",
      "params" => %{
        "item" => %{
          "type" => "tool_call",
          "id" => Map.get(params, "toolCallId") || generate_request_id(),
          "name" => "Task",
          "status" => "completed",
          "arguments" => params
        }
      }
    })

    :ok
  end

  def handle_server_message(%{"method" => "cursor/create_plan"} = msg, callbacks) do
    id = Map.get(msg, "id")
    params = Map.get(msg, "params") || %{}
    request_id = to_string(id || generate_request_id())

    callbacks.on_create_plan_required.(%{
      request_id: request_id,
      name: Map.get(params, "name"),
      overview: Map.get(params, "overview"),
      plan: Map.get(params, "plan"),
      plan_uri: Map.get(params, "planUri") || Map.get(params, "plan_uri"),
      acp_id: id,
      respond: fn action ->
        outcome =
          case action do
            :accept -> %{"outcome" => "accepted"}
            :reject -> %{"outcome" => "rejected"}
            "accept" -> %{"outcome" => "accepted"}
            "reject" -> %{"outcome" => "rejected"}
            _ -> %{"outcome" => "cancelled"}
          end

        callbacks.respond.(id, %{"outcome" => outcome})
      end
    })

    :ok
  end

  def handle_server_message(_msg, _callbacks), do: :ok

  defp handle_session_update(%{"sessionUpdate" => "agent_message_chunk"} = update, callbacks) do
    text = get_in(update, ["content", "text"]) || get_in(update, ["content", "content"]) || ""

    if is_binary(text) and text != "" do
      callbacks.on_event.(%{
        "method" => "item/progress",
        "params" => %{"item" => %{"type" => "agent_message", "text" => text}}
      })
    end

    :ok
  end

  defp handle_session_update(_update, _callbacks), do: :ok

  defp normalize_questions(questions) when is_list(questions) do
    Enum.map(questions, fn
      %{"id" => id, "prompt" => prompt} = q ->
        %{
          "id" => id,
          "header" => Map.get(q, "header") || prompt,
          "question" => prompt,
          "options" => Map.get(q, "options") || [],
          "multiSelect" => Map.get(q, "allowMultiple") == true
        }

      other when is_map(other) ->
        other

      _ ->
        %{}
    end)
  end

  defp normalize_questions(_), do: []

  defp answers_for_acp(answers, questions) when is_map(answers) do
    Enum.map(questions, fn q ->
      qid = Map.get(q, "id") || Map.get(q, :id)
      options = Map.get(q, "options") || []

      selected =
        case Map.get(answers, qid) || Map.get(answers, to_string(qid)) do
          list when is_list(list) -> Enum.map(list, &to_string/1)
          value when is_binary(value) -> [value]
          _ -> []
        end

      %{"questionId" => qid, "selectedOptionIds" => resolve_option_ids(selected, options)}
    end)
  end

  defp answers_for_acp(_, _), do: []

  defp resolve_option_ids(selected, options) when is_list(selected) and is_list(options) do
    Enum.flat_map(selected, fn value ->
      case Enum.find(options, fn
             %{"id" => id} when id == value -> true
             %{"label" => label} when label == value -> true
             opt when is_map(opt) -> Map.get(opt, "id") == value or Map.get(opt, "label") == value
             _ -> false
           end) do
        %{"id" => id} when is_binary(id) -> [id]
        _ -> [value]
      end
    end)
  end

  defp resolve_option_ids(selected, _), do: selected

  defp generate_request_id do
    Base.encode16(:crypto.strong_rand_bytes(8), case: :lower)
  end
end
