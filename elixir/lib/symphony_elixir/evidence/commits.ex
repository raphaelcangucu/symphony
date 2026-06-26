defmodule SymphonyElixir.Evidence.Commits do
  @moduledoc """
  Reads agent commit history from an issue workspace git repos.

  Lists commits reachable from each repo's `HEAD` but not from its integration
  base (`origin/<default>` or upstream). Used by the tracker Evidence tab as
  commit evidence separate from test/e2e manifests.
  """

  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.RepoState

  @type commit :: %{
          repo: String.t(),
          sha: String.t(),
          short_sha: String.t(),
          message: String.t(),
          author: String.t(),
          authored_at: String.t(),
          files_changed: non_neg_integer(),
          insertions: non_neg_integer(),
          deletions: non_neg_integer()
        }

  @type file_change :: %{
          path: String.t(),
          old_path: String.t() | nil,
          status: String.t(),
          patch: String.t()
        }

  @spec list(Path.t(), keyword()) :: {:ok, [commit()]} | {:error, term()}
  def list(workspace, opts \\ []) when is_binary(workspace) do
    default_branches = Keyword.get(opts, :default_branches, %{})

    if File.dir?(workspace) do
      commits =
        workspace
        |> RunContract.repo_states(default_branches: default_branches)
        |> Enum.flat_map(&list_repo_commits/1)
        |> Enum.sort_by(& &1.authored_at, :desc)

      {:ok, commits}
    else
      {:ok, []}
    end
  end

  @spec show(Path.t(), String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def show(workspace, repo_name, sha) when is_binary(workspace) and is_binary(repo_name) and is_binary(sha) do
    with %RepoState{} = repo <- find_repo(workspace, repo_name),
         :ok <- verify_commit(repo, sha),
         {:ok, meta} <- commit_meta(repo, sha),
         {:ok, files} <- commit_files(repo, sha) do
      {:ok, Map.merge(meta, %{repo: repo.name, files: files})}
    else
      nil -> {:error, :repo_not_found}
      {:error, _} = error -> error
    end
  end

  defp find_repo(workspace, repo_name) do
    workspace
    |> RunContract.repo_states()
    |> Enum.find(&(&1.name == repo_name))
  end

  defp list_repo_commits(%RepoState{} = repo) do
    case log_range(repo) do
      nil -> []
      range -> parse_log(repo, range)
    end
  end

  defp log_range(%RepoState{} = repo) do
    case integration_ref(repo) do
      nil -> nil
      ref -> ref_range(repo, ref)
    end
  end

  defp integration_ref(%RepoState{default_branch: branch}) when is_binary(branch) and branch != "", do: branch
  defp integration_ref(_repo), do: nil

  defp ref_range(%RepoState{} = repo, ref) do
    case git(repo.path, ["rev-parse", "--verify", "origin/#{ref}"]) do
      {:ok, _} -> "origin/#{ref}..HEAD"
      {:error, _} -> local_ref_range(repo, ref)
    end
  end

  defp local_ref_range(%RepoState{} = repo, ref) do
    case git(repo.path, ["rev-parse", "--verify", ref]) do
      {:ok, _} -> "#{ref}..HEAD"
      {:error, _} -> nil
    end
  end

  defp parse_log(%RepoState{} = repo, range) do
    case git(repo.path, [
           "log",
           range,
           "--no-merges",
           "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI",
           "--numstat"
         ]) do
      {:ok, output} ->
        output
        |> String.split("\n\n", trim: true)
        |> Enum.map(&parse_log_entry/1)
        |> Enum.reject(&is_nil/1)
        |> Enum.map(&Map.put(&1, :repo, repo.name))

      {:error, _} ->
        []
    end
  end

  defp parse_log_entry(block) do
    case String.split(block, "\n", parts: 2) do
      [header, stats | _] ->
        case String.split(header, <<0x1F::utf8>>, parts: 5) do
          [sha, short_sha, message, author, authored_at] ->
            {files_changed, insertions, deletions} = parse_numstat(stats)

            %{
              sha: sha,
              short_sha: short_sha,
              message: message,
              author: author,
              authored_at: authored_at,
              files_changed: files_changed,
              insertions: insertions,
              deletions: deletions
            }

          _ ->
            nil
        end

      [header] ->
        case String.split(header, <<0x1F::utf8>>, parts: 5) do
          [sha, short_sha, message, author, authored_at] ->
            %{
              sha: sha,
              short_sha: short_sha,
              message: message,
              author: author,
              authored_at: authored_at,
              files_changed: 0,
              insertions: 0,
              deletions: 0
            }

          _ ->
            nil
        end

      _ ->
        nil
    end
  end

  defp parse_numstat(stats) when is_binary(stats) do
    stats
    |> String.split("\n", trim: true)
    |> Enum.reduce({0, 0, 0}, fn line, {files, ins, del} ->
      case String.split(line, "\t", parts: 3) do
        [add, remove, _path] ->
          {files + 1, ins + parse_stat(add), del + parse_stat(remove)}

        _ ->
          {files, ins, del}
      end
    end)
  end

  defp parse_numstat(_), do: {0, 0, 0}

  defp parse_stat("-"), do: 0

  defp parse_stat(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, _} -> n
      :error -> 0
    end
  end

  defp verify_commit(%RepoState{} = repo, sha) do
    case git(repo.path, ["cat-file", "-e", "#{sha}^{commit}"]) do
      {:ok, _} -> :ok
      {:error, _} -> {:error, :commit_not_found}
    end
  end

  defp commit_meta(%RepoState{} = repo, sha) do
    case git(repo.path, ["show", "-s", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI", "--no-patch", sha]) do
      {:ok, header} ->
        case String.split(header, <<0x1F::utf8>>, parts: 5) do
          [full_sha, short_sha, message, author, authored_at] ->
            {:ok,
             %{
               sha: full_sha,
               short_sha: short_sha,
               message: message,
               author: author,
               authored_at: authored_at
             }}

          _ ->
            {:error, :commit_not_found}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp commit_files(%RepoState{} = repo, sha) do
    with {:ok, names} <- git(repo.path, ["diff-tree", "--root", "--no-commit-id", "-r", "--name-status", sha]) do
      files =
        names
        |> String.split("\n", trim: true)
        |> Enum.map(&file_change_from_line(repo, sha, &1))
        |> Enum.reject(&is_nil/1)

      {:ok, files}
    end
  end

  defp file_change_from_line(%RepoState{} = repo, sha, line) do
    case String.split(line, "\t", parts: 3) do
      [<<"R", _::binary>>, old_path, new_path] ->
        build_file_change(repo, sha, new_path, old_path, "renamed")

      [status, path] ->
        build_file_change(repo, sha, path, nil, status_letter(status))

      _ ->
        nil
    end
  end

  defp status_letter("A"), do: "added"
  defp status_letter("D"), do: "deleted"
  defp status_letter("M"), do: "modified"
  defp status_letter("T"), do: "type_changed"
  defp status_letter(other), do: other

  defp build_file_change(%RepoState{} = repo, sha, path, old_path, status) do
    patch =
      case git(repo.path, ["show", "--format=", "--no-color", sha, "--", path]) do
        {:ok, content} -> content
        {:error, _} -> ""
      end

    %{
      path: path,
      old_path: old_path,
      status: status,
      patch: patch
    }
  end

  defp git(path, args) do
    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {output, 0} -> {:ok, String.trim_trailing(output)}
      {output, status} -> {:error, {status, String.trim_trailing(output)}}
    end
  end
end
