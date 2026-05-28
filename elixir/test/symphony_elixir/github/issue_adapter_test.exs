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
end
