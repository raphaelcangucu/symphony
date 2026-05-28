defmodule SymphonyElixir.LocalTracker.DevEnv.Proposer do
  @moduledoc """
  Proposes dev-env steps for a project workspace, convention-first.

  For each repository: if a `.symphony/devenv.*` convention file exists, its steps
  are used verbatim; otherwise heuristics fill in. Every proposed step is tagged
  with the repo's `working_dir`.
  """

  alias SymphonyElixir.LocalTracker.DevEnv.{ConventionReader, HeuristicDiscoverer, ProposedStep}

  @type repo :: %{required(:workspace_path) => String.t(), optional(:github_full_name) => String.t()}

  @spec propose(Path.t(), [repo()]) :: [ProposedStep.t()]
  def propose(workspace_root, repositories) when is_binary(workspace_root) and is_list(repositories) do
    Enum.flat_map(repositories, fn repo ->
      workspace_path = Map.get(repo, :workspace_path) || Map.get(repo, "workspace_path")
      repo_root = Path.join(workspace_root, workspace_path)

      repo_root
      |> steps_for_repo()
      |> Enum.map(&with_working_dir(&1, workspace_path))
    end)
  end

  defp steps_for_repo(repo_root) do
    case ConventionReader.read(repo_root) do
      {:ok, steps} when steps != [] -> steps
      _ -> HeuristicDiscoverer.discover(repo_root)
    end
  end

  defp with_working_dir(%ProposedStep{working_dir: nil} = step, workspace_path) do
    %{step | working_dir: workspace_path}
  end

  defp with_working_dir(%ProposedStep{} = step, _workspace_path), do: step
end
