defmodule SymphonyElixir.Jira.IssueAdapterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Jira.IssueAdapter
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueDTO

  @project %Project{id: 1, slug: "acme", tracker_kind: "jira", tracker_config: %{"project_key" => "ABC"}}

  defp issue_body(key \\ "ABC-12") do
    %{
      "id" => "10001",
      "key" => key,
      "fields" => %{
        "summary" => "Fix",
        "status" => %{"name" => "In Progress", "statusCategory" => %{"key" => "indeterminate"}},
        "assignee" => %{"displayName" => "Bot"},
        "created" => "2026-06-01T10:00:00.000Z",
        "updated" => "2026-06-01T12:00:00.000Z"
      }
    }
  end

  defp transitions_body do
    %{
      "transitions" => [
        %{"id" => "11", "to" => %{"name" => "In Progress"}},
        %{"id" => "31", "to" => %{"name" => "Done"}}
      ]
    }
  end

  defp put_client(fun) do
    Application.put_env(:symphony_elixir, :jira_client_module, fun)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :jira_client_module) end)
  end

  defmodule Stub do
    @moduledoc false
    def set(handler), do: :persistent_term.put({__MODULE__, self()}, handler)
    def request(verb, path, body, _opts), do: handler().(verb, path, body)
    defp handler, do: :persistent_term.get({__MODULE__, self()})
  end

  setup do
    put_client(Stub)
    :ok
  end

  test "kind/0 is :jira" do
    assert IssueAdapter.kind() == :jira
  end

  test "list_issues searches with a project JQL clause and normalizes" do
    Stub.set(fn :post, "/rest/api/3/search/jql", body ->
      assert body["jql"] =~ ~s|project = "ABC"|
      {:ok, %{"issues" => [issue_body("ABC-1"), issue_body("ABC-2")], "isLast" => true}}
    end)

    assert {:ok, [a, b]} = IssueAdapter.list_issues(@project, [])
    assert %IssueDTO{identifier: "ABC-1"} = a
    assert b.identifier == "ABC-2"
  end

  test "list_issues applies the configured fields filter to the JQL" do
    project = %Project{
      id: 2,
      slug: "advising",
      tracker_kind: "jira",
      tracker_config: %{"project_key" => "CDE", "fields" => %{"Product" => "Inspire"}}
    }

    Stub.set(fn :post, "/rest/api/3/search/jql", body ->
      assert body["jql"] == ~s|project = "CDE" AND "Product" = "Inspire" ORDER BY created DESC|
      {:ok, %{"issues" => [issue_body("CDE-1")], "isLast" => true}}
    end)

    assert {:ok, [%IssueDTO{identifier: "CDE-1"}]} = IssueAdapter.list_issues(project, [])
  end

  test "list_issues follows nextPageToken across pages, in order" do
    parent = self()

    Stub.set(fn :post, "/rest/api/3/search/jql", body ->
      case body["nextPageToken"] do
        nil ->
          send(parent, :page_1)
          {:ok, %{"issues" => [issue_body("ABC-1")], "nextPageToken" => "tok-2", "isLast" => false}}

        "tok-2" ->
          send(parent, :page_2)
          {:ok, %{"issues" => [issue_body("ABC-2")], "isLast" => true}}
      end
    end)

    assert {:ok, [%IssueDTO{identifier: "ABC-1"}, %IssueDTO{identifier: "ABC-2"}]} =
             IssueAdapter.list_issues(@project, [])

    assert_received :page_1
    assert_received :page_2
  end

  test "list_issues stops at max_results and does not page further" do
    project = %Project{
      id: 3,
      slug: "capped",
      tracker_kind: "jira",
      tracker_config: %{"project_key" => "ABC", "max_results" => 1}
    }

    Stub.set(fn :post, "/rest/api/3/search/jql", body ->
      # The cap is hit on page 1, so a second page must never be requested.
      assert body["nextPageToken"] == nil
      {:ok, %{"issues" => [issue_body("ABC-1"), issue_body("ABC-2")], "nextPageToken" => "tok-2", "isLast" => false}}
    end)

    assert {:ok, [%IssueDTO{identifier: "ABC-1"}]} = IssueAdapter.list_issues(project, [])
  end

  test "get_issue returns the DTO when found" do
    Stub.set(fn :get, "/rest/api/3/issue/ABC-12", _body -> {:ok, issue_body()} end)
    assert {:ok, %IssueDTO{identifier: "ABC-12"}} = IssueAdapter.get_issue(@project, "ABC-12")
  end

  test "get_issue maps a 404 to :issue_not_found" do
    Stub.set(fn :get, _path, _body -> {:error, {:jira_api_status, 404}} end)
    assert {:error, :issue_not_found} = IssueAdapter.get_issue(@project, "ABC-404")
  end

  test "list_statuses flattens project statuses" do
    Stub.set(fn :get, "/rest/api/3/project/ABC/statuses", _body ->
      {:ok, [%{"statuses" => [%{"id" => "1", "name" => "To Do", "statusCategory" => %{"key" => "new"}}]}]}
    end)

    assert {:ok, [%{name: "To Do", category: "unstarted"}]} = IssueAdapter.list_statuses(@project)
  end

  test "list_labels maps system labels" do
    Stub.set(fn :get, "/rest/api/3/label", _body -> {:ok, %{"values" => ["backend"]}} end)
    assert {:ok, [%{id: nil, name: "backend"}]} = IssueAdapter.list_labels(@project)
  end

  test "list_assignable_users maps users" do
    Stub.set(fn :get, "/rest/api/3/user/assignable/search?project=ABC&maxResults=100", _body ->
      {:ok, [%{"accountId" => "acc-1", "displayName" => "Bot"}]}
    end)

    assert {:ok, [%{id: "acc-1", login: "Bot"}]} = IssueAdapter.list_assignable_users(@project)
  end

  test "create_issue builds fields and returns a DTO" do
    Stub.set(fn :post, "/rest/api/3/issue", body ->
      assert get_in(body, ["fields", "project", "key"]) == "ABC"
      assert get_in(body, ["fields", "issuetype", "name"]) == "Task"
      assert get_in(body, ["fields", "summary"]) == "New issue"
      {:ok, %{"id" => "10010", "key" => "ABC-99"}}
    end)

    assert {:ok, %IssueDTO{identifier: "ABC-99", title: "New issue"}} =
             IssueAdapter.create_issue(@project, %{"title" => "New issue"})
  end

  test "create_issue rejects a blank title before calling the API" do
    Stub.set(fn _verb, _path, _body -> flunk("should not call API") end)
    assert {:error, {:remote_validation, %{title: ["is required"]}}} = IssueAdapter.create_issue(@project, %{"title" => "  "})
  end

  test "move_issue applies the matching transition and returns the refreshed DTO" do
    Stub.set(fn
      :get, "/rest/api/3/issue/ABC-12/transitions", _body ->
        {:ok, transitions_body()}

      :post, "/rest/api/3/issue/ABC-12/transitions", body ->
        assert body == %{"transition" => %{"id" => "31"}}
        {:ok, %{}}

      :get, "/rest/api/3/issue/ABC-12", _body ->
        {:ok, issue_body()}
    end)

    assert {:ok, %IssueDTO{id: "10001"}} = IssueAdapter.move_issue(@project, "ABC-12", %{"status" => "Done"})
  end

  test "move_issue returns :status_not_found for an unknown target" do
    Stub.set(fn :get, "/rest/api/3/issue/ABC-12/transitions", _body -> {:ok, transitions_body()} end)
    assert {:error, :status_not_found} = IssueAdapter.move_issue(@project, "ABC-12", %{"status" => "Nope"})
  end

  test "add_comment posts ADF and returns a comment map" do
    Stub.set(fn :post, "/rest/api/3/issue/ABC-12/comment", body ->
      assert get_in(body, ["body", "type"]) == "doc"

      {:ok,
       %{
         "id" => "c-1",
         "body" => %{"type" => "doc", "content" => [%{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "hi"}]}]},
         "author" => %{"displayName" => "Bot"},
         "updated" => "2026-06-01T13:00:00.000Z"
       }}
    end)

    assert {:ok, comment} = IssueAdapter.add_comment(@project, "ABC-12", "hi", %{})
    assert comment.remote_id == "c-1"
    assert comment.body == "hi"
    assert comment.author == "Bot"
  end

  test "update_comment puts ADF to the comment endpoint and returns the comment map" do
    Stub.set(fn :put, "/rest/api/3/issue/ABC-12/comment/c-1", body ->
      assert get_in(body, ["body", "type"]) == "doc"

      {:ok,
       %{
         "id" => "c-1",
         "body" => %{"type" => "doc", "content" => [%{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "v2"}]}]},
         "author" => %{"displayName" => "Bot"},
         "updated" => "2026-06-01T14:00:00.000Z"
       }}
    end)

    assert {:ok, comment} = IssueAdapter.update_comment(@project, "ABC-12", "c-1", "v2")
    assert comment.remote_id == "c-1"
    assert comment.body == "v2"
  end

  test "comments whose body starts with Codex Workpad classify as workpad" do
    Stub.set(fn :get, "/rest/api/3/issue/ABC-12/comment", _body ->
      {:ok,
       %{
         "comments" => [
           %{
             "id" => "c-9",
             "body" => %{
               "type" => "doc",
               "content" => [%{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "## Codex Workpad\nplan"}]}]
             },
             "author" => %{"displayName" => "Bot"},
             "updated" => "2026-06-01T13:00:00.000Z"
           }
         ]
       }}
    end)

    assert {:ok, [%{remote_id: "c-9", kind: "workpad"}]} = IssueAdapter.list_comments(@project, "ABC-12")
  end

  test "list_comments maps comments to sync-shaped maps" do
    Stub.set(fn :get, "/rest/api/3/issue/ABC-12/comment", _body ->
      {:ok,
       %{
         "comments" => [
           %{
             "id" => "c-1",
             "body" => %{"type" => "doc", "content" => [%{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "hello"}]}]},
             "author" => %{"displayName" => "Bot"},
             "updated" => "2026-06-01T13:00:00.000Z"
           }
         ]
       }}
    end)

    assert {:ok, [%{remote_id: "c-1", body: "hello", author: "Bot"}]} =
             IssueAdapter.list_comments(@project, "ABC-12")
  end

  test "error mapping covers auth/forbidden/rate-limit" do
    Stub.set(fn :post, _path, _body -> {:error, {:jira_api_status, 401}} end)
    assert {:error, :remote_unauthorized} = IssueAdapter.list_issues(@project, [])

    Stub.set(fn :post, _path, _body -> {:error, {:jira_api_status, 403}} end)
    assert {:error, :remote_forbidden} = IssueAdapter.list_issues(@project, [])

    Stub.set(fn :post, _path, _body -> {:error, {:jira_api_status, 429}} end)
    assert {:error, :remote_rate_limited} = IssueAdapter.list_issues(@project, [])
  end

  test "update_issue is not supported on remote" do
    Stub.set(fn _verb, _path, _body -> flunk("should not call API") end)
    assert {:error, :not_supported_on_remote} = IssueAdapter.update_issue(@project, "ABC-1", %{})
  end
end
