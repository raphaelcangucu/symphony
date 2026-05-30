defmodule SymphonyElixir.GitHub.IssueAdapterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.GitHub.IssueAdapter
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueDTO

  defmodule ListClientStub do
    def graphql(_query, _vars, _opts) do
      {:ok,
       %{
         "data" => %{
           "node" => %{
             "items" => %{
               "nodes" => [
                 %{
                   "id" => "PVTI_1",
                   "content" => %{
                     "__typename" => "Issue",
                     "id" => "I_1",
                     "number" => 7,
                     "title" => "Remote",
                     "body" => nil,
                     "url" => "https://x/7",
                     "assignees" => %{"nodes" => []},
                     "labels" => %{"nodes" => []},
                     "createdAt" => "2026-05-28T00:00:00Z",
                     "updatedAt" => "2026-05-28T00:00:00Z"
                   },
                   "fieldValues" => %{
                     "nodes" => [
                       %{
                         "__typename" => "ProjectV2ItemFieldSingleSelectValue",
                         "name" => "Todo",
                         "field" => %{"name" => "Symphony State"}
                       }
                     ]
                   }
                 }
               ],
               "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
             }
           }
         }
       }}
    end
  end

  defmodule UnauthorizedClientStub do
    def graphql(_query, _vars, _opts), do: {:error, {:github_api_status, 401}}
  end

  setup do
    Application.put_env(:symphony_elixir, :github_client_module, ListClientStub)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :github_client_module) end)
    :ok
  end

  defp project do
    %Project{
      slug: "remote",
      tracker_kind: "github",
      tracker_config: %{"repo" => "o/r", "project_id" => "PVT_1", "status_field" => "Symphony State"}
    }
  end

  test "kind/0 is :github" do
    assert IssueAdapter.kind() == :github
  end

  test "list_issues returns DTOs from the board" do
    assert {:ok, [%IssueDTO{identifier: "#7", title: "Remote", status: %{name: "Todo"}}]} =
             IssueAdapter.list_issues(project(), [])
  end

  test "maps 401 to :remote_unauthorized" do
    Application.put_env(:symphony_elixir, :github_client_module, UnauthorizedClientStub)
    assert {:error, :remote_unauthorized} = IssueAdapter.list_issues(project(), [])
  end

  defmodule MoveClientStub do
    def graphql(query, _vars, _opts) do
      cond do
        String.contains?(query, "fields(first") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "fields" => %{
                   "nodes" => [
                     %{
                       "__typename" => "ProjectV2SingleSelectField",
                       "id" => "FIELD_1",
                       "name" => "Symphony State",
                       "options" => [%{"id" => "OPT_DONE", "name" => "Done"}]
                     }
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "updateProjectV2ItemFieldValue") ->
          {:ok, %{"data" => %{"updateProjectV2ItemFieldValue" => %{"projectV2Item" => %{"id" => "PVTI_1"}}}}}

        true ->
          {:ok, %{"data" => %{}}}
      end
    end
  end

  test "move_issue resolves option id and posts the mutation" do
    Application.put_env(:symphony_elixir, :github_client_module, MoveClientStub)

    assert {:ok, %{status: %{name: "Done"}}} =
             IssueAdapter.move_issue(
               %{project() | tracker_config: Map.put(project().tracker_config, "status_field", "Symphony State")},
               "PVTI_1",
               %{"status" => "Done", "item_id" => "PVTI_1"}
             )
  end

  defmodule CreateClientStub do
    def graphql(query, vars, _opts) do
      cond do
        String.contains?(query, "SymphonyUiRepoMetadata") ->
          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "id" => "REPO_1",
                 "labels" => %{
                   "nodes" => [
                     %{"id" => "L1", "name" => "bug", "color" => "ff0000"},
                     %{"id" => "AGC", "name" => "symphony:codex", "color" => nil}
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyUiAssignableUsers") ->
          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "assignableUsers" => %{
                   "nodes" => [%{"id" => "U1", "login" => "alice", "name" => "Alice", "avatarUrl" => nil}]
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyUiStatusOptions") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "fields" => %{
                   "nodes" => [
                     %{
                       "__typename" => "ProjectV2SingleSelectField",
                       "id" => "FIELD_1",
                       "name" => "Symphony State",
                       "options" => [%{"id" => "OPT_TODO", "name" => "Todo"}]
                     }
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyUiCreateIssue") ->
          send(self(), {:create_input, vars["input"]})

          {:ok,
           %{
             "data" => %{
               "createIssue" => %{
                 "issue" => %{"id" => "I_10", "number" => 10, "url" => "https://x/10", "title" => "New"}
               }
             }
           }}

        String.contains?(query, "SymphonyUiAddProjectItem") ->
          {:ok, %{"data" => %{"addProjectV2ItemById" => %{"item" => %{"id" => "PVTI_10"}}}}}

        String.contains?(query, "SymphonyUiSetStatus") ->
          {:ok, %{"data" => %{"updateProjectV2ItemFieldValue" => %{"projectV2Item" => %{"id" => "PVTI_10"}}}}}

        true ->
          {:ok, %{"data" => %{}}}
      end
    end
  end

  describe "create_issue" do
    setup do
      Application.put_env(:symphony_elixir, :github_client_module, CreateClientStub)
      :ok
    end

    test "creates issue, resolves agent label, adds to board, sets status" do
      attrs = %{
        "title" => "New",
        "status" => "Todo",
        "label_ids" => ["L1"],
        "assignee_ids" => ["U1"],
        "agent" => "codex"
      }

      assert {:ok, %IssueDTO{identifier: "#10", title: "New", url: "https://x/10", labels: labels}} =
               IssueAdapter.create_issue(project(), attrs)

      assert "bug" in labels
      assert "symphony:codex" in labels

      assert_received {:create_input, input}
      assert input["repositoryId"] == "REPO_1"
      assert input["assigneeIds"] == ["U1"]
      assert "L1" in input["labelIds"]
      assert "AGC" in input["labelIds"]
    end

    test "returns validation error when title is blank" do
      assert {:error, {:remote_validation, %{title: ["is required"]}}} =
               IssueAdapter.create_issue(project(), %{"title" => "  ", "status" => "Todo"})
    end
  end

  describe "list_labels / list_assignable_users" do
    setup do
      Application.put_env(:symphony_elixir, :github_client_module, CreateClientStub)
      :ok
    end

    test "list_labels returns repo labels" do
      assert {:ok, labels} = IssueAdapter.list_labels(project())
      assert Enum.any?(labels, &(&1.name == "bug" and &1.id == "L1"))
    end

    test "list_assignable_users returns assignable users" do
      assert {:ok, [%{login: "alice", id: "U1"}]} = IssueAdapter.list_assignable_users(project())
    end
  end
end
