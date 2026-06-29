defmodule SymphonyElixirWeb.Presenter do
  @moduledoc """
  Shared projections for the observability API and dashboard.
  """

  use Gettext, backend: SymphonyElixirWeb.Gettext

  alias SymphonyElixir.{Config, Orchestrator, StatusDashboard}

  @empty_agent_totals %{
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    seconds_running: 0
  }

  @spec state_payload(GenServer.name(), timeout()) :: map()
  def state_payload(orchestrator, snapshot_timeout_ms),
    do: state_payload(orchestrator, snapshot_timeout_ms, nil)

  @spec state_payload(GenServer.name(), timeout(), String.t() | nil) :: map()
  def state_payload(orchestrator, snapshot_timeout_ms, project_slug)
      when is_nil(project_slug) or is_binary(project_slug) do
    generated_at = DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()

    case Orchestrator.snapshot(orchestrator, snapshot_timeout_ms) do
      %{} = snapshot ->
        build_state_payload(snapshot, generated_at, project_slug)

      :timeout ->
        %{
          generated_at: generated_at,
          error: %{code: "snapshot_timeout", message: dgettext("errors", "Snapshot timed out")}
        }

      :unavailable ->
        %{
          generated_at: generated_at,
          error: %{code: "snapshot_unavailable", message: dgettext("errors", "Snapshot unavailable")}
        }
    end
  end

  defp build_state_payload(snapshot, generated_at, project_slug) do
    running = scope_entries(snapshot.running, project_slug)
    retrying = scope_entries(snapshot.retrying, project_slug)

    %{
      generated_at: generated_at,
      counts: %{running: length(running), retrying: length(retrying)},
      running: Enum.map(running, &running_entry_payload/1),
      retrying: Enum.map(retrying, &retry_entry_payload/1),
      agent_totals: scope_agent_totals(snapshot, project_slug),
      rate_limits: snapshot.rate_limits
    }
  end

  defp scope_entries(entries, nil), do: entries

  defp scope_entries(entries, project_slug) when is_binary(project_slug),
    do: Enum.filter(entries, &(Map.get(&1, :project_slug) == project_slug))

  defp scope_agent_totals(snapshot, nil), do: snapshot.agent_totals

  defp scope_agent_totals(snapshot, project_slug) when is_binary(project_slug) do
    snapshot
    |> Map.get(:agent_totals_by_project, %{})
    |> Map.get(project_slug, @empty_agent_totals)
  end

  @spec issue_payload(String.t(), GenServer.name(), timeout()) :: {:ok, map()} | {:error, :issue_not_found}
  def issue_payload(issue_identifier, orchestrator, snapshot_timeout_ms) when is_binary(issue_identifier) do
    case Orchestrator.snapshot(orchestrator, snapshot_timeout_ms) do
      %{} = snapshot ->
        running = Enum.find(snapshot.running, &(&1.identifier == issue_identifier))
        retry = Enum.find(snapshot.retrying, &(&1.identifier == issue_identifier))

        if is_nil(running) and is_nil(retry) do
          {:error, :issue_not_found}
        else
          {:ok, issue_payload_body(issue_identifier, running, retry)}
        end

      _ ->
        {:error, :issue_not_found}
    end
  end

  @spec refresh_payload(GenServer.name()) :: {:ok, map()} | {:error, :unavailable}
  def refresh_payload(orchestrator) do
    case Orchestrator.request_refresh(orchestrator) do
      :unavailable ->
        {:error, :unavailable}

      payload ->
        {:ok, Map.update!(payload, :requested_at, &DateTime.to_iso8601/1)}
    end
  end

  defp issue_payload_body(issue_identifier, running, retry) do
    %{
      issue_identifier: issue_identifier,
      issue_id: issue_id_from_entries(running, retry),
      status: issue_status(running, retry),
      workspace: %{
        path: Path.join(Config.workspace_root(), issue_identifier)
      },
      attempts: %{
        restart_count: restart_count(retry),
        current_retry_attempt: retry_attempt(retry)
      },
      running: running && running_issue_payload(running),
      retry: retry && retry_issue_payload(retry),
      logs: %{
        codex_session_logs: []
      },
      recent_events: (running && recent_events_payload(running)) || [],
      last_error: retry && retry.error,
      tracked: %{}
    }
  end

  defp issue_id_from_entries(running, retry),
    do: (running && running.issue_id) || (retry && retry.issue_id)

  defp restart_count(retry), do: max(retry_attempt(retry) - 1, 0)
  defp retry_attempt(nil), do: 0
  defp retry_attempt(retry), do: retry.attempt || 0

  defp issue_status(_running, nil), do: "running"
  defp issue_status(nil, _retry), do: "retrying"
  defp issue_status(_running, _retry), do: "running"

  defp running_entry_payload(entry) do
    %{
      issue_id: entry.issue_id,
      issue_identifier: entry.identifier,
      project_slug: Map.get(entry, :project_slug),
      state: entry.state,
      session_id: entry.session_id,
      turn_count: Map.get(entry, :turn_count, 0),
      last_event: entry.last_codex_event,
      last_message: summarize_message(entry.last_codex_message),
      started_at: iso8601(entry.started_at),
      last_event_at: iso8601(entry.last_codex_timestamp),
      tokens: %{
        input_tokens: entry.agent_input_tokens,
        output_tokens: entry.agent_output_tokens,
        total_tokens: entry.agent_total_tokens
      },
      bundle_role: bundle_role_payload(Map.get(entry, :bundle_role)),
      parent_identifier: Map.get(entry, :parent_identifier),
      unit_id: Map.get(entry, :unit_id),
      child_identifiers: Map.get(entry, :child_identifiers) || []
    }
  end

  # The orchestrator tags each running entry with its bundle role as an atom
  # (`:child` / `:standalone`); normalize to the string the tracker frontend
  # consumes so the observability table can render the parent → child tree.
  defp bundle_role_payload(role) when is_atom(role) and not is_nil(role), do: Atom.to_string(role)
  defp bundle_role_payload(role) when is_binary(role), do: role
  defp bundle_role_payload(_role), do: nil

  defp retry_entry_payload(entry) do
    %{
      issue_id: entry.issue_id,
      issue_identifier: entry.identifier,
      project_slug: Map.get(entry, :project_slug),
      attempt: entry.attempt,
      due_at: due_at_iso8601(entry.due_in_ms),
      error: entry.error
    }
  end

  defp running_issue_payload(running) do
    %{
      session_id: running.session_id,
      turn_count: Map.get(running, :turn_count, 0),
      state: running.state,
      started_at: iso8601(running.started_at),
      last_event: running.last_codex_event,
      last_message: summarize_message(running.last_codex_message),
      last_event_at: iso8601(running.last_codex_timestamp),
      tokens: %{
        input_tokens: running.agent_input_tokens,
        output_tokens: running.agent_output_tokens,
        total_tokens: running.agent_total_tokens
      }
    }
  end

  defp retry_issue_payload(retry) do
    %{
      attempt: retry.attempt,
      due_at: due_at_iso8601(retry.due_in_ms),
      error: retry.error
    }
  end

  defp recent_events_payload(running) do
    [
      %{
        at: iso8601(running.last_codex_timestamp),
        event: running.last_codex_event,
        message: summarize_message(running.last_codex_message)
      }
    ]
    |> Enum.reject(&is_nil(&1.at))
  end

  defp summarize_message(nil), do: nil
  defp summarize_message(message), do: StatusDashboard.humanize_codex_message(message)

  defp due_at_iso8601(due_in_ms) when is_integer(due_in_ms) do
    DateTime.utc_now()
    |> DateTime.add(div(due_in_ms, 1_000), :second)
    |> DateTime.truncate(:second)
    |> DateTime.to_iso8601()
  end

  defp due_at_iso8601(_due_in_ms), do: nil

  defp iso8601(%DateTime{} = datetime) do
    datetime
    |> DateTime.truncate(:second)
    |> DateTime.to_iso8601()
  end

  defp iso8601(_datetime), do: nil
end
