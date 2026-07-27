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
          dispatches: MapSet.new(),
          dispatch_calls: %{},
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
    def dispatch_child("dev10x", child, context) do
      Agent.update(context.comparison_gateway_state, fn state ->
        state
        |> Map.update!(:dispatches, &MapSet.put(&1, child.identifier))
        |> update_in([:dispatch_calls, child.identifier], &((&1 || 0) + 1))
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
             status: "live",
             execution_session_id: nil,
             resolved_model: nil,
             resolved_effort: nil,
             latest_message: nil,
             error: nil,
             retry_attempt: 0
           }
         end)
       end)}
    end

    @impl true
    def list_previews(_thread, _context), do: {:ok, []}

    @impl true
    def list_evidence(_project_slug, _identifier, _context), do: {:ok, []}

    @spec counts(pid()) :: map()
    def counts(state) do
      Agent.get(state, fn current ->
        %{
          children: map_size(current.children),
          sessions: map_size(current.sessions),
          session_starts: MapSet.size(current.session_starts),
          session_start_calls: current.session_start_calls |> Map.values() |> Enum.sum(),
          dispatches: MapSet.size(current.dispatches),
          dispatch_calls: current.dispatch_calls |> Map.values() |> Enum.sum()
        }
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
             dispatch_calls: 3
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
             dispatch_calls: 3
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
             dispatch_calls: 0
           }

    assert {:ok, snapshot} = Service.start(params, context)
    assert length(snapshot["cells"]) == 6

    assert FakeGateway.counts(state) == %{
             children: 6,
             sessions: 3,
             session_starts: 3,
             session_start_calls: 4,
             dispatches: 3,
             dispatch_calls: 3
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
end
