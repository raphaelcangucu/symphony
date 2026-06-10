defmodule SymphonyElixir.PullRequestFixTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.PullRequestFix

  defmodule StubAdapter do
    @behaviour SymphonyElixir.Tracker.IssueAdapter

    def kind, do: :github
    def list_issues(_p, _f), do: {:ok, []}
    def get_issue(_p, _i), do: {:error, :issue_not_found}
    def create_issue(_p, _a), do: {:error, :not_supported_on_remote}
    def update_issue(_p, _i, _a), do: {:error, :not_supported_on_remote}
    def list_statuses(_p), do: {:ok, []}
    def list_labels(_p), do: {:ok, []}
    def list_assignable_users(_p), do: {:ok, []}
    def list_comments(_p, _i), do: {:ok, []}

    def add_comment(_p, _i, body, _a) do
      send(self(), {:added_comment, body})
      {:ok, %{id: "c1", body: body}}
    end

    def move_issue(_p, _i, attrs) do
      send(self(), {:moved, attrs})
      {:ok, %{id: "i1"}}
    end
  end

  defmodule FailingChecksClient do
    def graphql(query, _vars, _opts) when is_binary(query) do
      {:ok,
       %{
         "data" => %{
           "repository" => %{
             "issue" => %{
               "linkedBranches" => %{"nodes" => []},
               "timelineItems" => %{"nodes" => []},
               "closedByPullRequestsReferences" => %{
                 "nodes" => [
                   %{
                     "number" => 509,
                     "title" => "docs: add llms.txt",
                     "url" => "https://github.com/acme/app/pull/509",
                     "state" => "OPEN",
                     "updatedAt" => "2026-05-29T00:00:00Z",
                     "commits" => %{
                       "nodes" => [
                         %{
                           "commit" => %{
                             "statusCheckRollup" => %{
                               "state" => "FAILURE",
                               "contexts" => %{
                                 "nodes" => [
                                   %{
                                     "__typename" => "CheckRun",
                                     "name" => "vitest / test",
                                     "conclusion" => "FAILURE",
                                     "databaseId" => 9,
                                     "detailsUrl" => "https://github.com/acme/app/actions/runs/1/job/9"
                                   }
                                 ]
                               }
                             }
                           }
                         }
                       ]
                     }
                   }
                 ]
               }
             }
           }
         }
       }}
    end

    def rest_get(_path, _opts), do: {:ok, %{status: 200, body: "2026-05-29T00:00:00Z ##[error]boom"}}
  end

  defmodule EmptyChecksClient do
    def graphql(_q, _v, _o) do
      {:ok,
       %{
         "data" => %{
           "repository" => %{
             "issue" => %{
               "linkedBranches" => %{"nodes" => []},
               "timelineItems" => %{"nodes" => []},
               "closedByPullRequestsReferences" => %{"nodes" => []}
             }
           }
         }
       }}
    end

    def rest_get(_p, _o), do: {:ok, %{status: 200, body: ""}}
  end

  describe "failing_entries/3" do
    test "collects failing jobs with log excerpts" do
      pr = %{
        number: 7,
        title: "t",
        url: "u",
        pipelines: [
          %{
            name: "CI",
            url: nil,
            jobs: [
              %{name: "test", status: "COMPLETED", conclusion: "FAILURE", url: nil, job_id: 1}
            ]
          }
        ]
      }

      entries =
        PullRequestFix.failing_entries("o/r", [pr], check_logs: fn _repo, _id -> {:ok, "boom"} end)

      assert [%{job: %{name: "test"}, excerpt: "boom"}] = entries
    end
  end

  describe "build_comment/1" do
    test "renders PR section, failing job and excerpt" do
      entries = [
        %{
          pr: %{number: 509, title: "docs: add llms.txt", url: "https://github.com/acme/app/pull/509"},
          pipeline: %{name: "CI/CD Pipeline"},
          job: %{name: "vitest / test", conclusion: "FAILURE", url: "https://github.com/acme/app/runs/9", job_id: 9},
          excerpt: "ReferenceError: window is not defined"
        }
      ]

      body = PullRequestFix.build_comment(entries)

      assert body =~ "## CI failure"
      assert body =~ "PR #509"
      assert body =~ "docs: add llms.txt"
      assert body =~ "vitest / test"
      assert body =~ "FAILURE"
      assert body =~ "```log"
      assert body =~ "ReferenceError: window is not defined"
    end

    test "notes when a log excerpt is unavailable" do
      entries = [
        %{
          pr: %{number: 1, title: "t", url: "u"},
          pipeline: %{name: "CI"},
          job: %{name: "build", conclusion: "FAILURE", url: "j", job_id: nil},
          excerpt: nil
        }
      ]

      assert PullRequestFix.build_comment(entries) =~ "log unavailable"
    end

    test "accepts a custom header" do
      entries = [
        %{
          pr: %{number: 7, title: "t", url: "u"},
          job: %{name: "test", conclusion: "FAILURE", url: nil},
          excerpt: "boom"
        }
      ]

      comment =
        PullRequestFix.build_comment(entries,
          header: "## CI failure — automated fix requested (attempt 1/2)\n\n"
        )

      assert String.starts_with?(comment, "## CI failure — automated fix requested (attempt 1/2)")
      assert comment =~ "boom"
    end
  end

  describe "request_fix/2" do
    setup do
      Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => StubAdapter})
      Application.put_env(:symphony_elixir, :github_client_module, FailingChecksClient)

      on_exit(fn ->
        Application.delete_env(:symphony_elixir, :issue_adapters)
        Application.delete_env(:symphony_elixir, :github_client_module)
      end)

      project = %SymphonyElixir.LocalTracker.Project{
        tracker_kind: "github",
        tracker_config: %{"repo" => "acme/app"}
      }

      {:ok, project: project}
    end

    test "posts a comment then moves the issue to Rework", %{project: project} do
      assert {:ok, %{status: "Rework", jobs: [%{name: "vitest / test"}]}} =
               PullRequestFix.request_fix(project, "509")

      assert_received {:added_comment, body}
      assert body =~ "vitest / test"
      assert body =~ "boom"
      assert_received {:moved, %{"status" => "Rework"}}
    end

    test "returns :no_failing_checks when nothing failed", %{project: project} do
      Application.put_env(:symphony_elixir, :github_client_module, EmptyChecksClient)
      assert {:error, :no_failing_checks} = PullRequestFix.request_fix(project, "509")
    end
  end
end
