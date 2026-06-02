defmodule SymphonyElixir.JiraClientTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Jira.Client

  @creds [base_url: "https://acme.atlassian.net", email: "user@x.com", api_token: "tok"]

  describe "request/4" do
    test "returns body on 2xx and sets basic auth + json headers" do
      fun = fn verb, url, body, headers ->
        assert verb == :get
        assert url == "https://acme.atlassian.net/rest/api/3/myself"
        assert body == nil
        header_map = Enum.into(headers, %{})
        assert header_map["Authorization"] == "Basic " <> Base.encode64("user@x.com:tok")
        assert header_map["Accept"] == "application/json"
        {:ok, %{status: 200, body: %{"accountId" => "acc-1"}}}
      end

      assert {:ok, %{"accountId" => "acc-1"}} =
               Client.request(:get, "/rest/api/3/myself", nil, [request_fun: fun] ++ @creds)
    end

    test "passes json body through on post" do
      fun = fn verb, _url, body, _headers ->
        assert verb == :post
        assert body == %{"jql" => "project = ABC"}
        {:ok, %{status: 201, body: %{"ok" => true}}}
      end

      assert {:ok, %{"ok" => true}} =
               Client.request(:post, "/rest/api/3/search/jql", %{"jql" => "project = ABC"}, [request_fun: fun] ++ @creds)
    end

    test "maps 401 to a status error tuple" do
      fun = fn _verb, _url, _body, _headers -> {:ok, %{status: 401, body: %{"err" => "no"}}} end

      assert {:error, {:jira_api_status, 401}} =
               Client.request(:get, "/rest/api/3/myself", nil, [request_fun: fun] ++ @creds)
    end

    test "maps transport failures to a request error tuple" do
      fun = fn _verb, _url, _body, _headers -> {:error, :timeout} end

      assert {:error, {:jira_api_request, :timeout}} =
               Client.request(:get, "/rest/api/3/myself", nil, [request_fun: fun] ++ @creds)
    end

    test "errors when credentials are missing" do
      fun = fn _verb, _url, _body, _headers -> {:ok, %{status: 200, body: %{}}} end

      assert {:error, :missing_jira_credentials} =
               Client.request(:get, "/rest/api/3/myself", nil,
                 request_fun: fun,
                 base_url: nil,
                 email: "user@x.com",
                 api_token: "tok"
               )
    end
  end

  defp issue_fixture do
    %{
      "id" => "10001",
      "key" => "ABC-12",
      "fields" => %{
        "summary" => "Fix the thing",
        "description" => %{
          "type" => "doc",
          "content" => [
            %{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "details"}]}
          ]
        },
        "status" => %{"name" => "In Progress", "statusCategory" => %{"key" => "indeterminate"}},
        "assignee" => %{"accountId" => "acc-1", "displayName" => "Bot"},
        "priority" => %{"name" => "High"},
        "labels" => ["Backend", "urgent"],
        "issuelinks" => [
          %{
            "type" => %{"inward" => "is blocked by"},
            "inwardIssue" => %{
              "id" => "10000",
              "key" => "ABC-1",
              "fields" => %{"status" => %{"name" => "Todo"}}
            }
          },
          %{"type" => %{"inward" => "relates to"}, "inwardIssue" => %{"id" => "9", "key" => "ABC-9"}}
        ],
        "created" => "2026-06-01T10:00:00.000+0000",
        "updated" => "2026-06-01T12:00:00.000Z"
      }
    }
  end

  describe "normalize_issue_for_test/2" do
    test "maps JIRA fields to an Issue struct" do
      issue = Client.normalize_issue_for_test(issue_fixture())

      assert issue.id == "10001"
      assert issue.identifier == "ABC-12"
      assert issue.title == "Fix the thing"
      assert issue.description == "details"
      assert issue.priority == 2
      assert issue.state == "In Progress"
      assert issue.branch_name == nil
      assert issue.assignee_id == "acc-1"
      assert issue.labels == ["backend", "urgent"]
      assert [%{id: "10000", identifier: "ABC-1", state: "Todo"}] = issue.blocked_by
      assert %DateTime{} = issue.created_at
      assert %DateTime{} = issue.updated_at
    end

    test "assigned_to_worker is true with no filter, false when accountId differs" do
      assert Client.normalize_issue_for_test(issue_fixture()).assigned_to_worker == true
      assert Client.normalize_issue_for_test(issue_fixture(), "acc-1").assigned_to_worker == true
      assert Client.normalize_issue_for_test(issue_fixture(), "other").assigned_to_worker == false
    end
  end

  describe "fetch_candidate_issues/1" do
    test "paginates until isLast and concatenates issues in order" do
      fun = fn :post, _url, body, _headers ->
        case body["nextPageToken"] do
          nil ->
            assert body["jql"] =~ ~s|project = "ABC"|
            assert body["jql"] =~ ~s|status in ("Todo", "In Progress")|

            {:ok,
             %{
               status: 200,
               body: %{
                 "issues" => [Map.put(issue_fixture(), "key", "ABC-1")],
                 "nextPageToken" => "t2",
                 "isLast" => false
               }
             }}

          "t2" ->
            {:ok,
             %{
               status: 200,
               body: %{
                 "issues" => [Map.put(issue_fixture(), "key", "ABC-2")],
                 "isLast" => true
               }
             }}
        end
      end

      assert {:ok, [first, second]} =
               Client.fetch_candidate_issues(
                 request_fun: fun,
                 base_url: "https://acme.atlassian.net",
                 email: "u@x.com",
                 api_token: "tok",
                 project_key: "ABC",
                 active_states: ["Todo", "In Progress"]
               )

      assert first.identifier == "ABC-1"
      assert second.identifier == "ABC-2"
    end

    test "resolves 'me' assignee via /myself and filters by accountId" do
      fun = fn
        :get, url, _body, _headers ->
          assert url =~ "/rest/api/3/myself"
          {:ok, %{status: 200, body: %{"accountId" => "acc-1"}}}

        :post, _url, body, _headers ->
          assert body["jql"] =~ ~s|assignee = "acc-1"|
          {:ok, %{status: 200, body: %{"issues" => [issue_fixture()], "isLast" => true}}}
      end

      assert {:ok, [issue]} =
               Client.fetch_candidate_issues(
                 request_fun: fun,
                 base_url: "https://acme.atlassian.net",
                 email: "u@x.com",
                 api_token: "tok",
                 project_key: "ABC",
                 assignee: "me",
                 active_states: ["Todo"]
               )

      assert issue.assigned_to_worker == true
    end

    test "errors when project key missing" do
      assert {:error, :missing_project_key} =
               Client.fetch_candidate_issues(api_token: "tok", project_key: nil)
    end
  end

  describe "fetch_issue_states_by_ids/2" do
    test "returns empty list without a request for empty ids" do
      assert {:ok, []} = Client.fetch_issue_states_by_ids([], api_token: "tok")
    end

    test "builds an id-in JQL clause" do
      fun = fn :post, _url, body, _headers ->
        assert body["jql"] == "id in (10001, 10002)"
        {:ok, %{status: 200, body: %{"issues" => [issue_fixture()], "isLast" => true}}}
      end

      assert {:ok, [_issue]} =
               Client.fetch_issue_states_by_ids(["10001", "10002"],
                 request_fun: fun,
                 base_url: "https://acme.atlassian.net",
                 email: "u@x.com",
                 api_token: "tok"
               )
    end
  end
end
