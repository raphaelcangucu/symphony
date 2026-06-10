defmodule SymphonyElixir.GitHub.WorkflowRunsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.WorkflowRuns

  test "run_ids/1 extracts unique run ids from failing pipelines" do
    prs = [
      %{
        pipelines: [
          %{
            name: "CI",
            url: "https://github.com/o/r/actions/runs/99",
            jobs: [%{name: "a", conclusion: "FAILURE", status: "COMPLETED"}]
          },
          %{
            name: "Lint",
            url: "https://github.com/o/r/actions/runs/100",
            jobs: [%{name: "b", conclusion: "SUCCESS", status: "COMPLETED"}]
          },
          %{
            name: "NoUrl",
            url: nil,
            jobs: [%{name: "c", conclusion: "FAILURE", status: "COMPLETED"}]
          }
        ]
      }
    ]

    assert WorkflowRuns.run_ids(prs) == [99]
  end

  test "run_ids/1 deduplicates run ids from multiple failing pipelines" do
    url = "https://github.com/o/r/actions/runs/99"

    prs = [
      %{
        pipelines: [
          %{name: "CI", url: url, jobs: [%{conclusion: "FAILURE"}]},
          %{name: "Deploy", url: url, jobs: [%{conclusion: "TIMED_OUT"}]}
        ]
      }
    ]

    assert WorkflowRuns.run_ids(prs) == [99]
  end

  test "rerun_failed_jobs/3 posts to the rerun endpoint" do
    request_fun = fn path, _body, _opts ->
      send(self(), {:posted, path})
      {:ok, %{status: 201, body: %{}}}
    end

    assert :ok = WorkflowRuns.rerun_failed_jobs("o/r", 99, request_fun: request_fun)
    assert_received {:posted, "/repos/o/r/actions/runs/99/rerun-failed-jobs"}
  end

  test "rerun_failed_jobs/3 surfaces non-201 as error" do
    request_fun = fn _path, _body, _opts ->
      {:ok, %{status: 403, body: %{"message" => "forbidden"}}}
    end

    assert {:error, {:rerun_failed, 403, _}} =
             WorkflowRuns.rerun_failed_jobs("o/r", 99, request_fun: request_fun)
  end

  test "rerun_failed_jobs/3 normalizes github_api_status errors" do
    request_fun = fn _path, _body, _opts -> {:error, {:github_api_status, 403}} end

    assert {:error, {:rerun_failed, 403, nil}} =
             WorkflowRuns.rerun_failed_jobs("o/r", 99, request_fun: request_fun)
  end

  test "rerun_failed_jobs/3 passes through unknown errors unchanged" do
    request_fun = fn _path, _body, _opts -> {:error, {:github_api_request, :timeout}} end

    assert {:error, {:github_api_request, :timeout}} =
             WorkflowRuns.rerun_failed_jobs("o/r", 99, request_fun: request_fun)
  end
end
