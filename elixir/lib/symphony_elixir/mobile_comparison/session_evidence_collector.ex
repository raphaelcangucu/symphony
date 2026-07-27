defmodule SymphonyElixir.MobileComparison.SessionEvidenceCollector do
  @moduledoc """
  Promotes evidence written by direct assistant sessions into durable storage.

  Orchestrator runs already persist evidence during their completion pipeline.
  Issue sessions use the assistant channel directly, so their workspace
  manifests are collected lazily when a comparison snapshot requests them.
  """

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Evidence.{Manifest, Store}

  @spec collect(String.t(), String.t(), map()) :: :ok | {:error, term()}
  def collect(project_slug, identifier, context)
      when is_binary(project_slug) and is_binary(identifier) and is_map(context) do
    history = Map.get(context, :comparison_history, History)
    store = Map.get(context, :comparison_evidence_store, Store)

    [scope: "issue_session", project_slug: project_slug, issue_identifier: identifier]
    |> history.list_threads()
    |> Enum.sort_by(&(value(&1, :id) || 0), :desc)
    |> Enum.reduce_while(:ok, fn thread, _result ->
      case collect_thread(store, project_slug, identifier, thread) do
        :manifest_missing -> {:cont, :ok}
        :ok -> {:halt, :ok}
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
