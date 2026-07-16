defmodule SymphonyElixir.Evidence.Commits do
  @moduledoc """
  Reads agent commit history from an issue workspace git repos.

  Lists commits reachable from each repo's `HEAD` but not from its integration
  base (`origin/<default>` or upstream). Used by the tracker Evidence tab as
  commit evidence separate from test/e2e manifests.
  """

  alias SymphonyElixir.HotpathCache
  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.RepoState

  # Tried after the configured/origin default when that ref is missing locally
  # (stale project config or shallow clones without origin/HEAD).
  @fallback_integration_branches ~w(main master develop pre-release homolog trunk)

  @default_limit 20
  @max_limit 100
  # Fresh window for the light commit index; stale-while-revalidate keeps the UI
  # responsive while a single background refresh rebuilds after HEAD/upstream drift.
  @cache_ttl_ms 5_000
  @cache_stale_ms 60_000
  @cache_wait_ms 30_000

  @type commit :: %{
          repo: String.t(),
          sha: String.t(),
          short_sha: String.t(),
          message: String.t(),
          author: String.t(),
          authored_at: String.t(),
          files_changed: non_neg_integer(),
          insertions: non_neg_integer(),
          deletions: non_neg_integer(),
          online: boolean()
        }

  @type commit_page :: %{
          commits: [commit()],
          total: non_neg_integer(),
          limit: pos_integer(),
          next_cursor: String.t() | nil
        }

  @type file_change :: %{
          path: String.t(),
          old_path: String.t() | nil,
          status: String.t(),
          patch: String.t()
        }

  @spec list(Path.t(), keyword()) :: {:ok, commit_page()} | {:error, term()}
  def list(workspace, opts \\ []) when is_binary(workspace) do
    with {:ok, offset} <- decode_cursor(Keyword.get(opts, :cursor)) do
      default_branches = Keyword.get(opts, :default_branches, %{})
      limit = clamp_limit(Keyword.get(opts, :limit))

      if File.dir?(workspace) do
        {:ok, cached_page(workspace, default_branches, offset, limit)}
      else
        {:ok, %{commits: [], total: 0, limit: limit, next_cursor: nil}}
      end
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

  defp cached_page(workspace, default_branches, offset, limit) do
    repos = RunContract.repo_states(workspace, default_branches: default_branches)
    fingerprint = workspace_fingerprint(repos)
    page_key = {:commit_evidence_page, workspace, fingerprint, default_branches, offset, limit}

    HotpathCache.fetch_or_store(
      page_key,
      @cache_ttl_ms,
      fn -> build_page(workspace, repos, default_branches, fingerprint, offset, limit) end,
      stale_ms: @cache_stale_ms,
      wait_ms: @cache_wait_ms
    )
  end

  defp build_page(workspace, repos, default_branches, fingerprint, offset, limit) do
    commits =
      workspace
      |> load_light_commits(repos, default_branches, fingerprint)
      |> Enum.sort_by(& &1.authored_at, :desc)

    total = length(commits)

    page =
      commits
      |> Enum.slice(offset, limit)
      |> enrich_page_stats(workspace)

    %{
      commits: page,
      total: total,
      limit: limit,
      next_cursor: encode_cursor(offset + limit, total)
    }
  end

  defp load_light_commits(workspace, repos, default_branches, fingerprint) do
    cache_key = {:commit_evidence_index, workspace, fingerprint, default_branches}

    HotpathCache.fetch_or_store(
      cache_key,
      @cache_ttl_ms,
      fn -> Enum.flat_map(repos, &list_repo_commits_light/1) end,
      stale_ms: @cache_stale_ms,
      wait_ms: @cache_wait_ms
    )
  end
  defp workspace_fingerprint(repos) when is_list(repos) do
    Enum.map(repos, fn %RepoState{} = repo ->
      head =
        case git(repo.path, ["rev-parse", "HEAD"]) do
          {:ok, sha} -> sha
          {:error, _} -> ""
        end

      tip = remote_feature_tip(repo) || ""
      {repo.name, head, tip}
    end)
  end

  defp find_repo(workspace, repo_name) do
    workspace
    |> RunContract.repo_states()
    |> Enum.find(&(&1.name == repo_name))
  end

  # Light index: no --numstat (expensive on long ranges) and one rev-list for
  # online status instead of per-commit merge-base.
  defp list_repo_commits_light(%RepoState{} = repo) do
    unpushed = unpushed_sha_set(repo)

    case log_range(repo) do
      nil ->
        []

      range ->
        repo
        |> parse_light_log(range)
        |> Enum.map(fn commit ->
          online =
            case unpushed do
              :all_local -> false
              %MapSet{} = set -> not MapSet.member?(set, commit.sha)
            end

          Map.put(commit, :online, online)
        end)
    end
  end

  defp unpushed_sha_set(%RepoState{} = repo) do
    case remote_feature_tip(repo) do
      nil ->
        :all_local

      tip ->
        case git(repo.path, ["rev-list", "--no-merges", "#{tip}..HEAD"]) do
          {:ok, output} ->
            output |> String.split("\n", trim: true) |> MapSet.new()

          {:error, _} ->
            :all_local
        end
    end
  end

  defp remote_feature_tip(%RepoState{} = repo) do
    case git(repo.path, ["rev-parse", "@{upstream}"]) do
      {:ok, tip} -> tip
      {:error, _} -> remote_origin_branch_tip(repo)
    end
  end

  defp remote_origin_branch_tip(%RepoState{branch: branch} = repo)
       when is_binary(branch) and branch != "" do
    case git(repo.path, ["rev-parse", "--verify", "origin/#{branch}"]) do
      {:ok, tip} -> tip
      {:error, _} -> nil
    end
  end

  defp remote_origin_branch_tip(_repo), do: nil

  defp enrich_page_stats([], _workspace), do: []

  defp enrich_page_stats(commits, workspace) do
    commits
    |> Enum.group_by(& &1.repo)
    |> Enum.flat_map(fn {repo_name, repo_commits} ->
      path = Path.join(workspace, repo_name)
      stats_by_sha = numstat_by_sha(path, Enum.map(repo_commits, & &1.sha))

      Enum.map(repo_commits, fn commit ->
        {files_changed, insertions, deletions} = Map.get(stats_by_sha, commit.sha, {0, 0, 0})

        commit
        |> Map.put(:files_changed, files_changed)
        |> Map.put(:insertions, insertions)
        |> Map.put(:deletions, deletions)
      end)
    end)
    |> Enum.sort_by(& &1.authored_at, :desc)
  end

  defp numstat_by_sha(_path, []), do: %{}

  defp numstat_by_sha(path, shas) when is_list(shas) do
    args = ["log", "--no-walk", "--pretty=format:%H", "--numstat" | shas]

    case git(path, args) do
      {:ok, output} -> parse_numstat_blocks(output)
      {:error, _} -> %{}
    end
  end

  defp parse_numstat_blocks(output) when is_binary(output) do
    output
    |> String.split("\n\n", trim: true)
    |> Enum.reduce(%{}, fn block, acc ->
      case String.split(block, "\n", parts: 2) do
        [sha, stats] ->
          Map.put(acc, String.trim(sha), parse_numstat(stats))

        [sha] ->
          Map.put(acc, String.trim(sha), {0, 0, 0})

        _ ->
          acc
      end
    end)
  end

  defp log_range(%RepoState{} = repo) do
    repo
    |> integration_candidates()
    |> Enum.find_value(&ref_range(repo, &1))
  end

  defp integration_candidates(%RepoState{default_branch: branch}) do
    [branch | @fallback_integration_branches]
    |> Enum.reject(&(is_nil(&1) or &1 == ""))
    |> Enum.uniq()
  end

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

  defp parse_light_log(%RepoState{} = repo, range) do
    case git(repo.path, [
           "log",
           range,
           "--no-merges",
           "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI"
         ]) do
      {:ok, output} ->
        output
        |> String.split("\n", trim: true)
        |> Enum.map(&parse_light_log_line/1)
        |> Enum.reject(&is_nil/1)
        |> Enum.map(&Map.put(&1, :repo, repo.name))

      {:error, _} ->
        []
    end
  end

  defp parse_light_log_line(line) do
    case String.split(line, <<0x1F::utf8>>, parts: 5) do
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

  defp clamp_limit(nil), do: @default_limit

  defp clamp_limit(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, _} -> clamp_limit(n)
      :error -> @default_limit
    end
  end

  defp clamp_limit(value) when is_integer(value) and value > 0, do: min(value, @max_limit)
  defp clamp_limit(_), do: @default_limit

  defp decode_cursor(nil), do: {:ok, 0}

  defp decode_cursor(cursor) when is_binary(cursor) do
    with {:ok, decoded} <- Base.url_decode64(cursor, padding: false),
         {offset, ""} <- Integer.parse(decoded),
         true <- offset >= 0 do
      {:ok, offset}
    else
      _ -> {:error, :invalid_cursor}
    end
  end

  defp decode_cursor(_), do: {:error, :invalid_cursor}

  defp encode_cursor(next_offset, total) when next_offset < total do
    next_offset |> Integer.to_string() |> Base.url_encode64(padding: false)
  end

  defp encode_cursor(_next_offset, _total), do: nil
end
