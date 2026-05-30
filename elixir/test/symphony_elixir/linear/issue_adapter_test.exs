defmodule SymphonyElixir.Linear.IssueAdapterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Linear.IssueAdapter
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueDTO

  defmodule ListClientStub do
    def graphql(_query, _vars, _opts) do
      {:ok,
       %{
         "data" => %{
           "project" => %{
             "id" => "proj-uuid",
             "issues" => %{
               "nodes" => [
                 %{
                   "id" => "i-1",
                   "identifier" => "LIN-1",
                   "title" => "First",
                   "description" => nil,
                   "priority" => 0,
                   "url" => "https://linear.app/x/LIN-1",
                   "state" => %{"id" => "s1", "name" => "Todo", "type" => "unstarted", "position" => 1.0},
                   "assignee" => nil,
                   "creator" => nil,
                   "createdAt" => "2026-05-28T00:00:00Z",
                   "updatedAt" => "2026-05-28T00:00:00Z"
                 }
               ]
             }
           }
         }
       }}
    end
  end

  defmodule ErrorClientStub do
    def graphql(_query, _vars, _opts), do: {:error, {:linear_api_status, 401}}
  end

  setup do
    Application.put_env(:symphony_elixir, :linear_client_module, ListClientStub)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :linear_client_module) end)
    :ok
  end

  defp project do
    %Project{slug: "demo", tracker_kind: "linear", tracker_config: %{"project_id" => "proj-uuid"}}
  end

  test "kind/0 is :linear" do
    assert IssueAdapter.kind() == :linear
  end

  test "list_issues returns DTOs" do
    assert {:ok, [%IssueDTO{identifier: "LIN-1", status: %{name: "Todo"}}]} =
             IssueAdapter.list_issues(project(), [])
  end

  test "maps 401 to :remote_unauthorized" do
    Application.put_env(:symphony_elixir, :linear_client_module, ErrorClientStub)
    assert {:error, :remote_unauthorized} = IssueAdapter.list_issues(project(), [])
  end

  defmodule CreateClientStub do
    def graphql(query, vars, _opts) do
      cond do
        String.contains?(query, "SymphonyUiLinearStates") ->
          {:ok,
           %{
             "data" => %{
               "project" => %{
                 "id" => "proj-uuid",
                 "teams" => %{
                   "nodes" => [
                     %{
                       "id" => "team-1",
                       "states" => %{
                         "nodes" => [%{"id" => "st-todo", "name" => "Todo", "type" => "unstarted", "position" => 1.0}]
                       }
                     }
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyUiLinearLabels") ->
          {:ok,
           %{
             "data" => %{
               "project" => %{
                 "teams" => %{
                   "nodes" => [
                     %{
                       "id" => "team-1",
                       "labels" => %{
                         "nodes" => [
                           %{"id" => "AGC", "name" => "symphony:codex", "color" => nil},
                           %{"id" => "LBL1", "name" => "bug", "color" => "ff0000"}
                         ]
                       }
                     }
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyUiLinearMembers") ->
          {:ok,
           %{
             "data" => %{
               "project" => %{
                 "teams" => %{
                   "nodes" => [
                     %{
                       "id" => "team-1",
                       "members" => %{
                         "nodes" => [%{"id" => "U1", "name" => "Alice", "displayName" => "alice", "avatarUrl" => nil}]
                       }
                     }
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyUiLinearCreateIssue") ->
          send(self(), {:create_input, vars["input"]})

          {:ok,
           %{
             "data" => %{
               "issueCreate" => %{
                 "success" => true,
                 "issue" => %{
                   "id" => "i-9",
                   "identifier" => "LIN-9",
                   "title" => "New",
                   "url" => "https://linear.app/x/LIN-9",
                   "state" => %{"id" => "st-todo", "name" => "Todo", "type" => "unstarted", "position" => 1.0}
                 }
               }
             }
           }}

        true ->
          {:ok, %{"data" => %{}}}
      end
    end
  end

  describe "create_issue" do
    setup do
      Application.put_env(:symphony_elixir, :linear_client_module, CreateClientStub)
      :ok
    end

    test "creates issue with state, labels (incl agent), single assignee, and priority" do
      attrs = %{
        "title" => "New",
        "status" => "Todo",
        "label_ids" => ["LBL1"],
        "assignee_ids" => ["U1", "U2"],
        "agent" => "codex",
        "priority" => 2
      }

      assert {:ok, %IssueDTO{identifier: "LIN-9", title: "New", status: %{name: "Todo"}}} =
               IssueAdapter.create_issue(project(), attrs)

      assert_received {:create_input, input}
      assert input["teamId"] == "team-1"
      assert input["projectId"] == "proj-uuid"
      assert input["stateId"] == "st-todo"
      assert input["assigneeId"] == "U1"
      assert input["priority"] == 2
      assert "LBL1" in input["labelIds"]
      assert "AGC" in input["labelIds"]
    end

    test "returns validation error when title is blank" do
      assert {:error, {:remote_validation, %{title: ["is required"]}}} =
               IssueAdapter.create_issue(project(), %{"title" => "", "status" => "Todo"})
    end
  end

  describe "list_labels / list_assignable_users" do
    setup do
      Application.put_env(:symphony_elixir, :linear_client_module, CreateClientStub)
      :ok
    end

    test "list_labels returns team labels" do
      assert {:ok, labels} = IssueAdapter.list_labels(project())
      assert Enum.any?(labels, &(&1.name == "bug" and &1.id == "LBL1"))
    end

    test "list_assignable_users maps members to assignable users" do
      assert {:ok, [%{login: "alice", id: "U1"}]} = IssueAdapter.list_assignable_users(project())
    end
  end
end
