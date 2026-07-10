defmodule SymphonyElixir.Evidence.WorkspaceDiff do
  @moduledoc """
  Computes full unified per-file patches for an issue workspace.

  Supports two diff types:

    * `:uncommitted` — working-tree changes (tracked edits vs `HEAD` plus
      untracked files).
    * `:branch` — `HEAD` vs the merge-base with the default branch
      (`origin/<default>...HEAD`), matching the existing Evidence.GitDiff base.

  Returns the same file-change shape as `Evidence.Commits` so tracker UI can
  render uncommitted, branch, and commit diffs through one component.
  """

  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.RepoState

  @type diff_type :: :uncommitted | :branch
  @type file_change :: %{
          path: String.t(),
          old_path: String.t() | nil,
          status: String.t(),
          patch: String.t()
        }
  @type repo_diff :: %{
          repo: String.t(),
          branch: String.t() | nil,
          base: String.t() | nil,
          ahead: non_neg_integer(),
          behind: non_neg_integer() | nil,
          files: [file_change()]
        }

  @spec changes(Path.t(), diff_type()) :: {:ok, [repo_diff()]} | {:error, :invalid_diff_type}
  def changes(workspace, type) when is_binary(workspace) and type in [:uncommitted, :branch] do
    if File.dir?(workspace) do
      repos =
        workspace
        |> RunContract.repo_states()
        |> Enum.map(fn repo_state ->
          files = repo_files(repo_state, type)

          %{
            repo: repo_state.name,
            branch: repo_state.branch,
            base: repo_state.default_branch,
            ahead: ahead_count(repo_state),
            behind: behind_count(repo_state),
            files: files
          }
        end)
        |> Enum.reject(fn %{files: files} -> files == [] end)

      {:ok, repos}
    else
      {:ok, []}
    end
  end

  def changes(_workspace, _type), do: {:error, :invalid_diff_type}

  defp ahead_count(%RepoState{path: path, default_branch: default})
       when is_binary(default) and default != "" do
    case git(path, ["rev-list", "--count", "origin/#{default}..HEAD"]) do
      {:ok, output} ->
        case Integer.parse(String.trim(output)) do
          {n, _} -> n
          :error -> 0
        end

      {:error, _} ->
        0
    end
  end

  defp ahead_count(_), do: 0

  defp behind_count(%RepoState{path: path, default_branch: default})
       when is_binary(default) and default != "" do
    case git(path, ["rev-list", "--count", "HEAD..origin/#{default}"]) do
      {:ok, output} ->
        case Integer.parse(String.trim(output)) do
          {n, _} -> n
          :error -> nil
        end

      {:error, _} ->
        nil
    end
  end

  defp behind_count(_), do: nil

  defp repo_files(%RepoState{} = repo, :branch) do
    base = diff_base(repo)

    repo
    |> name_status(["diff", "--no-color", "--name-status", base])
    |> Enum.map(&file_change(repo, &1, ["diff", "--no-color", base, "--"]))
  end

  defp repo_files(%RepoState{} = repo, :uncommitted) do
    tracked =
      repo
      |> name_status(["diff", "--no-color", "--name-status", "HEAD"])
      |> Enum.map(&file_change(repo, &1, ["diff", "--no-color", "HEAD", "--"]))

    untracked =
      repo
      |> untracked_files()
      |> Enum.map(&untracked_change(repo, &1))

    tracked ++ untracked
  end

  defp diff_base(%RepoState{default_branch: default}) when is_binary(default) and default != "",
    do: "origin/#{default}...HEAD"

  defp diff_base(_repo), do: "HEAD"

  defp name_status(%RepoState{} = repo, args) do
    case git(repo.path, args) do
      {:ok, output} ->
        output
        |> String.split("\n", trim: true)
        |> Enum.map(&parse_status_line/1)
        |> Enum.reject(&is_nil/1)

      {:error, _} ->
        []
    end
  end

  defp parse_status_line(line) do
    case String.split(line, "\t", parts: 3) do
      [<<"R", _::binary>>, old_path, new_path] -> {"renamed", new_path, old_path}
      [<<"C", _::binary>>, old_path, new_path] -> {"copied", new_path, old_path}
      [status, path] -> {status_letter(status), path, nil}
      _ -> nil
    end
  end

  defp status_letter("A"), do: "added"
  defp status_letter("D"), do: "deleted"
  defp status_letter("M"), do: "modified"
  defp status_letter("T"), do: "type_changed"
  defp status_letter(other), do: other

  defp file_change(%RepoState{} = repo, {status, path, old_path}, patch_prefix_args) do
    patch =
      case git(repo.path, patch_prefix_args ++ [path]) do
        {:ok, content} -> content
        {:error, _} -> ""
      end

    %{path: path, old_path: old_path, status: status, patch: patch}
  end

  defp untracked_files(%RepoState{} = repo) do
    case git(repo.path, ["ls-files", "--others", "--exclude-standard"]) do
      {:ok, output} -> String.split(output, "\n", trim: true)
      {:error, _} -> []
    end
  end

  defp untracked_change(%RepoState{} = repo, path) do
    patch =
      case git_allow_diff_exit(repo.path, ["diff", "--no-color", "--no-index", "--", "/dev/null", path]) do
        {:ok, content} -> normalize_untracked_patch(content, path)
        {:error, _} -> ""
      end

    %{path: path, old_path: nil, status: "added", patch: patch}
  end

  defp normalize_untracked_patch(patch, path) do
    patch
    |> String.replace("a/dev/null", "/dev/null")
    |> String.replace("b/#{path}", "b/#{path}")
  end

  defp git(path, args) do
    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {output, 0} -> {:ok, String.trim_trailing(output)}
      {output, status} -> {:error, {status, String.trim_trailing(output)}}
    end
  end

  defp git_allow_diff_exit(path, args) do
    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {output, status} when status in [0, 1] -> {:ok, String.trim_trailing(output)}
      {output, status} -> {:error, {status, String.trim_trailing(output)}}
    end
  end
end
