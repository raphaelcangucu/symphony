defmodule SymphonyElixir.KnowledgeBase.GitFlow do
  @moduledoc """
  Composable steps that promote knowledge base edits from `symphony-docs` to the
  repository default branch: sync (merge default in + push), ensure PR, and
  evaluate checks + squash-merge. All external effects are injectable so the core
  is unit-testable without a network.
  """

  alias SymphonyElixir.GitHub.{Api, PullRequestCreate}
  alias SymphonyElixir.KnowledgeBase.Git
  alias SymphonyElixir.PullRequestMerge

  @merge_method "squash"
  @running_statuses ~w(IN_PROGRESS QUEUED PENDING WAITING REQUESTED)

  @spec sync_branch(map(), String.t(), keyword()) ::
          {:ok, :merged | :up_to_date} | {:error, term()}
  def sync_branch(ws, default_branch, opts \\ []) do
    with :ok <- Git.fetch(ws.worktree, opts),
         {:ok, merge_result} <- Git.merge(ws.worktree, "origin/#{default_branch}", opts),
         :ok <- Git.push(ws.worktree, ws.branch, opts) do
      {:ok, merge_result}
    end
  end

  @spec ensure_pull_request(String.t(), String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def ensure_pull_request(repo, head_branch, opts \\ []) do
    PullRequestCreate.ensure(repo, head_branch, opts)
  end

  @spec evaluate_and_merge(%{repo: String.t(), project: term()}, pos_integer(), keyword()) ::
          {:ok, :merged | :pending} | {:error, :kb_checks_failed | term()}
  def evaluate_and_merge(%{repo: repo, project: project}, number, deps \\ []) do
    detail = Keyword.get(deps, :detail, &default_detail/3)
    merge = Keyword.get(deps, :merge, &default_merge/4)

    case detail.(repo, number, []) do
      {:ok, %{checks_state: "SUCCESS", any_running: false} = pr} ->
        if Map.get(pr, :mergeable) == false do
          {:error, :pull_request_not_mergeable}
        else
          case merge.(project, number, @merge_method, []) do
            {:ok, _} -> {:ok, :merged}
            {:error, reason} -> {:error, reason}
          end
        end

      {:ok, %{checks_state: state}} when state in ["FAILURE", "ERROR"] ->
        {:error, :kb_checks_failed}

      {:ok, _pending} ->
        {:ok, :pending}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp default_detail(repo, number, opts) do
    case Api.pull_request_detail(repo, number, opts) do
      {:ok, nil} -> {:error, :pull_request_not_found}
      {:ok, pr} -> {:ok, normalize_detail(pr)}
      error -> error
    end
  end

  defp normalize_detail(pr) do
    %{
      checks_state: pr |> Map.get(:checks_state) |> to_string() |> String.upcase(),
      mergeable: Map.get(pr, :mergeable) != "CONFLICTING",
      any_running: any_running?(pr)
    }
  end

  defp any_running?(pr) do
    pr
    |> Map.get(:pipelines, [])
    |> Enum.flat_map(fn pipeline -> Map.get(pipeline, :jobs, []) end)
    |> Enum.any?(&running_job?/1)
  end

  defp running_job?(job) do
    status = job |> Map.get(:status) |> to_string() |> String.upcase()
    status in @running_statuses
  end

  defp default_merge(project, number, method, opts) do
    PullRequestMerge.merge(project, number, method, opts)
  end
end
