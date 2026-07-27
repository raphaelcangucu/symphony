defmodule SymphonyElixir.MobileComparison.LocalGatewayTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileComparison.{Contract, LocalGateway}

  defmodule FakeTrackerBridge do
    def request(domain, request, context) do
      send(context.test_pid, {:tracker_request, domain, request})

      case {domain, request["method"], request["path"]} do
        {:tasks, "GET", "/projects/dev10x/issues/DEV-1"} ->
          {:ok,
           %{
             "data" => %{
               "identifier" => "DEV-1",
               "project_slug" => "dev10x",
               "title" => "Parent",
               "description" => "Build it",
               "status" => "Backlog"
             }
           }}

        {:tasks, "GET", "/projects/dev10x/issues/DEV-1/subtasks"} ->
          {:ok,
           %{
             "data" => [
               %{
                 "identifier" => "DEV-2",
                 "title" => "[dev10x-comparison:session-codex] Session"
               }
             ]
           }}

        {:tasks, "POST", "/projects/dev10x/issues/DEV-1/subtasks"} ->
          {:ok,
           %{
             "data" =>
               Map.merge(request["body"], %{
                 "identifier" => "DEV-2",
                 "project_slug" => "dev10x"
               })
           }}

        {:sessions, "POST", "/assistant/threads"} ->
          {:ok,
           %{
             "data" => %{
               "id" => 42,
               "issue_identifier" => "DEV-2",
               "status" => "active",
               "requested_model" => request["body"]["model"],
               "requested_effort" => request["body"]["effort"]
             }
           }}

        {:tasks, "POST", "/projects/dev10x/issues/DEV-2/dispatch"} ->
          {:ok, %{"data" => %{"accepted" => true}}}

        {:previews, "GET", "/assistant/threads/42/dev_servers"} ->
          {:ok, %{"data" => [%{"id" => "preview-1", "status" => "running"}]}}
      end
    end
  end

  defmodule FakeHistory do
    def list_messages_for_thread(42), do: []
    def turn_running?(_thread), do: false

    def list_threads(opts) do
      if Keyword.get(opts, :issue_identifier) == "DEV-2" do
        [
          %{
            id: 42,
            issue_identifier: "DEV-2",
            status: "active",
            requested_model: "gpt-5.6-sol",
            requested_effort: "high"
          }
        ]
      else
        []
      end
    end
  end

  defmodule EmptyHistory do
    def list_messages_for_thread(42), do: []
    def list_threads(_opts), do: []
  end

  defmodule FakeSessionStarter do
    def start(thread, prompt, context) do
      send(context.test_pid, {:session_start, thread, prompt, context.comparison_request_key})
      :ok
    end
  end

  defmodule FakeExecutions do
    def list_executions do
      [
        %{
          issue_identifier: "DEV-2",
          status: "live",
          execution_session_id: 77
        }
      ]
    end
  end

  defmodule FakeEvidence do
    def call(
          "evidence.list",
          %{"project_slug" => "dev10x", "identifier" => "DEV-2"},
          _context
        ) do
      {:ok, %{"records" => [%{"run_id" => "run-1"}]}}
    end
  end

  setup do
    context = %{
      test_pid: self(),
      comparison_request_key: "mobile-key-1",
      comparison_tracker_bridge: FakeTrackerBridge,
      comparison_history: EmptyHistory,
      comparison_session_starter: FakeSessionStarter,
      comparison_execution_service: FakeExecutions,
      mobile_evidence_service: FakeEvidence
    }

    %{context: context}
  end

  test "loads parent and identifies canonical children from their stable marker", %{
    context: context
  } do
    assert {:ok, %{"identifier" => "DEV-1"}} =
             LocalGateway.get_parent("dev10x", "DEV-1", context)

    assert {:ok, [%{"comparison_cell_id" => "session-codex"}]} =
             LocalGateway.list_children("dev10x", "DEV-1", context)
  end

  test "creates a child with provider settings and a cell-scoped idempotency key", %{
    context: context
  } do
    assert {:ok, cell} = Contract.fetch("session-codex")

    assert {:ok,
            %{
              "identifier" => "DEV-2",
              "comparison_cell_id" => "session-codex"
            }} = LocalGateway.create_child("dev10x", "DEV-1", cell, "Build it", context)

    assert_receive {:tracker_request, :tasks,
                    %{
                      "method" => "POST",
                      "path" => "/projects/dev10x/issues/DEV-1/subtasks",
                      "idempotency_key" => "mobile-key-1:session-codex:child",
                      "body" => %{
                        "title" => "[dev10x-comparison:session-codex] Session · GPT-5.6 Sol · High",
                        "description" => "Build it",
                        "status" => "Backlog",
                        "agent" => "codex",
                        "model" => "gpt-5.6-sol",
                        "effort" => "high",
                        "mode" => "yolo"
                      }
                    }}
  end

  test "creates one isolated issue session and reports it ready before its first message", %{
    context: context
  } do
    assert {:ok, cell} = Contract.fetch("session-codex")
    child = %{"identifier" => "DEV-2"}

    assert {:ok, %{"id" => 42, "status" => "ready"}} =
             LocalGateway.ensure_session("dev10x", child, cell, context)

    assert_receive {:tracker_request, :sessions,
                    %{
                      "method" => "POST",
                      "path" => "/assistant/threads",
                      "idempotency_key" => "mobile-key-1:session-codex:thread",
                      "body" => %{
                        "scope" => "issue_session",
                        "project_slug" => "dev10x",
                        "issue_identifier" => "DEV-2",
                        "agent_kind" => "codex",
                        "model" => "gpt-5.6-sol",
                        "effort" => "high",
                        "execution_mode" => "yolo",
                        "isolated_workspace" => true
                      }
                    }}

    assert :ok =
             LocalGateway.start_session(
               %{"id" => 42, "status" => "ready"},
               "Build it",
               context
             )

    assert_receive {:session_start, %{"id" => 42}, "Build it", "mobile-key-1"}
  end

  test "finds an existing issue session without creating another thread", %{context: context} do
    assert {:ok, cell} = Contract.fetch("session-codex")
    context = Map.put(context, :comparison_history, FakeHistory)

    assert {:ok, %{id: 42, status: "ready"}} =
             LocalGateway.get_session(
               "dev10x",
               %{"identifier" => "DEV-2"},
               cell,
               context
             )

    refute_receive {:tracker_request, :sessions, _request}
  end

  test "dispatches autonomous work and reads executions, previews and evidence", %{
    context: context
  } do
    assert :ok =
             LocalGateway.dispatch_child(
               "dev10x",
               %{
                 "identifier" => "DEV-2",
                 "agent_kind" => "codex",
                 "requested_model" => "gpt-5.6-sol",
                 "requested_effort" => "high"
               },
               context
             )

    assert_receive {:tracker_request, :tasks,
                    %{
                      "method" => "POST",
                      "path" => "/projects/dev10x/issues/DEV-2/dispatch",
                      "body" => %{
                        "action" => "continue_work",
                        "agent" => "codex",
                        "model" => "gpt-5.6-sol",
                        "effort" => "high",
                        "mode" => "yolo"
                      }
                    }}

    assert {:ok, [%{execution_session_id: 77}]} =
             LocalGateway.list_executions(context)

    assert {:ok, [%{"id" => "preview-1"}]} =
             LocalGateway.list_previews(%{"id" => 42}, context)

    assert {:ok, [%{"run_id" => "run-1"}]} =
             LocalGateway.list_evidence("dev10x", "DEV-2", context)
  end
end
