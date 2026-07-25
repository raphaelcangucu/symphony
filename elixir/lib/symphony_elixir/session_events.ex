defmodule SymphonyElixir.SessionEvents do
  @moduledoc """
  Symphony-authored session log annotations stored in each workspace.

  Agent backends (Codex, Claude, Cursor) own their native rollout logs. When
  Symphony stops a run it records the exact reason here so the session log UI
  can show it alongside native events.
  """

  @events_relative_path ".symphony/session-events.jsonl"
  @default_tail_bytes 65_536

  @spec events_path(Path.t()) :: Path.t()
  def events_path(workspace) when is_binary(workspace), do: Path.join(workspace, @events_relative_path)

  @doc """
  Clears Symphony-authored session annotations for a workspace.

  Native agent rollout logs remain intact; this only removes Symphony's local
  failure/abort annotations so an explicit new-thread reset starts with a clean
  execution transcript.
  """
  @spec clear(Path.t()) :: :ok
  def clear(workspace) when is_binary(workspace) do
    workspace
    |> events_path()
    |> File.rm()
    |> case do
      :ok -> :ok
      {:error, :enoent} -> :ok
      {:error, _reason} -> :ok
    end
  end

  @doc """
  Appends a turn-abort annotation to the workspace session-events file.
  """
  @spec append_abort(Path.t(), String.t(), keyword()) :: :ok
  def append_abort(workspace, reason, opts \\ []) when is_binary(workspace) and is_binary(reason) do
    reason = String.trim(reason)

    if reason == "" do
      :ok
    else
      detail = Keyword.get(opts, :detail)
      body = format_abort_body(reason, detail)

      append_entry(workspace, %{
        "kind" => "event",
        "title" => "Turn aborted",
        "body" => body,
        "status" => "failed",
        "collapsed" => false,
        "source" => "symphony",
        "abort_reason" => reason
      })
    end
  end

  @doc """
  Appends a worker crash report with message and stack trace to the session log.
  """
  @spec append_worker_crash(Path.t(), term(), list()) :: :ok
  def append_worker_crash(workspace, reason, stacktrace \\ [])
      when is_binary(workspace) do
    body = SymphonyElixir.WorkerFailure.format(reason, stacktrace)

    append_entry(workspace, %{
      "kind" => "event",
      "title" => "Worker crashed",
      "body" => body,
      "language" => "text",
      "status" => "failed",
      "collapsed" => false,
      "source" => "symphony",
      "abort_reason" => "worker_crash"
    })
  end

  @doc """
  Appends a handled agent run failure (non-crash) to the session log.
  """
  @spec append_run_failure(Path.t(), term()) :: :ok
  def append_run_failure(workspace, reason) when is_binary(workspace) do
    body = SymphonyElixir.WorkerFailure.format(reason)

    append_entry(workspace, %{
      "kind" => "event",
      "title" => "Agent run failed",
      "body" => body,
      "language" => "text",
      "status" => "failed",
      "collapsed" => false,
      "source" => "symphony",
      "abort_reason" => "run_failed"
    })
  end

  @doc """
  Appends a lifecycle boundary when an existing execution is resumed.

  Earlier failure annotations remain available for audit, while consumers can
  distinguish them from the state of the newly resumed run.
  """
  @spec append_resume(Path.t()) :: :ok
  def append_resume(workspace) when is_binary(workspace) do
    append_entry(workspace, %{
      "kind" => "event",
      "title" => "Run resumed",
      "body" => "Execution resumed",
      "status" => "running",
      "collapsed" => true,
      "source" => "symphony"
    })
  end

  @spec tail(Path.t(), keyword()) :: {:ok, [map()], non_neg_integer()}
  def tail(workspace, opts \\ []) when is_binary(workspace) do
    path = events_path(workspace)
    max_bytes = Keyword.get(opts, :max_bytes, @default_tail_bytes)

    case File.stat(path) do
      {:ok, %File.Stat{size: size}} when size > 0 ->
        start = max(size - max_bytes, 0)
        read_chunk(path, start, size)

      _ ->
        {:ok, [], 0}
    end
  end

  @spec read_from(Path.t(), non_neg_integer()) :: {:ok, [map()], non_neg_integer()} | {:error, term()}
  def read_from(workspace, offset) when is_binary(workspace) and is_integer(offset) and offset >= 0 do
    path = events_path(workspace)

    case File.stat(path) do
      {:ok, %File.Stat{size: size}} when size > offset ->
        read_chunk(path, offset, size)

      {:ok, %File.Stat{size: size}} ->
        {:ok, [], size}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc false
  @spec merge_entries([map()], [map()]) :: [map()]
  def merge_entries(agent_entries, symphony_entries) when is_list(agent_entries) and is_list(symphony_entries) do
    agent_entries ++ symphony_entries
  end

  @spec append_entry(Path.t(), map()) :: :ok
  defp append_entry(workspace, entry) when is_binary(workspace) and is_map(entry) do
    path = events_path(workspace)
    File.mkdir_p!(Path.dirname(path))

    line =
      entry
      |> Map.put("timestamp", DateTime.utc_now() |> DateTime.to_iso8601())
      |> Jason.encode!()

    File.write!(path, line <> "\n", [:append])
    :ok
  end

  defp read_chunk(path, offset, size) do
    case File.open(path, [:read, :binary]) do
      {:ok, io} ->
        try do
          :file.pread(io, offset, size - offset)
          |> case do
            {:ok, binary} -> split_lines(binary, size)
            {:error, reason} -> {:error, reason}
          end
        after
          File.close(io)
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp split_lines(binary, size) when is_binary(binary) do
    entries =
      binary
      |> String.split("\n", trim: false)
      |> Enum.map(&parse_line/1)
      |> Enum.reject(&is_nil/1)

    {:ok, entries, size}
  end

  @spec parse_line(String.t()) :: map() | nil
  defp parse_line(line) when is_binary(line) do
    trimmed = String.trim(line)

    if trimmed == "" do
      nil
    else
      case Jason.decode(trimmed) do
        {:ok, %{"title" => _} = entry} -> entry
        _ -> nil
      end
    end
  end

  defp parse_line(_line), do: nil

  defp format_abort_body(reason, detail) do
    base = "Reason: #{reason}"

    case detail do
      detail when is_binary(detail) and detail != "" -> base <> "\n" <> detail
      _ -> base
    end
  end
end
