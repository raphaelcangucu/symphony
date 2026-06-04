defmodule SymphonyElixir.Backup.Manifest do
  @moduledoc false

  @type record :: %{
          id: pos_integer(),
          category: String.t(),
          filename: String.t(),
          size_bytes: non_neg_integer(),
          local_path: String.t(),
          trigger: String.t(),
          status: String.t(),
          created_at: DateTime.t(),
          expires_at: DateTime.t()
        }

  @spec load(Path.t()) :: %{next_id: pos_integer(), records: [record()]}
  def load(path) do
    case File.read(path) do
      {:ok, body} ->
        decode(body)

      {:error, :enoent} ->
        %{next_id: 1, records: []}
    end
  end

  @spec save(Path.t(), %{next_id: pos_integer(), records: [record()]}) :: :ok
  def save(path, %{next_id: _, records: _} = state) do
    path |> Path.dirname() |> File.mkdir_p!()
    payload = encode(state)
    File.write!(path, payload)
  end

  @spec append(Path.t(), record()) :: {record(), %{next_id: pos_integer(), records: [record()]}}
  def append(path, record) do
    state = load(path)
    state = %{state | records: [record | state.records], next_id: state.next_id + 1}
    :ok = save(path, state)
    {record, state}
  end

  @spec update(Path.t(), pos_integer(), (record() -> record())) :: {:ok, record()} | :error
  def update(path, id, fun) when is_function(fun, 1) do
    state = load(path)

    case Enum.find_index(state.records, &(&1.id == id)) do
      nil ->
        :error

      index ->
        record = fun.(Enum.at(state.records, index))
        records = List.replace_at(state.records, index, record)
        :ok = save(path, %{state | records: records})
        {:ok, record}
    end
  end

  @spec delete(Path.t(), pos_integer()) :: :ok | :error
  def delete(path, id) do
    state = load(path)
    {removed, kept} = Enum.split_with(state.records, &(&1.id == id))

    if removed == [] do
      :error
    else
      :ok = save(path, %{state | records: kept})
      :ok
    end
  end

  defp decode(body) do
    case Jason.decode(body) do
      {:ok, %{"next_id" => next_id, "records" => records}} when is_list(records) ->
        %{
          next_id: max(next_id, 1),
          records: Enum.map(records, &decode_record/1)
        }

      _ ->
        %{next_id: 1, records: []}
    end
  end

  defp decode_record(map) when is_map(map) do
    %{
      id: map["id"],
      category: map["category"] || "database",
      filename: map["filename"] || "",
      size_bytes: map["size_bytes"] || 0,
      local_path: map["local_path"] || "",
      trigger: map["trigger"] || "manual",
      status: map["status"] || "completed",
      created_at: parse_dt(map["created_at"]),
      expires_at: parse_dt(map["expires_at"])
    }
  end

  defp encode(%{next_id: next_id, records: records}) do
    Jason.encode!(%{
      "next_id" => next_id,
      "records" =>
        Enum.map(records, fn r ->
          %{
            "id" => r.id,
            "category" => r.category,
            "filename" => r.filename,
            "size_bytes" => r.size_bytes,
            "local_path" => r.local_path,
            "trigger" => r.trigger,
            "status" => r.status,
            "created_at" => DateTime.to_iso8601(r.created_at),
            "expires_at" => DateTime.to_iso8601(r.expires_at)
          }
        end)
    })
  end

  defp parse_dt(nil), do: DateTime.utc_now()

  defp parse_dt(iso) when is_binary(iso) do
    case DateTime.from_iso8601(iso) do
      {:ok, dt, _} -> dt
      _ -> DateTime.utc_now()
    end
  end

  defp parse_dt(_), do: DateTime.utc_now()
end
