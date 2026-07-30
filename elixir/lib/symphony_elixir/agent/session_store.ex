defmodule SymphonyElixir.Agent.SessionStore do
  @moduledoc """
  Per-session Symphony-owned transcript files.

  Each session (any origin) writes to
  `<workspace>/.symphony/sessions/<session_id>/transcript.jsonl`, so co-located
  sessions in one working tree never cross-write logs.
  """

  require Logger

  @default_tail_bytes 65_536

  @spec transcript_path(Path.t(), integer() | String.t()) :: Path.t()
  def transcript_path(workspace, session_id) when is_binary(workspace) do
    Path.join([
      Path.expand(workspace),
      ".symphony",
      "sessions",
      to_string(session_id),
      "transcript.jsonl"
    ])
  end

  @spec append(Path.t(), integer() | String.t(), map() | String.t()) :: :ok
  def append(workspace, session_id, entry) when is_binary(workspace) do
    with {:ok, line} <- encode_line(entry),
         path <- transcript_path(workspace, session_id),
         :ok <- File.mkdir_p(Path.dirname(path)),
         :ok <- File.write(path, line <> "\n", [:append]) do
      :ok
    else
      {:error, reason} ->
        Logger.warning("SessionStore.append failed: #{inspect(reason)}")
        :ok

      :error ->
        :ok
    end
  rescue
    error ->
      Logger.warning("SessionStore.append crashed: #{Exception.message(error)}")
      :ok
  end

  @spec exists?(Path.t(), integer() | String.t()) :: boolean()
  def exists?(workspace, session_id) when is_binary(workspace) do
    workspace |> transcript_path(session_id) |> File.regular?()
  end

  @spec tail(Path.t(), keyword()) :: {:ok, [map()], non_neg_integer()} | {:error, term()}
  def tail(path, opts \\ []) when is_binary(path) and is_list(opts) do
    max_bytes = Keyword.get(opts, :max_bytes, @default_tail_bytes)

    case File.stat(path) do
      {:ok, %File.Stat{size: size}} when size > 0 ->
        read_chunk(path, max(size - max_bytes, 0), size)

      {:ok, %File.Stat{size: size}} ->
        {:ok, [], size}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec read_from(Path.t(), non_neg_integer()) ::
          {:ok, [map()], non_neg_integer()} | {:error, term()}
  def read_from(path, offset)
      when is_binary(path) and is_integer(offset) and offset >= 0 do
    case File.stat(path) do
      {:ok, %File.Stat{size: size}} when size > offset ->
        read_chunk(path, offset, size)

      {:ok, %File.Stat{size: size}} ->
        {:ok, [], size}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp encode_line(line) when is_binary(line), do: {:ok, String.trim_trailing(line)}
  defp encode_line(%{} = entry), do: Jason.encode(entry)
  defp encode_line(_), do: :error

  defp read_chunk(path, offset, size) do
    case File.open(path, [:read, :binary]) do
      {:ok, io} ->
        try do
          case :file.pread(io, offset, size - offset) do
            {:ok, binary} -> {:ok, decode_lines(binary), size}
            {:error, reason} -> {:error, reason}
          end
        after
          File.close(io)
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp decode_lines(binary) do
    binary
    |> String.split("\n", trim: true)
    |> Enum.flat_map(fn line ->
      case Jason.decode(line) do
        {:ok, %{} = entry} -> [entry]
        _ -> []
      end
    end)
  end
end
