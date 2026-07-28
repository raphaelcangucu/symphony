defmodule SymphonyElixir.Evidence.SessionCollector do
  @moduledoc """
  Promotes evidence written by ordinary direct issue sessions into durable
  task evidence.

  Orchestrator runs persist evidence in their completion pipeline. Direct
  assistant sessions use the assistant runtime, so their workspace manifests
  are reconciled when task evidence is requested.
  """

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Evidence.{Manifest, Store}

  @spec collect(String.t(), String.t(), map()) :: :ok | {:error, term()}
  def collect(project_slug, identifier, context)
      when is_binary(project_slug) and is_binary(identifier) and is_map(context) do
    history = Map.get(context, :mobile_evidence_history, History)
    store = Map.get(context, :mobile_evidence_store, Store)

    [scope: "issue_session", project_slug: project_slug, issue_identifier: identifier]
    |> history.list_threads()
    |> Enum.sort_by(&(value(&1, :id) || 0), :desc)
    |> Enum.reduce_while(:ok, fn thread, :ok ->
      case collect_thread(store, project_slug, identifier, thread) do
        :ok -> {:cont, :ok}
        :manifest_missing -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  def collect(_project_slug, _identifier, _context), do: {:error, :invalid_params}

  defp collect_thread(store, project_slug, identifier, thread) do
    workspace = value(thread, :workspace_path)
    thread_id = value(thread, :id)

    if is_binary(workspace) and workspace != "" and is_integer(thread_id) do
      case Manifest.read_snapshot(workspace) do
        {:ok, snapshot} ->
          case store.persist(project_slug, identifier, workspace, snapshot.map,
                 evidence_dir: snapshot.evidence_dir,
                 idempotent: true,
                 session_id: "assistant-thread:#{thread_id}"
               ) do
            {:ok, _record} -> :ok
            {:error, reason} -> {:error, reason}
          end

        {:error, :manifest_missing} ->
          :manifest_missing

        {:error, reason} ->
          {:error, reason}
      end
    else
      :manifest_missing
    end
  end

  defp value(map, key), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))
end
