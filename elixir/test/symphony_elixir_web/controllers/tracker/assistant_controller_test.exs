defmodule SymphonyElixirWeb.Tracker.AssistantControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
    end)

    :ok
  end

  test "rejects blank assistant messages" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/assistant/messages", %{"message" => "   "})

    assert json_response(conn, 422) == %{
             "error" => %{"code" => "validation_failed", "message" => "message is required", "details" => %{}}
           }
  end

  test "creates an issue from a project assistant message" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/assistant/messages", %{
        "message" => "create issue: Add assistant panel"
      })

    assert %{
             "data" => %{
               "assistant_message" => assistant_message,
               "tool_calls" => [
                 %{
                   "name" => "create_issue",
                   "status" => "complete",
                   "result" => %{"issue" => %{"identifier" => "MAC-1", "title" => "Add assistant panel"}}
                 }
               ]
             }
           } = json_response(conn, 201)

    assert assistant_message =~ "Created issue MAC-1"
  end

  test "requests Codex work through the existing issue workflow" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Fix tests", "status" => "Todo"})

    conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/assistant/messages", %{
        "message" => "start codex on MAC-1: fix the failing tests"
      })

    assert %{
             "data" => %{
               "assistant_message" => assistant_message,
               "tool_calls" => [
                 %{
                   "name" => "dispatch_codex",
                   "status" => "complete",
                   "result" => %{"issue" => %{"identifier" => "MAC-1", "status" => %{"name" => "In Progress"}}}
                 }
               ]
             }
           } = json_response(conn, 201)

    assert assistant_message =~ "Requested Codex work on MAC-1"
  end

  test "routes planned tracker tools from assistant messages" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Old title", "status" => "Todo"})

    update_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/assistant/messages", %{
        "message" => "update MAC-1 title: New title"
      })

    assert %{
             "data" => %{
               "tool_calls" => [
                 %{"name" => "update_issue", "result" => %{"issue" => %{"title" => "New title"}}}
               ]
             }
           } = json_response(update_conn, 201)

    move_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/assistant/messages", %{
        "message" => "move MAC-1 to In Progress"
      })

    assert %{
             "data" => %{
               "tool_calls" => [
                 %{"name" => "move_issue", "result" => %{"issue" => %{"status" => %{"name" => "In Progress"}}}}
               ]
             }
           } = json_response(move_conn, 201)

    comment_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/assistant/messages", %{
        "message" => "comment on MAC-1: Please check the edge cases"
      })

    assert %{
             "data" => %{
               "tool_calls" => [
                 %{"name" => "add_comment", "result" => %{"comment" => %{"body" => "Please check the edge cases"}}}
               ]
             }
           } = json_response(comment_conn, 201)

    executions_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/assistant/messages", %{
        "message" => "agent executions"
      })

    assert %{
             "data" => %{
               "tool_calls" => [%{"name" => "get_agent_executions", "result" => %{"agent_executions" => []}}]
             }
           } = json_response(executions_conn, 201)
  end

  test "responds conversationally instead of treating every free-text message as an issue search" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Existing issue", "status" => "Todo"})

    greeting_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/assistant/messages", %{"message" => "oi"})

    assert %{
             "data" => %{
               "assistant_message" => greeting_message,
               "tool_calls" => []
             }
           } = json_response(greeting_conn, 201)

    assert greeting_message =~ "Oi"
    refute greeting_message =~ "Found"

    question_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/assistant/messages", %{
        "message" => "Pq vc nao esta conversacional?"
      })

    assert %{
             "data" => %{
               "assistant_message" => question_message,
               "tool_calls" => []
             }
           } = json_response(question_conn, 201)

    assert question_message =~ "convers"
    refute question_message =~ "Found"
  end

  defp authorized_conn do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_comments",
          "local_tracker_issue_labels",
          "local_tracker_issues",
          "local_tracker_labels",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
