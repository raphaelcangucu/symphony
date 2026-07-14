defmodule SymphonyElixir.Assistant.TurnTimeline do
  @moduledoc """
  Immutable collector state for one ordered assistant turn.

  The timeline keeps assistant text, tool-call snapshots, and their interleaved
  wire order together so callers cannot update one representation without the
  others.
  """

  @valid_statuses ~w(running complete error)
  @tool_fields ~w(id name status arguments output result)a
  @fallback_id_prefix "assistant-tool-"
  @empty_generated_tool_ids MapSet.new()

  defstruct assistant_text: [],
            content_blocks: [],
            tool_calls: [],
            next_tool_sequence: 1,
            generated_tool_ids: @empty_generated_tool_ids,
            provider_id_aliases: %{}

  @opaque t :: %__MODULE__{
            assistant_text: iodata(),
            content_blocks: [map()],
            tool_calls: [map()],
            next_tool_sequence: pos_integer(),
            generated_tool_ids: MapSet.t(String.t()),
            provider_id_aliases: %{optional(String.t()) => String.t()}
          }

  @doc "Creates an empty turn timeline."
  @spec new() :: t()
  def new, do: %__MODULE__{}

  @doc "Appends a non-empty text delta, merging it with adjacent text."
  @spec append_text(t(), String.t()) :: t()
  def append_text(timeline, text) do
    validate_timeline!(timeline)
    validate_text!(text)

    if text == "" do
      timeline
    else
      %{
        timeline
        | assistant_text: [timeline.assistant_text, text],
          content_blocks: append_text_block(timeline.content_blocks, text)
      }
    end
  end

  @doc """
  Inserts or updates a tool call and returns the normalized call with its stable id.
  """
  @spec upsert_tool_call(t(), map()) :: {t(), map()}
  def upsert_tool_call(timeline, tool_call) do
    validate_timeline!(timeline)
    normalized = normalize_tool_call!(tool_call)
    {timeline, normalized} = resolve_provider_id_alias(timeline, normalized)
    {tool_call_id, next_tool_sequence, id_origin} = resolve_tool_call_id(timeline, normalized)
    normalized = Map.put(normalized, :id, tool_call_id)

    case Enum.find_index(timeline.tool_calls, &(Map.fetch!(&1, :id) == tool_call_id)) do
      nil ->
        inserted = ensure_tool_name(normalized)

        updated = %{
          timeline
          | tool_calls: timeline.tool_calls ++ [inserted],
            content_blocks: timeline.content_blocks ++ [%{"type" => "tool", "tool_call_id" => tool_call_id}],
            next_tool_sequence: next_tool_sequence,
            generated_tool_ids: track_generated_tool_id(timeline.generated_tool_ids, tool_call_id, id_origin)
        }

        {updated, inserted}

      index ->
        merged =
          timeline.tool_calls
          |> Enum.fetch!(index)
          |> merge_tool_call(normalized)
          |> ensure_tool_name()

        updated = %{
          timeline
          | tool_calls: List.replace_at(timeline.tool_calls, index, merged),
            next_tool_sequence: next_tool_sequence
        }

        {updated, merged}
    end
  end

  @doc "Returns all collected assistant text."
  @spec assistant_text(t()) :: String.t()
  def assistant_text(timeline) do
    validate_timeline!(timeline)
    IO.iodata_to_binary(timeline.assistant_text)
  end

  @doc "Returns tool calls in first-seen order."
  @spec tool_calls(t()) :: [map()]
  def tool_calls(timeline) do
    validate_timeline!(timeline)
    timeline.tool_calls
  end

  @doc "Returns ordered text and tool wire blocks."
  @spec content_blocks(t()) :: [map()]
  def content_blocks(timeline) do
    validate_timeline!(timeline)
    timeline.content_blocks
  end

  @doc "Checks whether a value is a valid nonempty ordered block list."
  @spec valid_content_blocks?(term()) :: boolean()
  def valid_content_blocks?(blocks) when is_list(blocks) and blocks != [] do
    Enum.all?(blocks, &valid_content_block?/1) and
      no_adjacent_text_blocks?(blocks) and
      unique_tool_block_ids?(blocks)
  end

  def valid_content_blocks?(_blocks), do: false

  @doc "Checks ordered blocks against exact message content and persisted tool calls."
  @spec valid_content_blocks?(term(), term(), term()) :: boolean()
  def valid_content_blocks?(blocks, content, tool_calls)
      when is_binary(content) and is_list(tool_calls) do
    with true <- valid_content_blocks?(blocks),
         {:ok, persisted_tool_ids} <- persisted_tool_call_ids(tool_calls) do
      text_block_content(blocks) == content and
        tool_block_ids(blocks) == persisted_tool_ids
    else
      _invalid -> false
    end
  end

  def valid_content_blocks?(_blocks, _content, _tool_calls), do: false

  defp append_text_block([], text), do: [%{"type" => "text", "text" => text}]

  defp append_text_block(blocks, text) do
    case List.last(blocks) do
      %{"type" => "text", "text" => existing} ->
        List.replace_at(blocks, -1, %{"type" => "text", "text" => existing <> text})

      _other ->
        blocks ++ [%{"type" => "text", "text" => text}]
    end
  end

  defp normalize_tool_call!(tool_call) when is_map(tool_call) do
    normalized =
      Enum.reduce(@tool_fields, tool_call, fn field, accumulator ->
        string_field = Atom.to_string(field)
        validate_unambiguous_field!(tool_call, field, string_field)

        value =
          cond do
            Map.has_key?(tool_call, field) -> Map.get(tool_call, field)
            Map.has_key?(tool_call, string_field) -> Map.get(tool_call, string_field)
            true -> nil
          end

        accumulator
        |> Map.delete(field)
        |> Map.delete(string_field)
        |> maybe_put_field(field, value)
      end)

    validate_tool_call!(normalized)
  end

  defp normalize_tool_call!(_tool_call), do: raise(ArgumentError, "tool call must be a map")

  defp validate_unambiguous_field!(tool_call, atom_field, string_field) do
    if Map.has_key?(tool_call, atom_field) and Map.has_key?(tool_call, string_field) and
         Map.get(tool_call, atom_field) != Map.get(tool_call, string_field) do
      raise ArgumentError, "tool call has conflicting #{string_field} fields"
    end
  end

  defp maybe_put_field(map, _field, nil), do: map
  defp maybe_put_field(map, field, value), do: Map.put(map, field, value)

  defp validate_tool_call!(tool_call) do
    validate_optional_id!(Map.get(tool_call, :id))
    validate_optional_name!(Map.get(tool_call, :name))
    validate_status!(Map.get(tool_call, :status))
    validate_optional_map!(tool_call, :arguments)
    validate_optional_map!(tool_call, :result)
    validate_optional_output!(tool_call)
    tool_call
  end

  defp validate_optional_id!(nil), do: :ok

  defp validate_optional_id!(id) when is_binary(id) do
    if String.trim(id) == "",
      do: raise(ArgumentError, "tool call id must be a non-blank string")
  end

  defp validate_optional_id!(_id),
    do: raise(ArgumentError, "tool call id must be a non-blank string")

  defp validate_optional_name!(nil), do: :ok

  defp validate_optional_name!(name) when is_binary(name) do
    if String.trim(name) == "",
      do: raise(ArgumentError, "tool call name must be a non-blank string")
  end

  defp validate_optional_name!(_name),
    do: raise(ArgumentError, "tool call name must be a non-blank string")

  defp validate_status!(status) when status in @valid_statuses, do: :ok

  defp validate_status!(_status) do
    raise ArgumentError, "tool call status must be one of: #{Enum.join(@valid_statuses, ", ")}"
  end

  defp validate_optional_map!(tool_call, field) do
    case Map.fetch(tool_call, field) do
      :error -> :ok
      {:ok, value} when is_map(value) -> :ok
      {:ok, _value} -> raise ArgumentError, "tool call #{field} must be a map"
    end
  end

  defp validate_optional_output!(tool_call) do
    case Map.fetch(tool_call, :output) do
      :error -> :ok
      {:ok, output} when is_binary(output) -> :ok
      {:ok, _output} -> raise ArgumentError, "tool call output must be a string"
    end
  end

  defp resolve_tool_call_id(timeline, %{id: id}), do: {id, timeline.next_tool_sequence, :provider}

  defp resolve_tool_call_id(timeline, %{status: status, name: name})
       when status != "running" and name not in ["", "unknown"] do
    case most_recent_running_id(timeline.tool_calls, name) do
      nil ->
        {id, next_tool_sequence} = allocate_tool_call_id(timeline)
        {id, next_tool_sequence, :generated}

      id ->
        {id, timeline.next_tool_sequence, :existing}
    end
  end

  defp resolve_tool_call_id(timeline, _tool_call) do
    {id, next_tool_sequence} = allocate_tool_call_id(timeline)
    {id, next_tool_sequence, :generated}
  end

  defp most_recent_running_id(tool_calls, name) do
    tool_calls
    |> Enum.reverse()
    |> Enum.find_value(fn tool_call ->
      if Map.get(tool_call, :status) == "running" and Map.get(tool_call, :name) == name,
        do: Map.fetch!(tool_call, :id)
    end)
  end

  defp allocate_tool_call_id(timeline) do
    used_ids = MapSet.new(timeline.tool_calls, &Map.fetch!(&1, :id))
    next_available_tool_call_id(timeline.next_tool_sequence, used_ids)
  end

  defp next_available_tool_call_id(sequence, used_ids) do
    id = @fallback_id_prefix <> Integer.to_string(sequence)

    if MapSet.member?(used_ids, id),
      do: next_available_tool_call_id(sequence + 1, used_ids),
      else: {id, sequence + 1}
  end

  defp resolve_provider_id_alias(timeline, %{id: raw_provider_id} = tool_call) do
    case Map.fetch(timeline.provider_id_aliases, raw_provider_id) do
      {:ok, effective_id} ->
        {timeline, Map.put(tool_call, :id, effective_id)}

      :error ->
        {effective_id, next_tool_sequence} =
          if Enum.any?(timeline.tool_calls, &(Map.get(&1, :id) == raw_provider_id)),
            do: allocate_tool_call_id(timeline),
            else: {raw_provider_id, timeline.next_tool_sequence}

        updated = %{
          timeline
          | next_tool_sequence: next_tool_sequence,
            provider_id_aliases: Map.put(timeline.provider_id_aliases, raw_provider_id, effective_id)
        }

        {updated, Map.put(tool_call, :id, effective_id)}
    end
  end

  defp resolve_provider_id_alias(timeline, tool_call), do: {timeline, tool_call}

  defp track_generated_tool_id(generated_tool_ids, tool_call_id, :generated),
    do: MapSet.put(generated_tool_ids, tool_call_id)

  defp track_generated_tool_id(generated_tool_ids, _tool_call_id, _origin),
    do: generated_tool_ids

  defp merge_tool_call(existing, update) do
    Enum.reduce(update, existing, fn
      {:name, "unknown"}, accumulator ->
        if meaningful_name?(Map.get(accumulator, :name)),
          do: accumulator,
          else: Map.put(accumulator, :name, "unknown")

      {field, value}, accumulator when field in [:arguments, :result] and is_map(value) ->
        Map.update(accumulator, field, value, &deep_merge_maps(&1, value))

      {field, value}, accumulator ->
        Map.put(accumulator, field, value)
    end)
  end

  defp deep_merge_maps(existing, update) when is_map(existing) do
    Map.merge(existing, update, fn _key, existing_value, update_value ->
      if is_map(existing_value) and is_map(update_value),
        do: deep_merge_maps(existing_value, update_value),
        else: update_value
    end)
  end

  defp deep_merge_maps(_existing, update), do: update

  defp ensure_tool_name(tool_call) do
    if meaningful_name?(Map.get(tool_call, :name)),
      do: tool_call,
      else: Map.put(tool_call, :name, "unknown")
  end

  defp meaningful_name?(name), do: is_binary(name) and String.trim(name) != "" and name != "unknown"

  defp validate_text!(text) when is_binary(text), do: :ok
  defp validate_text!(_text), do: raise(ArgumentError, "text delta must be a string")

  defp validate_timeline!(%__MODULE__{} = timeline) do
    valid? =
      valid_iodata?(timeline.assistant_text) and
        valid_internal_blocks?(timeline.content_blocks) and
        valid_stored_tool_calls?(timeline.tool_calls) and
        is_integer(timeline.next_tool_sequence) and
        timeline.next_tool_sequence > 0 and
        valid_generated_tool_ids?(timeline.generated_tool_ids, timeline.tool_calls) and
        valid_provider_id_aliases?(
          timeline.provider_id_aliases,
          timeline.tool_calls,
          timeline.generated_tool_ids
        ) and
        state_representations_agree?(timeline)

    if valid?, do: :ok, else: raise(ArgumentError, "invalid turn timeline state")
  end

  defp validate_timeline!(_timeline), do: raise(ArgumentError, "invalid turn timeline state")

  defp valid_iodata?(value) do
    IO.iodata_to_binary(value)
    true
  rescue
    ArgumentError -> false
  end

  defp valid_internal_blocks?([]), do: true
  defp valid_internal_blocks?(blocks), do: valid_content_blocks?(blocks)

  defp valid_stored_tool_calls?(tool_calls) when is_list(tool_calls) do
    Enum.all?(tool_calls, fn tool_call ->
      is_map(tool_call) and valid_stored_tool_call?(tool_call)
    end)
  end

  defp valid_stored_tool_calls?(_tool_calls), do: false

  defp valid_generated_tool_ids?(%MapSet{} = generated_tool_ids, tool_calls) do
    stored_ids = MapSet.new(tool_calls, &Map.get(&1, :id))

    Enum.all?(generated_tool_ids, fn id ->
      meaningful_id?(id) and String.starts_with?(id, @fallback_id_prefix)
    end) and MapSet.subset?(generated_tool_ids, stored_ids)
  end

  defp valid_generated_tool_ids?(_generated_tool_ids, _tool_calls), do: false

  defp valid_provider_id_aliases?(provider_id_aliases, tool_calls, generated_tool_ids)
       when is_map(provider_id_aliases) do
    stored_ids = MapSet.new(tool_calls, &Map.get(&1, :id))
    effective_ids = Map.values(provider_id_aliases)

    Enum.all?(provider_id_aliases, fn {raw_id, effective_id} ->
      meaningful_id?(raw_id) and meaningful_id?(effective_id)
    end) and
      Enum.uniq(effective_ids) == effective_ids and
      MapSet.subset?(MapSet.new(effective_ids), stored_ids) and
      MapSet.disjoint?(MapSet.new(effective_ids), generated_tool_ids)
  end

  defp valid_provider_id_aliases?(_provider_id_aliases, _tool_calls, _generated_tool_ids),
    do: false

  defp valid_stored_tool_call?(tool_call) do
    meaningful_id?(Map.get(tool_call, :id)) and
      is_binary(Map.get(tool_call, :name)) and
      String.trim(Map.get(tool_call, :name)) != "" and
      Map.get(tool_call, :status) in @valid_statuses and
      valid_optional_map_field?(tool_call, :arguments) and
      valid_optional_map_field?(tool_call, :result) and
      valid_optional_output_field?(tool_call)
  end

  defp valid_optional_map_field?(tool_call, field) do
    case Map.fetch(tool_call, field) do
      :error -> true
      {:ok, nil} -> true
      {:ok, value} -> is_map(value)
    end
  end

  defp valid_optional_output_field?(tool_call) do
    case Map.fetch(tool_call, :output) do
      :error -> true
      {:ok, nil} -> true
      {:ok, output} -> is_binary(output)
    end
  end

  defp state_representations_agree?(timeline) do
    text =
      timeline.content_blocks
      |> Enum.flat_map(fn
        %{"type" => "text", "text" => text} -> [text]
        _tool_block -> []
      end)
      |> Enum.join()

    block_tool_ids =
      Enum.flat_map(timeline.content_blocks, fn
        %{"type" => "tool", "tool_call_id" => id} -> [id]
        _text_block -> []
      end)

    tool_call_ids = Enum.map(timeline.tool_calls, &Map.get(&1, :id))

    text == IO.iodata_to_binary(timeline.assistant_text) and
      block_tool_ids == tool_call_ids and
      Enum.uniq(tool_call_ids) == tool_call_ids
  end

  defp valid_content_block?(%{"type" => "text", "text" => text} = block) do
    map_size(block) == 2 and is_binary(text) and text != ""
  end

  defp valid_content_block?(%{"type" => "tool", "tool_call_id" => id} = block) do
    map_size(block) == 2 and meaningful_id?(id)
  end

  defp valid_content_block?(_block), do: false

  defp text_block_content(blocks) do
    blocks
    |> Enum.flat_map(fn
      %{"type" => "text", "text" => text} -> [text]
      _tool_block -> []
    end)
    |> Enum.join()
  end

  defp persisted_tool_call_ids(tool_calls) do
    Enum.reduce_while(tool_calls, {:ok, []}, fn tool_call, {:ok, ids} ->
      case persisted_tool_call_id(tool_call) do
        id when is_binary(id) ->
          if id in ids, do: {:halt, :error}, else: {:cont, {:ok, ids ++ [id]}}

        _invalid ->
          {:halt, :error}
      end
    end)
  end

  defp persisted_tool_call_id(tool_call) when is_map(tool_call) do
    atom_id = Map.get(tool_call, :id)
    string_id = Map.get(tool_call, "id")

    cond do
      is_binary(atom_id) and is_binary(string_id) and atom_id != string_id -> nil
      meaningful_id?(atom_id) -> atom_id
      meaningful_id?(string_id) -> string_id
      true -> nil
    end
  end

  defp persisted_tool_call_id(_tool_call), do: nil

  defp no_adjacent_text_blocks?(blocks) do
    blocks
    |> Enum.chunk_every(2, 1, :discard)
    |> Enum.all?(fn
      [%{"type" => "text"}, %{"type" => "text"}] -> false
      _pair -> true
    end)
  end

  defp unique_tool_block_ids?(blocks) do
    ids = tool_block_ids(blocks)

    Enum.uniq(ids) == ids
  end

  defp tool_block_ids(blocks) do
    Enum.flat_map(blocks, fn
      %{"type" => "tool", "tool_call_id" => id} -> [id]
      _text_block -> []
    end)
  end

  defp meaningful_id?(id), do: is_binary(id) and String.trim(id) != ""
end
