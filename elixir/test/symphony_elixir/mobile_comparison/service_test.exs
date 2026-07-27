defmodule SymphonyElixir.MobileComparison.ServiceTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileComparison.{Contract, Service}

  defmodule FakeGateway do
    @behaviour SymphonyElixir.MobileComparison.Gateway

    @spec start_link(keyword()) :: Agent.on_start()
    def start_link(opts \\ []) do
      Agent.start_link(fn ->
        %{
          parent:
            Keyword.get(opts, :parent, %{
              identifier: "DEV-1",
              project_slug: "dev10x",
              title: "Build the Dev10x landing",
              description: "Create and validate the landing page.",
              status: "Backlog"
            }),
          children: %{},
          sessions: %{},
          session_starts: MapSet.new(),
          session_start_calls: %{},
          session_retries: MapSet.new(),
          dispatches: MapSet.new(),
          dispatch_calls: %{},
          orchestrator_retries: MapSet.new(),
          decision: nil,
          execution_failures: %{},
          failures: %{}
        }
      end)
    end

    @spec child_spec(keyword()) :: Supervisor.child_spec()
    def child_spec(opts) do
      %{
        id: __MODULE__,
        start: {__MODULE__, :start_link, [opts]},
        type: :worker
      }
    end

    @impl true
    def get_parent("dev10x", "DEV-1", context) do
      {:ok, Agent.get(context.comparison_gateway_state, & &1.parent)}
    end

    @impl true
    def list_children("dev10x", "DEV-1", context) do
      {:ok,
       context.comparison_gateway_state
       |> Agent.get(& &1.children)
       |> Map.values()}
    end

    @impl true
    def create_child("dev10x", "DEV-1", cell, prompt, context) do
      if is_binary(context[:comparison_request_key]) do
        Agent.get_and_update(context.comparison_gateway_state, fn state ->
          identifier = "DEV-#{map_size(state.children) + 2}"

          child = %{
            identifier: identifier,
            project_slug: "dev10x",
            parent_identifier: "DEV-1",
            comparison_cell_id: cell.id,
            title: "[dev10x-comparison:#{cell.id}] #{cell.title}",
            description: prompt,
            status: "Backlog",
            agent_kind: cell.provider,
            requested_model: cell.model,
            requested_effort: cell.effort,
            comparison_request_key: context.comparison_request_key
          }

          {{:ok, child}, put_in(state.children[cell.id], child)}
        end)
      else
        {:error, :comparison_request_key_missing}
      end
    end

    @impl true
    def ensure_session("dev10x", child, cell, context) do
      Agent.get_and_update(context.comparison_gateway_state, fn state ->
        case Map.get(state.sessions, cell.id) do
          nil ->
            thread = %{
              id: 100 + map_size(state.sessions),
              issue_identifier: child.identifier,
              status: "ready",
              requested_model: cell.model,
              requested_effort: cell.effort,
              resolved_model: nil,
              resolved_effort: nil,
              latest_message: nil
            }

            {{:ok, thread}, put_in(state.sessions[cell.id], thread)}

          thread ->
            {{:ok, thread}, state}
        end
      end)
    end

    @impl true
    def get_session("dev10x", child, cell, context) do
      session =
        Agent.get(
          context.comparison_gateway_state,
          &Map.get(&1.sessions, cell.id)
        )

      case session do
        nil -> {:error, :not_found}
        thread when thread.issue_identifier == child.identifier -> {:ok, thread}
      end
    end

    @impl true
    def start_session(thread, _prompt, context) do
      Agent.get_and_update(context.comparison_gateway_state, fn state ->
        cell_id =
          Enum.find_value(state.sessions, fn {candidate, session} ->
            if session.id == thread.id, do: candidate
          end)

        called =
          update_in(state, [:session_start_calls, thread.id], &((&1 || 0) + 1))

        case Map.get(called.failures, {:start_session, cell_id}, 0) do
          remaining when remaining > 0 ->
            failed =
              update_in(
                called,
                [:failures, {:start_session, cell_id}],
                &(&1 - 1)
              )

            {{:error, {:injected_failure, :start_session, cell_id}}, failed}

          _remaining ->
            started =
              called
              |> put_in([:sessions, cell_id, :status], "active")
              |> Map.update!(:session_starts, &MapSet.put(&1, thread.id))

            {:ok, started}
        end
      end)
    end

    @impl true
    def retry_session("dev10x", child, cell, _prompt, context) do
      Agent.update(context.comparison_gateway_state, fn state ->
        retried =
          state
          |> Map.update!(:session_retries, &MapSet.put(&1, child.identifier))
          |> put_in([:sessions, cell.id, :status], "active")
          |> put_in([:sessions, cell.id, :error], nil)

        retried
      end)

      :ok
    end

    @impl true
    def dispatch_child("dev10x", child, context) do
      Agent.update(context.comparison_gateway_state, fn state ->
        state
        |> Map.update!(:dispatches, &MapSet.put(&1, child.identifier))
        |> update_in([:dispatch_calls, child.identifier], &((&1 || 0) + 1))
      end)

      :ok
    end

    @impl true
    def retry_child("dev10x", child, context) do
      Agent.update(context.comparison_gateway_state, fn state ->
        state
        |> Map.update!(:orchestrator_retries, &MapSet.put(&1, child.identifier))
        |> Map.update!(:dispatches, &MapSet.put(&1, child.identifier))
        |> update_in([:execution_failures], &Map.delete(&1, child.identifier))
      end)

      :ok
    end

    @impl true
    def list_executions(context) do
      {:ok,
       Agent.get(context.comparison_gateway_state, fn state ->
         Enum.map(state.dispatches, fn identifier ->
           %{
             issue_identifier: identifier,
             status: Map.get(state.execution_failures, identifier, "live"),
             execution_session_id: "execution-#{identifier}",
             resolved_model: nil,
             resolved_effort: nil,
             latest_message: nil,
             error:
               if(Map.has_key?(state.execution_failures, identifier),
                 do: "provider disconnected",
                 else: nil
               ),
             retry_attempt: 0
           }
         end)
       end)}
    end

    @impl true
    def list_previews(thread, _context) do
      {:ok,
       [
         %{
           "id" => "preview-#{Map.get(thread, :id, Map.get(thread, "id"))}",
           "status" => "ready"
         }
       ]}
    end

    @impl true
    def list_evidence(_project_slug, _identifier, _context), do: {:ok, []}

    @impl true
    def save_decision("dev10x", "DEV-1", decision, context) do
      Agent.update(context.comparison_gateway_state, fn state ->
        description =
          SymphonyElixir.MobileComparison.Decision.put(
            state.parent.description,
            decision
          )

        state
        |> Map.put(:decision, decision)
        |> put_in([:parent, :description], description)
      end)

      :ok
    end

    @spec counts(pid()) :: map()
    def counts(state) do
      Agent.get(state, fn current ->
        %{
          children: map_size(current.children),
          sessions: map_size(current.sessions),
          session_starts: MapSet.size(current.session_starts),
          session_start_calls: current.session_start_calls |> Map.values() |> Enum.sum(),
          dispatches: MapSet.size(current.dispatches),
          dispatch_calls: current.dispatch_calls |> Map.values() |> Enum.sum(),
          session_retries: MapSet.size(current.session_retries),
          orchestrator_retries: MapSet.size(current.orchestrator_retries)
        }
      end)
    end

    @spec fail_cell(pid(), String.t(), String.t()) :: :ok
    def fail_cell(state, cell_id, error) do
      Agent.update(state, fn current ->
        if String.starts_with?(cell_id, "session-") do
          current
          |> put_in([:sessions, cell_id, :status], "error")
          |> put_in([:sessions, cell_id, :error], error)
        else
          identifier = Map.fetch!(current.children, cell_id).identifier
          put_in(current, [:execution_failures, identifier], "failed")
        end
      end)
    end

    @spec fail_once(pid(), atom(), String.t()) :: :ok
    def fail_once(state, operation, cell_id) do
      Agent.update(state, &put_in(&1, [:failures, {operation, cell_id}], 1))
    end
  end

  setup do
    state = start_supervised!(FakeGateway)

    context = %{
      comparison_gateway: FakeGateway,
      comparison_gateway_state: state
    }

    %{context: context, state: state}
  end

  test "starts exactly three real sessions and three orchestrator children", %{
    context: context,
    state: state
  } do
    assert {:ok, snapshot} =
             Service.start(
               %{
                 "project_slug" => "dev10x",
                 "identifier" => "DEV-1",
                 "request_key" => "mobile-e2e-1"
               },
               context
             )

    assert snapshot["identifier"] == "DEV-1"
    assert snapshot["progress"] == %{"terminal" => 0, "passed" => 0, "failed" => 0, "total" => 6}
    assert Enum.map(snapshot["cells"], & &1["id"]) == Enum.map(Contract.cells(), & &1.id)

    assert Enum.all?(
             Agent.get(state, &Map.values(&1.children)),
             &(&1.comparison_request_key == "mobile-e2e-1")
           )

    assert FakeGateway.counts(state) == %{
             children: 6,
             sessions: 3,
             session_starts: 3,
             session_start_calls: 3,
             dispatches: 3,
             dispatch_calls: 3,
             session_retries: 0,
             orchestrator_retries: 0
           }
  end

  test "repeating start reconciles without restarting sessions or redispatching children", %{
    context: context,
    state: state
  } do
    params = %{
      "project_slug" => "dev10x",
      "identifier" => "DEV-1",
      "request_key" => "mobile-e2e-1"
    }

    assert {:ok, first} = Service.start(params, context)
    assert {:ok, second} = Service.start(params, context)
    assert first["identifier"] == second["identifier"]

    assert FakeGateway.counts(state) == %{
             children: 6,
             sessions: 3,
             session_starts: 3,
             session_start_calls: 3,
             dispatches: 3,
             dispatch_calls: 3,
             session_retries: 0,
             orchestrator_retries: 0
           }
  end

  test "resumes a partial start without duplicating completed work", %{
    context: context,
    state: state
  } do
    FakeGateway.fail_once(state, :start_session, "session-cursor")

    params = %{
      "project_slug" => "dev10x",
      "identifier" => "DEV-1",
      "request_key" => "mobile-e2e-partial"
    }

    assert {:error, {:injected_failure, :start_session, "session-cursor"}} =
             Service.start(params, context)

    assert FakeGateway.counts(state) == %{
             children: 2,
             sessions: 2,
             session_starts: 1,
             session_start_calls: 2,
             dispatches: 0,
             dispatch_calls: 0,
             session_retries: 0,
             orchestrator_retries: 0
           }

    assert {:ok, snapshot} = Service.start(params, context)
    assert length(snapshot["cells"]) == 6

    assert FakeGateway.counts(state) == %{
             children: 6,
             sessions: 3,
             session_starts: 3,
             session_start_calls: 4,
             dispatches: 3,
             dispatch_calls: 3,
             session_retries: 0,
             orchestrator_retries: 0
           }
  end

  test "reads an existing comparison without causing provider side effects", %{
    context: context,
    state: state
  } do
    assert {:ok, _started} =
             Service.start(
               %{
                 "project_slug" => "dev10x",
                 "identifier" => "DEV-1",
                 "request_key" => "mobile-e2e-read"
               },
               context
             )

    before = FakeGateway.counts(state)

    assert {:ok, snapshot} =
             Service.get(
               %{"project_slug" => "dev10x", "identifier" => "DEV-1"},
               context
             )

    assert length(snapshot["cells"]) == 6
    assert FakeGateway.counts(state) == before
  end

  test "loads previews from orchestrator execution sessions on start and refresh", %{
    context: context
  } do
    params = %{
      "project_slug" => "dev10x",
      "identifier" => "DEV-1",
      "request_key" => "mobile-e2e-preview"
    }

    assert {:ok, started} = Service.start(params, context)

    assert Enum.find(started["cells"], &(&1["id"] == "orchestrator-codex"))["previews"] ==
             [%{"id" => "preview-execution-DEV-5", "status" => "ready"}]

    assert {:ok, refreshed} =
             Service.get(
               %{"project_slug" => "dev10x", "identifier" => "DEV-1"},
               context
             )

    assert Enum.find(refreshed["cells"], &(&1["id"] == "orchestrator-codex"))["previews"] ==
             [%{"id" => "preview-execution-DEV-5", "status" => "ready"}]
  end

  test "retries only a failed canonical cell and preserves the other five", %{
    context: context,
    state: state
  } do
    start_params = %{
      "project_slug" => "dev10x",
      "identifier" => "DEV-1",
      "request_key" => "mobile-e2e-retry"
    }

    assert {:ok, _snapshot} = Service.start(start_params, context)
    FakeGateway.fail_cell(state, "session-codex", "provider disconnected")

    assert {:ok, retried} =
             Service.retry_cell(
               Map.put(start_params, "cell_id", "session-codex"),
               context
             )

    assert Enum.find(retried["cells"], &(&1["id"] == "session-codex"))["status"] == "live"

    assert FakeGateway.counts(state) == %{
             children: 6,
             sessions: 3,
             session_starts: 3,
             session_start_calls: 3,
             dispatches: 3,
             dispatch_calls: 3,
             session_retries: 1,
             orchestrator_retries: 0
           }

    FakeGateway.fail_cell(state, "orchestrator-claude", "provider disconnected")

    assert {:ok, retried} =
             Service.retry_cell(
               Map.put(start_params, "cell_id", "orchestrator-claude"),
               context
             )

    assert Enum.find(retried["cells"], &(&1["id"] == "orchestrator-claude"))[
             "status"
           ] == "live"

    assert FakeGateway.counts(state) == %{
             children: 6,
             sessions: 3,
             session_starts: 3,
             session_start_calls: 3,
             dispatches: 3,
             dispatch_calls: 3,
             session_retries: 1,
             orchestrator_retries: 1
           }

    assert {:error, :cell_not_retryable} =
             Service.retry_cell(
               Map.put(start_params, "cell_id", "session-cursor"),
               context
             )

    assert {:error, :unknown_cell} =
             Service.retry_cell(
               Map.put(start_params, "cell_id", "session-nope"),
               context
             )
  end

  test "persists an operator-reviewed ranking and returns it in later snapshots", %{
    context: context,
    state: state
  } do
    ranking =
      Contract.cells()
      |> Enum.with_index(1)
      |> Enum.map(fn {cell, rank} ->
        %{"rank" => rank, "cell_id" => cell.id, "score" => 99 - rank}
      end)

    assert {:ok, saved} =
             Service.save_decision(
               %{
                 "project_slug" => "dev10x",
                 "identifier" => "DEV-1",
                 "ranking" => ranking,
                 "summary" => "Reviewed previews and durable evidence in the mobile app."
               },
               context
             )

    assert saved["decision"]["winner_cell_id"] == "session-codex"
    assert Agent.get(state, & &1.decision) == saved["decision"]

    assert {:ok, refreshed} =
             Service.get(
               %{"project_slug" => "dev10x", "identifier" => "DEV-1"},
               context
             )

    assert refreshed["decision"] == saved["decision"]
  end
end
