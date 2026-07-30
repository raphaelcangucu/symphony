defmodule SymphonyElixir.Agent.ExecutionTranscript do
  @moduledoc """
  Durable, task-scoped transcript for an autonomous `issue_execution`.

  An orchestrator worker streams provider events to the orchestrator process,
  not to an interactive Assistant channel.  This module folds those events into
  one readable assistant message per completed provider turn, so opening the
  execution session from mobile shows the actual task brief, response and tool
  activity instead of an empty chat.
  """

  require Logger

  alias SymphonyElixir.Assistant.{FileActivityPresenter, History, TurnTimeline}

  @spec record(map(), map()) :: {map(), boolean()}
  def record(%{execution_session_id: session_id} = running_entry, update)
      when is_integer(session_id) and is_map(update) do
    with {:ok, thread} <- History.get_thread(session_id) do
      seeded? = seed_if_empty(thread, running_entry)
      timeline = Map.get(running_entry, :execution_timeline, TurnTimeline.new())
      timeline = fold(timeline, update)

      updated_entry = Map.put(running_entry, :execution_timeline, timeline)

      case Map.get(update, :event) do
        event
        when event in [:turn_completed, :turn_failed, :turn_cancelled, :turn_ended_with_error] ->
          {flush_turn(thread, updated_entry, timeline, event), true}

        _ ->
          {updated_entry, seeded?}
      end
    else
      _ -> {running_entry, false}
    end
  rescue
    error ->
      Logger.warning("Execution transcript update failed: #{Exception.message(error)}")
      {running_entry, false}
  end

  def record(running_entry, _update), do: {running_entry, false}

  defp seed_if_empty(thread, running_entry) do
    if History.list_messages_for_thread(thread.id) == [] do
      issue = Map.get(running_entry, :issue, %{})
      identifier = Map.get(issue, :identifier, "task")
      title = Map.get(issue, :title) || identifier
      brief = Map.get(issue, :description) || title
      agent = Map.get(running_entry, :agent_kind) || "agent"
      model = Map.get(running_entry, :model)

      _ =
        History.append_message(thread, %{
          role: "user",
          content: brief,
          metadata: %{"kind" => "execution_task_brief", "issue_identifier" => identifier}
        })

      _ =
        History.append_message(thread, %{
          role: "assistant",
          content: execution_started_text(identifier, agent, model),
          metadata: %{"kind" => "execution_started", "issue_identifier" => identifier}
        })

      true
    else
      false
    end
  end

  defp execution_started_text(identifier, agent, model) when is_binary(model) and model != "" do
    "Execution started for #{identifier} with #{agent} (#{model})."
  end

  defp execution_started_text(identifier, agent, _model),
    do: "Execution started for #{identifier} with #{agent}."

  defp flush_turn(thread, running_entry, timeline, event) do
    text = TurnTimeline.assistant_text(timeline)
    tool_calls = TurnTimeline.tool_calls(timeline)
    turn = Map.get(running_entry, :turn_count, 0)

    content =
      case String.trim(text) do
        "" -> terminal_content(event, turn, tool_calls)
        message -> message
      end

    metadata = %{
      "kind" => "execution_turn",
      "event" => Atom.to_string(event),
      "turn" => turn,
      "content_blocks" => ensure_content_blocks(TurnTimeline.content_blocks(timeline), content, tool_calls)
    }

    case History.append_message(thread, %{
           role: "assistant",
           content: content,
           tool_calls: tool_calls,
           metadata: metadata
         }) do
      {:ok, _message} ->
        Map.delete(running_entry, :execution_timeline)

      {:error, reason} ->
        Logger.warning("Could not persist execution turn: #{inspect(reason)}")
        running_entry
    end
  end

  defp terminal_content(:turn_completed, turn, calls) when calls != [],
    do: "Turn #{turn} completed after #{length(calls)} activities."

  defp terminal_content(:turn_completed, turn, _calls), do: "Turn #{turn} completed."
  defp terminal_content(:turn_cancelled, turn, _calls), do: "Turn #{turn} was cancelled."
  defp terminal_content(_event, turn, _calls), do: "Turn #{turn} failed."

  defp ensure_content_blocks(blocks, content, tool_calls) do
    if TurnTimeline.valid_content_blocks?(blocks, content, tool_calls), do: blocks, else: []
  end

  defp fold(timeline, update) do
    case FileActivityPresenter.from_event(update) do
      {:started, tool_call} -> upsert_tool(timeline, tool_call)
      {:completed, tool_call} -> upsert_tool(timeline, tool_call)
      :ignore -> fold_provider_event(timeline, update)
    end
  end

  defp fold_provider_event(timeline, update) do
    payload = Map.get(update, :payload, %{})
    method = get_any(payload, "method")
    event = Map.get(update, :event)

    cond do
      method == "item/agentMessage/delta" ->
        append_text(timeline, delta_from(payload))

      method == "item/progress" ->
        append_message_text(timeline, progress_agent_message(payload))

      method == "item/created" ->
        fold_created_item(timeline, payload)

      event == :tool_call_started ->
        upsert_tool(timeline, tool_from_update(payload, "running", update))

      event in [:tool_call_completed, :tool_call_failed, :unsupported_tool_call] ->
        status = if event == :tool_call_completed, do: "complete", else: "error"
        upsert_tool(timeline, tool_from_update(payload, status, update))

      event in [:agent_message, :assistant_message] ->
        append_message_text(timeline, text_from(payload))

      true ->
        timeline
    end
  end

  defp fold_created_item(timeline, payload) do
    item = get_in_any(payload, ["params", "item"]) || %{}

    case get_any(item, "type") do
      "text" ->
        append_message_text(timeline, get_any(item, "text"))

      "tool_call" ->
        upsert_tool(timeline, %{
          id: get_any(item, "tool_use_id"),
          name: normalized_tool_name(get_any(item, "name")),
          status: "running",
          arguments: get_any(item, "input") || %{},
          result: %{}
        })

      "tool_result" ->
        upsert_tool(timeline, %{
          id: get_any(item, "tool_use_id"),
          status: if(get_any(item, "is_error") == true, do: "error", else: "complete"),
          output: output_from(get_any(item, "content")),
          result: %{}
        })

      _ ->
        timeline
    end
  end

  defp tool_from_update(payload, status, update) do
    params = get_any(payload, "params") || %{}
    result = Map.get(update, :result) || %{}

    %{
      id: get_any(params, "tool_call_id") || get_any(params, "id") || get_any(payload, "id"),
      name: normalized_tool_name(get_any(params, "name") || get_any(params, "tool")),
      status: status,
      arguments: get_any(params, "arguments") || get_any(params, "input") || %{},
      output: output_from(Map.get(result, "output") || Map.get(result, :output)),
      result: if(is_map(result), do: result, else: %{})
    }
    |> drop_nil_values()
  end

  defp upsert_tool(timeline, tool_call) do
    {timeline, _tool} = TurnTimeline.upsert_tool_call(timeline, tool_call)
    timeline
  rescue
    ArgumentError -> timeline
  end

  # Most `agentMessage/delta` events are byte fragments, so joining them
  # directly is correct. A few provider bridges, however, reuse the delta
  # envelope for a whole progress paragraph and omit its leading whitespace.
  # Detect only the unmistakable sentence-boundary shape; this retains normal
  # word fragments (for example `Implement` + `ed`) while avoiding the mobile
  # run-ons such as `PR.Publicação`.
  defp append_text(timeline, text) when is_binary(text) and text != "" do
    existing = TurnTimeline.assistant_text(timeline)
    separator = if independent_delta?(existing, text), do: "\n\n", else: ""
    TurnTimeline.append_text(timeline, separator <> text)
  end

  defp append_text(timeline, _text), do: timeline

  defp independent_delta?(existing, text) do
    String.match?(existing, ~r/[.!?…][”"')\]]?$/u) and
      String.match?(text, ~r/^[[:upper:]]/u) and
      String.length(String.trim(text)) >= 20
  end

  # A delta is a fragment and must remain byte-for-byte adjacent to its
  # neighbour. Progress and completed agent-message events, however, are
  # separate status updates. Providers often omit their trailing newline;
  # concatenating those messages made the mobile execution transcript read as
  # one noisy run-on paragraph (for example `mobile.A implementação`). Keep
  # their original text but create the same readable message hierarchy as the
  # web chat.
  defp append_message_text(timeline, text) when is_binary(text) and text != "" do
    existing = TurnTimeline.assistant_text(timeline)

    separator =
      if existing != "" and not String.match?(existing, ~r/\s$/) and
           not String.match?(text, ~r/^\s/) do
        "\n\n"
      else
        ""
      end

    TurnTimeline.append_text(timeline, separator <> text)
  end

  defp append_message_text(timeline, _text), do: timeline

  defp delta_from(payload) do
    get_in_any(payload, ["params", "delta"]) ||
      get_in_any(payload, ["params", "text"]) ||
      get_in_any(payload, ["params", "message", "content"])
  end

  defp progress_agent_message(payload) do
    get_in_any(payload, ["params", "item", "text"]) ||
      get_in_any(payload, ["params", "agent_message"]) ||
      get_in_any(payload, ["params", "message"])
  end

  defp text_from(payload) do
    get_any(payload, "text") || get_in_any(payload, ["params", "text"])
  end

  defp normalized_tool_name(name) when is_binary(name) and name != "" do
    String.replace_prefix(name, "mcp__symphony__", "")
  end

  defp normalized_tool_name(_), do: "unknown"

  defp output_from(value) when is_binary(value), do: value
  defp output_from(value) when is_list(value), do: Enum.map_join(value, "\n", &output_from/1)
  defp output_from(value) when is_map(value), do: inspect(value)
  defp output_from(_), do: nil

  defp drop_nil_values(map), do: Map.reject(map, fn {_key, value} -> is_nil(value) end)

  # Provider payloads arrive with either JSON or Elixir keys. Keep the lookup
  # explicit: converting arbitrary provider keys with `String.to_atom/1` would
  # permanently exhaust the VM atom table on a long-lived Symphony host.
  defp get_any(map, key) when is_map(map) and is_binary(key) do
    Map.get(map, key) || Map.get(map, known_atom_key(key))
  end

  defp get_any(_map, _key), do: nil

  defp known_atom_key("method"), do: :method
  defp known_atom_key("params"), do: :params
  defp known_atom_key("delta"), do: :delta
  defp known_atom_key("text"), do: :text
  defp known_atom_key("message"), do: :message
  defp known_atom_key("content"), do: :content
  defp known_atom_key("item"), do: :item
  defp known_atom_key("agent_message"), do: :agent_message
  defp known_atom_key("type"), do: :type
  defp known_atom_key("tool_use_id"), do: :tool_use_id
  defp known_atom_key("name"), do: :name
  defp known_atom_key("input"), do: :input
  defp known_atom_key("is_error"), do: :is_error
  defp known_atom_key("tool_call_id"), do: :tool_call_id
  defp known_atom_key("id"), do: :id
  defp known_atom_key("tool"), do: :tool
  defp known_atom_key("arguments"), do: :arguments
  defp known_atom_key(_key), do: nil

  defp get_in_any(value, []), do: value

  defp get_in_any(map, [key | rest]) when is_map(map),
    do: get_in_any(get_any(map, key), rest)

  defp get_in_any(_value, _keys), do: nil
end
