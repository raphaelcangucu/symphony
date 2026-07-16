defmodule SymphonyElixir.Evidence.WorkspacePush do
  @moduledoc "Pushes ahead workspace branches to origin without creating PRs."

  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.RepoState

  @type push_result ::
          %{repo: String.t(), ok: true} | %{repo: String.t(), ok: false, error: String.t()}

  @spec push(Path.t(), keyword()) :: {:ok, [push_result()]}
  def push(workspace, opts \\ []) when is_binary(workspace) do
    runner = Keyword.get(opts, :runner, &System.cmd/3)

    results =
      workspace
      |> RunContract.repo_states()
      |> Enum.filter(&pushable?/1)
      |> Enum.map(&push_repo(&1, runner))

    {:ok, results}
  end

  defp pushable?(%RepoState{ahead_count: n}) when is_integer(n) and n > 0, do: true
  defp pushable?(_), do: false

  defp push_repo(%RepoState{} = repo, runner) do
    branch = if is_binary(repo.branch) and repo.branch != "", do: repo.branch, else: "HEAD"

    case run(runner, "git", ["push", "-u", "origin", branch], repo.path) do
      :ok -> %{repo: repo.name, ok: true}
      {:error, output} -> %{repo: repo.name, ok: false, error: output}
    end
  end

  defp run(runner, cmd, args, path) do
    case runner.(cmd, args, cd: path, stderr_to_stdout: true) do
      {_output, 0} -> :ok
      {output, _status} -> {:error, String.trim(output)}
    end
  end
end
