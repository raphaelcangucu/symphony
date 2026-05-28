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
end
