defmodule SymphonyElixir.Evidence.GitDiff do
  @moduledoc """
  Computes changed files per workspace repo against the merge-base with the
  default branch, including uncommitted changes. Drives the orchestrator-owned
  `ui_change` decision (the agent's judgment is not trusted for the gate).
  """

  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.RepoState

  @spec changed_files(Path.t()) :: %{String.t() => [String.t()]}
  def changed_files(workspace) do
    workspace
    |> RunContract.repo_states()
    |> Map.new(fn repo -> {repo.name, repo_changed_files(repo)} end)
    |> Enum.reject(fn {_name, files} -> files == [] end)
    |> Map.new()
  end

  @doc """
  True when any changed file (prefixed with its repo subdir, e.g.
  `frontend/src/App.tsx`) matches one of the `ui_paths` globs.
  """
  @spec ui_change?(%{String.t() => [String.t()]}, [String.t()]) :: boolean()
  def ui_change?(_changed, []), do: false

  def ui_change?(changed, ui_paths) do
    patterns = Enum.map(ui_paths, &glob_to_regex/1)

    Enum.any?(changed, fn {repo, files} ->
      Enum.any?(files, fn file ->
        full = repo <> "/" <> file
        Enum.any?(patterns, &Regex.match?(&1, full))
      end)
    end)
  end

  defp repo_changed_files(%RepoState{} = repo) do
    committed = git_lines(repo.path, ["diff", "--name-only", diff_base(repo)])

    uncommitted =
      repo.path
      |> git_lines(["status", "--porcelain"])
      |> Enum.map(&porcelain_path/1)

    (committed ++ uncommitted)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
    |> Enum.sort()
  end

  defp diff_base(%RepoState{default_branch: default}) when is_binary(default),
    do: "origin/#{default}...HEAD"

  defp diff_base(_repo), do: "HEAD"

  defp git_lines(path, args) do
    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {output, 0} -> String.split(output, "\n", trim: true)
      {_output, _status} -> []
    end
  end

  # "?? new.php" / " M src/x.ts" → path; handles rename "R  old -> new"
  defp porcelain_path(line) do
    line
    |> String.slice(3..-1//1)
    |> String.split(" -> ")
    |> List.last()
    |> String.trim()
  end

  # Glob → regex: ** matches any depth, * matches within a segment.
  defp glob_to_regex(glob) do
    pattern =
      glob
      |> Regex.escape()
      |> String.replace("\\*\\*", "GLOBSTAR")
      |> String.replace("\\*", "[^/]*")
      |> String.replace("GLOBSTAR", ".*")

    Regex.compile!("^" <> pattern <> "$")
  end
end
