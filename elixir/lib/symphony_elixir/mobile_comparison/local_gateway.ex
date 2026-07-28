defmodule SymphonyElixir.MobileComparison.LocalGateway do
  @moduledoc """
  Production comparison gateway backed by existing Symphony host services.

  Task and session mutations pass through the same allowlisted tracker bridge
  used by encrypted mobile RPC. Agent turns use the existing assistant channel
  state machine, while snapshots reuse orchestrator, preview, and evidence
  presenters.
  """

  @behaviour SymphonyElixir.MobileComparison.Gateway

  alias SymphonyElixir.Assistant.History

  alias SymphonyElixir.MobileComparison.{
    Contract,
    Decision,
    SessionEvidenceCollector,
    SessionStarter
  }

  alias SymphonyElixir.MobileRpc.{EvidenceService, OrchestratorService, TrackerBridge}

  @cell_marker ~r/^\[dev10x-comparison:([a-z0-9-]+)\]\s*/

  @impl true
  def get_parent(project_slug, identifier, context) do
    request(context, :tasks, "GET", issue_path(project_slug, identifier))
    |> unwrap_data()
  end

  @impl true
  def list_children(project_slug, parent_identifier, context) do
    with {:ok, children} <-
           request(
             context,
             :tasks,
             "GET",
             issue_path(project_slug, parent_identifier) <> "/subtasks"
           )
           |> unwrap_data(),
         true <- is_list(children) do
      {:ok, Enum.map(children, &put_cell_identity/1)}
    else
      false -> {:error, :invalid_subtask_response}
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def create_child(project_slug, parent_identifier, cell, prompt, context) do
    body = %{
      "title" => "[dev10x-comparison:#{cell.id}] #{cell.title}",
      "description" => prompt,
      "status" => "Backlog",
      "agent" => cell.provider,
      "model" => cell.model,
      "effort" => cell.effort,
      "mode" => "yolo"
    }

    request(
      context,
      :tasks,
      "POST",
      issue_path(project_slug, parent_identifier) <> "/subtasks",
      body,
      idempotency_key(context, cell.id, "child")
    )
    |> unwrap_data()
    |> map_ok(&put_cell_identity/1)
  end

  @impl true
  def ensure_session(project_slug, child, cell, context) do
    case get_session(project_slug, child, cell, context) do
      {:ok, thread} ->
        {:ok, thread}

      {:error, :not_found} ->
        create_session(project_slug, child, cell, context)

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl true
  def get_session(project_slug, child, cell, context) do
    history = Map.get(context, :comparison_history, History)
    identifier = value(child, :identifier)

    matching_threads =
      [
        scope: "issue_session",
        project_slug: project_slug,
        issue_identifier: identifier,
        include_archived: true,
        limit: 100
      ]
      |> history.list_threads()
      |> Enum.filter(&session_matches?(&1, cell))
      |> Enum.sort_by(&(value(&1, :id) || 0), :desc)

    thread =
      matching_threads
      |> Enum.find(&(value(&1, :status) != "archived"))
      |> put_retry_attempt(length(matching_threads))

    case thread do
      nil ->
        {:error, :not_found}

      existing ->
        with {:ok, persisted} <- ensure_session_provenance(existing, cell, context) do
          {:ok, maybe_mark_ready(persisted, context)}
        end
    end
  end

  @impl true
  def start_session(thread, prompt, context) do
    context
    |> Map.get(:comparison_session_starter, SessionStarter)
    |> apply(:start, [thread, prompt, context])
  end

  @impl true
  def retry_session(project_slug, child, cell, prompt, context) do
    history = Map.get(context, :comparison_history, History)

    with {:ok, thread} <- get_session(project_slug, child, cell, context),
         {:ok, _archived} <- history.archive_thread(value(thread, :id)),
         {:ok, replacement} <-
           create_session(project_slug, child, cell, context, "thread-retry"),
         :ok <- start_session(replacement, prompt, context) do
      :ok
    end
  end

  @impl true
  def dispatch_child(project_slug, child, context) do
    identifier = value(child, :identifier)
    cell_id = value(child, :comparison_cell_id)
    settings = child_settings(child, cell_id)

    body = %{
      "action" => "continue_work",
      "agent" => settings.provider,
      "model" => settings.model,
      "effort" => settings.effort,
      "mode" => "yolo"
    }

    case request(
           context,
           :tasks,
           "POST",
           issue_path(project_slug, identifier) <> "/dispatch",
           body,
           idempotency_key(context, cell_id || identifier, "dispatch")
         ) do
      {:ok, _payload} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def retry_child(project_slug, child, context) do
    identifier = value(child, :identifier)
    cell_id = value(child, :comparison_cell_id)
    settings = child_settings(child, cell_id)

    body = %{
      "action" => "hard_reset",
      "instructions" => "Retry this Dev10x comparison cell from the preserved workspace.",
      "agent" => settings.provider,
      "model" => settings.model,
      "effort" => settings.effort,
      "mode" => "yolo"
    }

    case request(
           context,
           :tasks,
           "POST",
           issue_path(project_slug, identifier) <> "/dispatch",
           body,
           idempotency_key(context, cell_id || identifier, "retry")
         ) do
      {:ok, _payload} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def list_executions(context) do
    service =
      Map.get(
        context,
        :comparison_execution_service,
        OrchestratorService
      )

    {:ok, service.list_executions()}
  end

  @impl true
  def list_previews(thread, context) do
    thread_id = value(thread, :id)

    request(
      context,
      :previews,
      "GET",
      "/assistant/threads/#{thread_id}/dev_servers"
    )
    |> unwrap_data()
    |> extract_preview_servers()
  end

  @impl true
  def list_evidence(project_slug, identifier, context) do
    service = Map.get(context, :mobile_evidence_service, EvidenceService)

    case evidence_records(service, project_slug, identifier, context) do
      {:ok, records} ->
        if evidence_collection_required?(records, context) do
          collect_session_evidence(service, project_slug, identifier, context)
        else
          {:ok, records}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp collect_session_evidence(service, project_slug, identifier, context) do
    collector =
      Map.get(
        context,
        :comparison_session_evidence_collector,
        SessionEvidenceCollector
      )

    with :ok <- collector.collect(project_slug, identifier, context) do
      evidence_records(service, project_slug, identifier, context)
    end
  end

  defp evidence_collection_required?(records, context) do
    case Map.get(context, :comparison_session_id) do
      thread_id when is_integer(thread_id) and thread_id > 0 ->
        session_state =
          Map.get(context, :comparison_session_turn_status) ||
            Map.get(context, :comparison_session_status)

        if terminal_session?(session_state) do
          expected_session_id = "assistant-thread:#{thread_id}"

          records
          |> Enum.filter(&(value(&1, :session_id) == expected_session_id))
          |> case do
            [] -> true
            current_records -> Enum.all?(current_records, &partial_evidence?/1)
          end
        else
          false
        end

      _other ->
        records == []
    end
  end

  defp terminal_session?(status),
    do: status in ["completed", "failed", "error", "cancelled", "canceled", "closed", "archived"]

  defp partial_evidence?(record) do
    case value(record, :manifest) do
      manifest when is_map(manifest) -> value(manifest, :runs) in [nil, []]
      _other -> false
    end
  end

  @impl true
  def save_decision(project_slug, identifier, decision, context) do
    with {:ok, parent} <- get_parent(project_slug, identifier, context),
         description <- Decision.put(value(parent, :description), decision),
         {:ok, _response} <-
           request(
             context,
             :tasks,
             "PATCH",
             issue_path(project_slug, identifier),
             %{"description" => description}
           ) do
      :ok
    end
  end

  defp evidence_records(service, project_slug, identifier, context) do
    case service.call(
           "evidence.list",
           %{"project_slug" => project_slug, "identifier" => identifier},
           context
         ) do
      {:ok, %{"records" => records}} when is_list(records) -> {:ok, records}
      {:ok, _payload} -> {:error, :invalid_evidence_response}
      {:error, reason} -> {:error, reason}
    end
  end

  defp request(context, domain, method, path, body \\ nil, idempotency_key \\ nil) do
    bridge = Map.get(context, :comparison_tracker_bridge, TrackerBridge)

    request =
      %{
        "method" => method,
        "path" => path
      }
      |> maybe_put("body", body)
      |> maybe_put("idempotency_key", idempotency_key)

    bridge.request(domain, request, context)
  end

  defp unwrap_data({:ok, %{"data" => data}}), do: {:ok, data}
  defp unwrap_data({:ok, _payload}), do: {:error, :invalid_tracker_response}
  defp unwrap_data({:error, reason}), do: {:error, reason}

  defp map_ok({:ok, value}, mapper), do: {:ok, mapper.(value)}
  defp map_ok({:error, reason}, _mapper), do: {:error, reason}

  defp extract_preview_servers({:ok, %{"servers" => servers}}) when is_list(servers),
    do: {:ok, servers}

  defp extract_preview_servers({:ok, _payload}), do: {:error, :invalid_preview_response}
  defp extract_preview_servers({:error, reason}), do: {:error, reason}

  defp maybe_mark_ready(thread, context) do
    history = Map.get(context, :comparison_history, History)
    thread_id = value(thread, :id)

    turn = current_turn(thread)

    case value(turn, :status) do
      "running" ->
        put_value(thread, :status, "active")

      status when status in ["interrupted", "failed"] ->
        thread
        |> put_value(:status, "error")
        |> put_value(:error, value(turn, :interrupted_reason) || value(turn, :error))

      _other ->
        mark_from_messages(thread, history.list_messages_for_thread(thread_id))
    end
  end

  defp mark_from_messages(thread, []), do: put_value(thread, :status, "ready")

  defp mark_from_messages(thread, messages) do
    case latest_assistant_message(messages) do
      nil -> thread
      message -> put_value(thread, :latest_message, value(message, :content))
    end
  end

  defp current_turn(thread) do
    case value(thread, :metadata) do
      %{} = metadata ->
        case value(metadata, :current_turn) do
          %{} = turn -> turn
          _other -> nil
        end

      _other ->
        nil
    end
  end

  defp put_retry_attempt(nil, _thread_count), do: nil

  defp put_retry_attempt(thread, thread_count),
    do: put_value(thread, :retry_attempt, max(thread_count - 1, 0))

  defp latest_assistant_message(messages) do
    messages
    |> Enum.filter(&(value(&1, :role) == "assistant"))
    |> Enum.sort_by(&(value(&1, :sequence) || 0), :desc)
    |> List.first()
  end

  defp session_matches?(thread, cell) do
    provider_matches? =
      value(thread, :agent_kind) in [nil, cell.provider]

    model_matches? =
      value(thread, :requested_model) in [nil, cell.model]

    provider_matches? and model_matches?
  end

  defp create_session(project_slug, child, cell, context, idempotency_suffix \\ "thread") do
    body = %{
      "scope" => "issue_session",
      "project_slug" => project_slug,
      "issue_identifier" => value(child, :identifier),
      "agent_kind" => cell.provider,
      "model" => cell.model,
      "effort" => cell.effort,
      "execution_mode" => "yolo",
      "isolated_workspace" => true
    }

    with {:ok, thread} <-
           request(
             context,
             :sessions,
             "POST",
             "/assistant/threads",
             body,
             idempotency_key(context, cell.id, idempotency_suffix)
           )
           |> unwrap_data(),
         {:ok, persisted} <- ensure_session_provenance(thread, cell, context) do
      {:ok, maybe_mark_ready(persisted, context)}
    end
  end

  defp ensure_session_provenance(thread, cell, context) do
    expected = %{
      requested_model: cell.model,
      requested_effort: canonical_requested_effort(cell)
    }

    if session_provenance_matches?(thread, expected) do
      {:ok, thread}
    else
      history = Map.get(context, :comparison_history, History)

      with {:ok, persisted_thread} <- history.get_thread(value(thread, :id)),
           {:ok, updated} <- history.put_model_provenance(persisted_thread, expected),
           true <- session_provenance_matches?(updated, expected) do
        {:ok, updated}
      else
        false -> {:error, :session_provenance_not_persisted}
        {:error, reason} -> {:error, reason}
        _unexpected -> {:error, :session_provenance_not_persisted}
      end
    end
  end

  defp session_provenance_matches?(thread, expected) do
    value(thread, :requested_model) == expected.requested_model and
      value(thread, :requested_effort) == expected.requested_effort
  end

  defp canonical_requested_effort(%{provider: "cursor"}), do: nil
  defp canonical_requested_effort(cell), do: cell.effort

  defp put_cell_identity(child) do
    case cell_id_from_title(value(child, :title)) do
      nil -> child
      cell_id -> put_value(child, :comparison_cell_id, cell_id)
    end
  end

  defp cell_id_from_title(title) when is_binary(title) do
    case Regex.run(@cell_marker, title, capture: :all_but_first) do
      [cell_id] ->
        case Contract.fetch(cell_id) do
          {:ok, _cell} -> cell_id
          {:error, :unknown_cell} -> nil
        end

      _match ->
        nil
    end
  end

  defp cell_id_from_title(_title), do: nil

  defp child_settings(child, cell_id) do
    case value(child, :agent_kind) do
      provider when is_binary(provider) and provider != "" ->
        %{
          provider: provider,
          model: value(child, :requested_model),
          effort: value(child, :requested_effort)
        }

      _missing ->
        case Contract.fetch(cell_id || "") do
          {:ok, cell} -> cell
          {:error, :unknown_cell} -> %{provider: nil, model: nil, effort: nil}
        end
    end
  end

  defp idempotency_key(context, cell_id, suffix) do
    context
    |> Map.fetch!(:comparison_request_key)
    |> then(&"#{&1}:#{cell_id}:#{suffix}")
  end

  defp issue_path(project_slug, identifier),
    do: "/projects/#{segment(project_slug)}/issues/#{segment(identifier)}"

  defp segment(value), do: URI.encode(to_string(value), &URI.char_unreserved?/1)

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp value(nil, _key), do: nil
  defp value(map, key), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))

  defp put_value(map, key, value) do
    if Map.has_key?(map, key) do
      Map.put(map, key, value)
    else
      Map.put(map, Atom.to_string(key), value)
    end
  end
end
