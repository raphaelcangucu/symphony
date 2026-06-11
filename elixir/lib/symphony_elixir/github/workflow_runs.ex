defmodule SymphonyElixir.GitHub.WorkflowRuns do
  @moduledoc """
  GitHub Actions workflow-run helpers: extracting run ids from PR pipelines
  and re-running only the failed jobs of a run.
  """

  alias SymphonyElixir.GitHub.Client

  # STALE omitted: GitHub marks runs stale when superseded; retrying does not help.
  @failure_conclusions ~w(FAILURE TIMED_OUT CANCELLED STARTUP_FAILURE ACTION_REQUIRED)
  @run_id_pattern ~r{/actions/runs/(\d+)}

  @spec run_ids([map()]) :: [pos_integer()]
  def run_ids(prs) when is_list(prs) do
    prs
    |> Enum.flat_map(&Map.get(&1, :pipelines, []))
    |> Enum.filter(&pipeline_failing?/1)
    |> Enum.flat_map(&extract_run_id/1)
    |> Enum.uniq()
  end

  @spec rerun_failed_jobs(String.t(), pos_integer(), keyword()) :: :ok | {:error, term()}
  def rerun_failed_jobs(repo, run_id, opts \\ [])
      when is_binary(repo) and is_integer(run_id) and run_id > 0 do
    request_fun = Keyword.get(opts, :request_fun, &default_request/3)
    request_opts = Keyword.delete(opts, :request_fun)

    case request_fun.("/repos/#{repo}/actions/runs/#{run_id}/rerun-failed-jobs", %{}, request_opts) do
      {:ok, %{status: 201}} -> :ok
      {:ok, %{status: status, body: body}} -> {:error, {:rerun_failed, status, body}}
      {:error, {:github_api_status, status}} -> {:error, {:rerun_failed, status, nil}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp default_request(path, body, _opts), do: Client.rest_post(path, body, [])

  defp pipeline_failing?(pipeline) do
    pipeline
    |> Map.get(:jobs, [])
    |> Enum.any?(fn job ->
      String.upcase(to_string(job[:conclusion])) in @failure_conclusions
    end)
  end

  defp extract_run_id(pipeline) do
    case Map.get(pipeline, :url) do
      url when is_binary(url) ->
        case Regex.run(@run_id_pattern, url) do
          [_, id] -> [String.to_integer(id)]
          _ -> []
        end

      _ ->
        []
    end
  end
end
