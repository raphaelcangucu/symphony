defmodule SymphonyElixirWeb.Tracker.PullRequestRerunController do
  @moduledoc """
  Re-runs failed GitHub Actions jobs for a pull request linked to an issue.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.{PullRequests, WorkflowRuns}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug, "identifier" => identifier, "number" => number}) do
    with {:ok, parsed_number} <- parse_number(number),
         {:ok, project} <- Context.get_project(project_slug),
         {:ok, repo} <- PullRequests.resolve_repo(project),
         {:ok, prs} <- PullRequests.for_issue(repo, identifier),
         run_ids <- run_ids_for(prs, parsed_number),
         :ok <- ensure_runs(run_ids) do
      request_fun = fn path, body, opts -> github_client().rest_post(path, body, opts) end

      reruns =
        Enum.map(run_ids, &rerun_result(repo, &1, request_fun))

      json(conn, %{data: %{reruns: reruns}})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp parse_number(number) when is_binary(number) do
    case Integer.parse(number) do
      {parsed, ""} when parsed > 0 -> {:ok, parsed}
      _other -> {:error, :invalid_pr_number}
    end
  end

  defp parse_number(_number), do: {:error, :invalid_pr_number}

  defp run_ids_for(prs, parsed_number) do
    prs
    |> Enum.filter(&(&1.number == parsed_number))
    |> WorkflowRuns.run_ids()
  end

  defp ensure_runs([]), do: {:error, :no_failed_runs}
  defp ensure_runs([_ | _]), do: :ok

  defp rerun_result(repo, run_id, request_fun) do
    case WorkflowRuns.rerun_failed_jobs(repo, run_id, request_fun: request_fun) do
      :ok ->
        %{run_id: run_id, ok: true}

      {:error, {:rerun_failed, status, _body}} ->
        %{run_id: run_id, ok: false, error: "rerun_failed", status: status}

      {:error, {:rate_limited, _info}} ->
        %{run_id: run_id, ok: false, error: "rate_limited"}

      {:error, _reason} ->
        %{run_id: run_id, ok: false, error: "request_failed"}
    end
  end

  defp github_client do
    Application.get_env(:symphony_elixir, :github_client_module, SymphonyElixir.GitHub.Client)
  end
end
