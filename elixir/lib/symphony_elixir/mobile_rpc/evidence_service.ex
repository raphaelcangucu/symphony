defmodule SymphonyElixir.MobileRpc.EvidenceService do
  @moduledoc """
  Reads durable issue evidence without exposing host filesystem paths.

  Artifact bytes are returned in bounded chunks so they remain inside the
  authenticated application-layer encrypted mobile RPC channel.
  """

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Evidence.{Record, SessionCollector, Store}
  alias SymphonyElixir.MobileRpc.OrchestratorService

  @type result :: {:ok, map()} | {:error, term()}

  @spec call(String.t(), map(), map()) :: result()
  def call(
        "evidence.list",
        %{"project_slug" => project_slug, "identifier" => identifier},
        context
      ) do
    collector =
      Map.get(context, :mobile_session_evidence_collector, SessionCollector)

    _ = collector.collect(project_slug, identifier, context)

    with {:ok, records} <- Store.list(project_slug, identifier) do
      executions =
        context
        |> Map.get(:mobile_orchestrator_service, OrchestratorService)
        |> apply(:list_executions, [])

      history = Map.get(context, :mobile_evidence_history, History)

      {:ok,
       %{
         "records" => Enum.map(records, &present_record(&1, identifier, executions, history))
       }}
    end
  end

  def call(
        "evidence.artifact.read",
        %{
          "project_slug" => project_slug,
          "identifier" => identifier,
          "run_id" => run_id,
          "path" => relative_path,
          "offset" => offset,
          "length" => length
        },
        _context
      ) do
    with {:ok, records} <- Store.list(project_slug, identifier),
         {:ok, record} <- find_record(records, run_id),
         {:ok, absolute_path} <- resolve_artifact(record, relative_path),
         {:ok, stat} <- File.stat(absolute_path),
         :ok <- validate_offset(offset, stat.size),
         {:ok, bytes} <- read_chunk(absolute_path, offset, min(length, stat.size - offset)) do
      next_offset = offset + byte_size(bytes)

      {:ok,
       %{
         "content" => Base.encode64(bytes),
         "content_type" => MIME.from_path(absolute_path),
         "size" => stat.size,
         "offset" => offset,
         "next_offset" => next_offset,
         "eof" => next_offset >= stat.size
       }}
    else
      {:error, :run_not_found} ->
        rpc_error("evidence_run_not_found", "Evidence run was not found")

      {:error, :invalid_path} ->
        rpc_error("invalid_artifact_path", "Evidence artifact path is invalid")

      {:error, :not_found} ->
        rpc_error("artifact_not_found", "Evidence artifact was not found")

      {:error, :invalid_offset} ->
        rpc_error("invalid_artifact_offset", "Evidence artifact offset is beyond EOF")

      {:error, reason} ->
        {:error, reason}
    end
  end

  def call(_method, _params, _context),
    do: rpc_error("method_not_allowed", "Evidence RPC method is unavailable")

  defp present_record(%Record{} = record, identifier, executions, history) do
    %{
      "id" => record.id,
      "run_id" => record.run_id,
      "session_id" => record.session_id,
      "status" => record.status,
      "ui_change" => record.ui_change,
      "manifest" => record.manifest,
      "inserted_at" => record.inserted_at,
      "provenance" => provenance(record, identifier, executions, history)
    }
  end

  defp provenance(%Record{session_id: "assistant-thread:" <> raw_id}, _identifier, _executions, history) do
    with {thread_id, ""} <- Integer.parse(raw_id),
         {:ok, thread} <- history.get_thread(thread_id) do
      present_provenance("session", thread, thread_id, nil)
    else
      _reason -> nil
    end
  end

  defp provenance(%Record{} = record, identifier, executions, _history) do
    execution =
      Enum.find(executions, fn candidate ->
        value(candidate, :issue_identifier) == identifier and
          is_binary(record.session_id) and
          value(candidate, :session_id) == record.session_id
      end)

    if execution do
      present_provenance(
        "orchestrator",
        execution,
        nil,
        value(execution, :execution_session_id)
      )
    end
  end

  defp present_provenance(path, source, thread_id, execution_session_id) do
    %{
      "execution_path" => path,
      "agent_kind" => value(source, :agent_kind),
      "thread_id" => thread_id,
      "execution_session_id" => execution_session_id,
      "requested_model" => value(source, :requested_model),
      "requested_effort" => value(source, :requested_effort),
      "resolved_model" => value(source, :resolved_model),
      "resolved_effort" => value(source, :resolved_effort)
    }
  end

  defp find_record(records, run_id) do
    case Enum.find(records, &(&1.run_id == run_id)) do
      %Record{} = record -> {:ok, record}
      nil -> {:error, :run_not_found}
    end
  end

  defp resolve_artifact(record, relative_path) do
    case Store.resolve_artifact(record, relative_path) do
      {:ok, path} -> {:ok, path}
      {:error, reason} -> {:error, reason}
    end
  end

  defp validate_offset(offset, size) when offset <= size, do: :ok
  defp validate_offset(_offset, _size), do: {:error, :invalid_offset}

  defp read_chunk(_path, _offset, 0), do: {:ok, ""}

  defp read_chunk(path, offset, length) do
    with {:ok, io_device} <- File.open(path, [:read, :binary]) do
      try do
        case :file.pread(io_device, offset, length) do
          {:ok, bytes} -> {:ok, bytes}
          :eof -> {:ok, ""}
          {:error, reason} -> {:error, reason}
        end
      after
        File.close(io_device)
      end
    end
  end

  defp rpc_error(code, message),
    do: {:error, {:rpc_error, code, message, false, nil}}

  defp value(map, key), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))
end
