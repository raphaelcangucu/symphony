defmodule SymphonyElixir.TrackerJiraTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Jira.Tracker

  defmodule StubClient do
    def fetch_candidate_issues, do: {:ok, [:candidate]}
    def fetch_issues_by_states(states), do: {:ok, {:by_states, states}}
    def fetch_issue_states_by_ids(ids), do: {:ok, {:by_ids, ids}}

    def request(:post, "/rest/api/3/issue/ABC-1/comment", body, _opts) do
      send(self(), {:comment, body})
      {:ok, %{"id" => "c-1"}}
    end

    def request(:get, "/rest/api/3/issue/ABC-1/transitions", nil, _opts) do
      {:ok,
       %{
         "transitions" => [
           %{"id" => "11", "name" => "Start", "to" => %{"name" => "In Progress"}},
           %{"id" => "31", "name" => "Finish", "to" => %{"name" => "Done"}}
         ]
       }}
    end

    def request(:post, "/rest/api/3/issue/ABC-1/transitions", body, _opts) do
      send(self(), {:transition, body})
      {:ok, %{}}
    end
  end

  setup do
    Application.put_env(:symphony_elixir, :jira_client_module, StubClient)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :jira_client_module) end)
    :ok
  end

  describe "poll delegation" do
    test "fetch_candidate_issues delegates to the client" do
      assert {:ok, [:candidate]} = Tracker.fetch_candidate_issues()
    end

    test "fetch_issues_by_states delegates to the client" do
      assert {:ok, {:by_states, ["Todo"]}} = Tracker.fetch_issues_by_states(["Todo"])
    end

    test "fetch_issue_states_by_ids delegates to the client" do
      assert {:ok, {:by_ids, ["10001"]}} = Tracker.fetch_issue_states_by_ids(["10001"])
    end
  end

  describe "create_comment/2" do
    test "posts an ADF comment body and returns :ok" do
      assert :ok = Tracker.create_comment("ABC-1", "hello world")
      assert_received {:comment, %{"body" => body}}
      assert body["type"] == "doc"
      assert get_in(body, ["content", Access.at(0), "content", Access.at(0), "text"]) == "hello world"
    end
  end

  describe "update_issue_state/2" do
    test "resolves the matching transition and applies it" do
      assert :ok = Tracker.update_issue_state("ABC-1", "Done")
      assert_received {:transition, %{"transition" => %{"id" => "31"}}}
    end

    test "errors when no transition leads to the target status" do
      assert {:error, :transition_not_found} = Tracker.update_issue_state("ABC-1", "Nonexistent")
    end
  end

  describe "default_prompt_template/0" do
    test "mentions JIRA and uses issue identifier/title placeholders" do
      template = Tracker.default_prompt_template()
      assert template =~ "JIRA"
      assert template =~ "{{ issue.identifier }}"
      assert template =~ "{{ issue.title }}"
    end
  end
end
