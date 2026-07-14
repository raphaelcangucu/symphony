defmodule SymphonyElixir.Evidence.WorkspaceDiff do
  @moduledoc """
  Computes git diffs for an issue/thread workspace at three levels of detail:

    * `stats/2` — aggregate counters per repo (files changed, +/-, untracked
      count) via `git diff --numstat`. No per-file data, no patches.
    * `list_files/2` — the merged file list (name-status + numstat + untracked)
      for a workspace, filtered/sorted/paged in memory. Exactly two or three
      git commands run per repo *regardless of how many files changed*, so the
      cost does not scale with the size of the diff.
    * `patch/3` — the unified patch for exactly one file, truncated by byte
      and line caps so a single huge file cannot blow up a response.

  `changes/2` is the legacy full-diff route kept for existing tracker UI
  consumers; it now caps the number of per-file patches it will materialize
  (`@legacy_max_files`) and reports `truncated: true` on any repo whose file
  list was cut off, instead of shelling out once per changed file with no
  bound.

  All repo discovery here is intentionally local-only: no `ls-remote` (or any
  other network call) is made. The default branch is read from the local
  `origin/HEAD` symref (set once at clone/push time), optionally overridden by
  a caller-supplied `default_branches` map (e.g. a project's configured
  default branch). This is a deliberately lighter, decoupled rewrite of
  `RunContract.repo_states/2` — that function always shells out to
  `ls-remote` per repo (to compute `upstream?`), which this module never
  needs.

  `list_files/2` and `stats/2` use `--no-renames` when diffing so a changed
  path can be looked up by a single key across the name-status and numstat
  outputs; renames show up as a delete + an add. `changes/2` and `patch/3`
  keep full rename/copy detection, matching prior behavior.

  Every public function accepts a `:runner` option (defaults to
  `&System.cmd/3`) so tests can inject a fake git runner — to simulate a
  huge diff cheaply, or to assert the number of subprocess calls stays
  constant as the simulated file count grows.
  """

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
          files: [file_change()],
          truncated: boolean()
        }
  @type repo_stat :: %{
          repo: String.t(),
          branch: String.t() | nil,
          base: String.t() | nil,
          files_changed: non_neg_integer(),
          additions: non_neg_integer(),
          deletions: non_neg_integer(),
          untracked: non_neg_integer()
        }
  @type file_entry :: %{
          repo: String.t(),
          path: String.t(),
          old_path: String.t() | nil,
          status: String.t(),
          additions: non_neg_integer() | nil,
          deletions: non_neg_integer() | nil,
          binary: boolean()
        }
  @type file_page :: %{
          files: [file_entry()],
          total: non_neg_integer(),
          limit: pos_integer(),
          next_cursor: String.t() | nil
        }
  @type patch_result :: %{
          repo: String.t(),
          path: String.t(),
          status: String.t(),
          binary: boolean(),
          truncated: boolean(),
          patch: String.t()
        }

  @diff_types [:uncommitted, :branch]

  @legacy_max_files 300

  @default_limit 100
  @max_limit 500

  @default_max_bytes 200_000
  @hard_max_bytes 2_000_000
  @default_max_lines 4_000
  @hard_max_lines 50_000

  defmodule Repo do
    @moduledoc false
    @enforce_keys [:path, :name]
    defstruct [:path, :name, :branch, :default_branch]

    @type t :: %__MODULE__{
            path: Path.t(),
            name: String.t(),
            branch: String.t() | nil,
            default_branch: String.t() | nil
          }
  end

  ## -- stats -----------------------------------------------------------

  @doc """
  Aggregate diff counters per repo: files changed, insertions, deletions
  (from `git diff --numstat`), and untracked file count. No patches, no
  per-file breakdown — just enough for a badge/summary.

  `opts` must include `:type` (`:uncommitted` or `:branch`). Also accepts
  `:default_branches` and `:runner` (see moduledoc).
  """
  @spec stats(Path.t(), keyword()) :: {:ok, [repo_stat()]} | {:error, :invalid_diff_type}
  def stats(workspace, opts) when is_binary(workspace) and is_list(opts) do
    with {:ok, type} <- fetch_type(opts) do
      git = make_git(opts)
      default_branches = Keyword.get(opts, :default_branches, %{})

      if File.dir?(workspace) do
        stats =
          workspace
          |> local_repos(git, default_branches)
          |> Enum.map(&repo_stat(&1, type, git))
          |> Enum.reject(&(&1.files_changed == 0))

        {:ok, stats}
      else
        {:ok, []}
      end
    end
  end

  def stats(_workspace, _opts), do: {:error, :invalid_diff_type}

  defp repo_stat(%Repo{} = repo, type, git) do
    {files_changed, additions, deletions} = numstat_totals(repo, diff_base_args(repo, type), git)
    untracked = if type == :uncommitted, do: length(untracked_files(repo, git)), else: 0

    %{
      repo: repo.name,
      branch: repo.branch,
      base: repo.default_branch,
      files_changed: files_changed + untracked,
      additions: additions,
      deletions: deletions,
      untracked: untracked
    }
  end

  defp numstat_totals(%Repo{} = repo, base_args, git) do
    case git.(repo.path, ["diff", "--no-color", "--no-renames", "--numstat"] ++ base_args, [0]) do
      {:ok, output} -> aggregate_numstat(output)
      {:error, _} -> {0, 0, 0}
    end
  end

  defp aggregate_numstat(output) do
    output
    |> String.split("\n", trim: true)
    |> Enum.reduce({0, 0, 0}, fn line, {files, add, del} ->
      case String.split(line, "\t", parts: 3) do
        [a, d, _path] -> {files + 1, add + (parse_stat(a) || 0), del + (parse_stat(d) || 0)}
        _ -> {files, add, del}
      end
    end)
  end

  ## -- list_files --------------------------------------------------------

  @doc """
  The merged, filterable, pageable file list for a workspace: name-status +
  numstat + untracked files, combined in memory. Runs a constant number of
  git commands per repo (2 for `:branch`, 3 for `:uncommitted`) no matter how
  many files changed.

  `opts` must include `:type`. Also accepts `:repo` (exact repo name filter),
  `:q` (case-insensitive substring match on path), `:limit` (default #{@default_limit},
  hard-capped at #{@max_limit}), `:cursor` (opaque, from a previous page's
  `next_cursor`), `:default_branches`, and `:runner`.
  """
  @spec list_files(Path.t(), keyword()) :: {:ok, file_page()} | {:error, atom()}
  def list_files(workspace, opts) when is_binary(workspace) and is_list(opts) do
    with {:ok, type} <- fetch_type(opts),
         {:ok, offset} <- decode_cursor(Keyword.get(opts, :cursor)) do
      git = make_git(opts)
      default_branches = Keyword.get(opts, :default_branches, %{})
      limit = clamp(Keyword.get(opts, :limit), @default_limit, @max_limit)
      q = normalize_query(Keyword.get(opts, :q))
      repo_filter = presence(Keyword.get(opts, :repo))

      entries =
        if File.dir?(workspace) do
          workspace
          |> local_repos(git, default_branches)
          |> Enum.filter(&(is_nil(repo_filter) or &1.name == repo_filter))
          |> Enum.flat_map(&repo_file_entries(&1, type, git))
          |> Enum.filter(&matches_query?(&1, q))
          |> Enum.sort_by(&{&1.repo, &1.path})
        else
          []
        end

      total = length(entries)
      page = Enum.slice(entries, offset, limit)

      {:ok, %{files: page, total: total, limit: limit, next_cursor: encode_cursor(offset + limit, total)}}
    end
  end

  def list_files(_workspace, _opts), do: {:error, :invalid_diff_type}

  defp repo_file_entries(%Repo{} = repo, :branch, git) do
    tracked_file_entries(repo, diff_base_args(repo, :branch), git)
  end

  defp repo_file_entries(%Repo{} = repo, :uncommitted, git) do
    tracked = tracked_file_entries(repo, ["HEAD"], git)
    untracked = repo |> untracked_files(git) |> Enum.map(&untracked_entry(repo, &1))
    tracked ++ untracked
  end

  defp tracked_file_entries(%Repo{} = repo, base_args, git) do
    repo
    |> changed_paths_no_renames(base_args, git)
    |> Enum.map(fn {path, info} ->
      %{
        repo: repo.name,
        path: path,
        old_path: nil,
        status: info.status,
        additions: info.additions,
        deletions: info.deletions,
        binary: info.binary
      }
    end)
  end

  defp changed_paths_no_renames(%Repo{} = repo, base_args, git) do
    status_map =
      case git.(repo.path, ["diff", "--no-color", "--no-renames", "--name-status"] ++ base_args, [0]) do
        {:ok, output} -> parse_name_status_no_renames(output)
        {:error, _} -> %{}
      end

    numstat_map =
      case git.(repo.path, ["diff", "--no-color", "--no-renames", "--numstat"] ++ base_args, [0]) do
        {:ok, output} -> parse_numstat_lines(output)
        {:error, _} -> %{}
      end

    Map.new(status_map, fn {path, status} ->
      {additions, deletions, binary} = Map.get(numstat_map, path, {nil, nil, false})
      {path, %{status: status, additions: additions, deletions: deletions, binary: binary}}
    end)
  end

  defp parse_name_status_no_renames(output) do
    output
    |> String.split("\n", trim: true)
    |> Enum.reduce(%{}, fn line, acc ->
      case String.split(line, "\t", parts: 2) do
        [status, path] -> Map.put(acc, path, status_letter(status))
        _ -> acc
      end
    end)
  end

  defp parse_numstat_lines(output) do
    output
    |> String.split("\n", trim: true)
    |> Enum.reduce(%{}, fn line, acc ->
      case String.split(line, "\t", parts: 3) do
        [add, del, path] -> Map.put(acc, path, {parse_stat(add), parse_stat(del), add == "-" and del == "-"})
        _ -> acc
      end
    end)
  end

  defp untracked_entry(%Repo{} = repo, path) do
    %{
      repo: repo.name,
      path: path,
      old_path: nil,
      status: "added",
      additions: nil,
      deletions: nil,
      binary: probably_binary?(Path.join(repo.path, path))
    }
  end

  defp matches_query?(_entry, nil), do: true
  defp matches_query?(entry, q), do: String.contains?(String.downcase(entry.path), q)

  ## -- patch -------------------------------------------------------------

  @doc """
  The unified patch for exactly one file, truncated by byte and line caps.

  `type` is `:uncommitted` or `:branch`. `opts` must include `:repo` and
  `:path` (repo-relative; validated to stay inside the repo). Also accepts
  `:max_bytes` (default #{@default_max_bytes}, hard cap #{@hard_max_bytes}),
  `:max_lines` (default #{@default_max_lines}, hard cap #{@hard_max_lines}),
  `:default_branches`, and `:runner`.
  """
  @spec patch(Path.t(), diff_type(), keyword()) :: {:ok, patch_result()} | {:error, atom()}
  def patch(workspace, type, opts) when is_binary(workspace) and type in @diff_types and is_list(opts) do
    git = make_git(opts)
    default_branches = Keyword.get(opts, :default_branches, %{})

    with {:ok, repo_name} <- required_string(opts, :repo),
         {:ok, rel_path} <- required_string(opts, :path),
         :ok <- validate_relative_path(rel_path),
         {:ok, repo} <- find_repo(workspace, repo_name, git, default_branches),
         :ok <- validate_path_in_repo(repo, rel_path) do
      build_patch(repo, type, rel_path, git, opts)
    end
  end

  def patch(_workspace, _type, _opts), do: {:error, :invalid_diff_type}

  defp find_repo(workspace, name, git, default_branches) do
    workspace
    |> local_repos(git, default_branches)
    |> Enum.find(&(&1.name == name))
    |> case do
      nil -> {:error, :repo_not_found}
      repo -> {:ok, repo}
    end
  end

  defp build_patch(%Repo{} = repo, type, rel_path, git, opts) do
    max_bytes = clamp(Keyword.get(opts, :max_bytes), @default_max_bytes, @hard_max_bytes)
    max_lines = clamp(Keyword.get(opts, :max_lines), @default_max_lines, @hard_max_lines)

    case fetch_raw_patch(repo, type, rel_path, git) do
      {:ok, nil} ->
        {:error, :file_not_found}

      {:ok, {status, raw_patch}} ->
        {truncated_patch, truncated?} = truncate_patch(raw_patch, max_bytes, max_lines)

        {:ok,
         %{
           repo: repo.name,
           path: rel_path,
           status: status,
           binary: binary_patch?(raw_patch),
           truncated: truncated?,
           patch: truncated_patch
         }}
    end
  end

  defp fetch_raw_patch(%Repo{} = repo, :uncommitted, rel_path, git) do
    if rel_path in untracked_files(repo, git) do
      case git.(repo.path, ["diff", "--no-color", "--no-index", "--", "/dev/null", rel_path], [0, 1]) do
        {:ok, content} -> {:ok, {"added", normalize_untracked_patch(content, rel_path)}}
        {:error, _} -> {:ok, nil}
      end
    else
      tracked_patch(repo, ["HEAD"], rel_path, git)
    end
  end

  defp fetch_raw_patch(%Repo{} = repo, :branch, rel_path, git) do
    tracked_patch(repo, diff_base_args(repo, :branch), rel_path, git)
  end

  defp tracked_patch(%Repo{} = repo, base_args, rel_path, git) do
    case tracked_status(repo, base_args, rel_path, git) do
      nil ->
        {:ok, nil}

      status ->
        case git.(repo.path, ["diff", "--no-color"] ++ base_args ++ ["--", rel_path], [0]) do
          {:ok, content} -> {:ok, {status, content}}
          {:error, _} -> {:ok, nil}
        end
    end
  end

  defp tracked_status(%Repo{} = repo, base_args, rel_path, git) do
    repo
    |> name_status_entries(base_args, git)
    |> Enum.find(&(&1.path == rel_path))
    |> case do
      %{status: status} -> status
      nil -> nil
    end
  end

  defp required_string(opts, key) do
    case Keyword.get(opts, key) do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, missing_error(key)}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, missing_error(key)}
    end
  end

  defp missing_error(:repo), do: :repo_required
  defp missing_error(:path), do: :path_required

  defp validate_relative_path(path) do
    cond do
      path == "" -> {:error, :invalid_file_path}
      String.starts_with?(path, "/") -> {:error, :invalid_file_path}
      Enum.any?(Path.split(path), &(&1 == "..")) -> {:error, :invalid_file_path}
      true -> :ok
    end
  end

  defp validate_path_in_repo(%Repo{path: repo_path}, rel_path) do
    root = Path.expand(repo_path)
    full = Path.expand(Path.join(repo_path, rel_path))

    if full == root or String.starts_with?(full, root <> "/") do
      :ok
    else
      {:error, :invalid_file_path}
    end
  end

  defp binary_patch?(raw_patch), do: String.contains?(raw_patch, "Binary files ")

  defp truncate_patch(raw, max_bytes, max_lines) do
    lines = String.split(raw, "\n")

    {kept_lines, lines_truncated?} =
      if length(lines) > max_lines do
        {Enum.take(lines, max_lines), true}
      else
        {lines, false}
      end

    joined = Enum.join(kept_lines, "\n")

    if byte_size(joined) > max_bytes do
      {truncate_bytes(joined, max_bytes), true}
    else
      {joined, lines_truncated?}
    end
  end

  defp truncate_bytes(binary, max_bytes) when byte_size(binary) <= max_bytes, do: binary

  defp truncate_bytes(binary, max_bytes) do
    binary
    |> :binary.part(0, max_bytes)
    |> strip_incomplete_utf8()
  end

  defp strip_incomplete_utf8(bin) do
    if String.valid?(bin) or byte_size(bin) == 0 do
      bin
    else
      strip_incomplete_utf8(:binary.part(bin, 0, byte_size(bin) - 1))
    end
  end

  ## -- legacy full-diff route ---------------------------------------------

  @doc """
  Full per-file patches for every changed file in the workspace. Kept for
  existing tracker UI consumers. Hard-capped at #{@legacy_max_files} files
  total (across all repos) so it can never materialize thousands of patches
  in one response; any repo whose file list was cut off is reported with
  `truncated: true`. Prefer `stats/2` + `list_files/2` + `patch/3` for new UI.
  """
  @spec changes(Path.t(), diff_type()) :: {:ok, [repo_diff()]} | {:error, :invalid_diff_type}
  def changes(workspace, type) when is_binary(workspace) and type in @diff_types do
    changes(workspace, type, [])
  end

  def changes(_workspace, _type), do: {:error, :invalid_diff_type}

  @spec changes(Path.t(), diff_type(), keyword()) :: {:ok, [repo_diff()]} | {:error, :invalid_diff_type}
  def changes(workspace, type, opts) when is_binary(workspace) and type in @diff_types and is_list(opts) do
    git = make_git(opts)
    default_branches = Keyword.get(opts, :default_branches, %{})

    if File.dir?(workspace) do
      {repos, _budget} =
        workspace
        |> local_repos(git, default_branches)
        |> Enum.map_reduce(@legacy_max_files, &legacy_repo_diff(&1, type, git, &2))

      {:ok, Enum.reject(repos, &(&1.files == [] and not &1.truncated))}
    else
      {:ok, []}
    end
  end

  def changes(_workspace, _type, _opts), do: {:error, :invalid_diff_type}

  defp legacy_repo_diff(%Repo{} = repo, type, git, budget) do
    entries = legacy_entries(repo, type, git)
    total = length(entries)
    take = min(total, budget)
    selected = Enum.take(entries, take)

    repo_map = %{
      repo: repo.name,
      branch: repo.branch,
      base: repo.default_branch,
      ahead: ahead_count(repo, git),
      behind: behind_count(repo, git),
      files: Enum.map(selected, &legacy_file_change(repo, &1, type, git)),
      truncated: total > take
    }

    {repo_map, budget - take}
  end

  defp legacy_entries(%Repo{} = repo, :branch, git) do
    repo
    |> name_status_entries(diff_base_args(repo, :branch), git)
    |> Enum.map(&Map.put(&1, :kind, :tracked))
  end

  defp legacy_entries(%Repo{} = repo, :uncommitted, git) do
    tracked =
      repo
      |> name_status_entries(["HEAD"], git)
      |> Enum.map(&Map.put(&1, :kind, :tracked))

    untracked =
      repo
      |> untracked_files(git)
      |> Enum.map(&%{path: &1, status: "added", old_path: nil, kind: :untracked})

    tracked ++ untracked
  end

  defp legacy_file_change(%Repo{} = repo, %{kind: :tracked} = entry, type, git) do
    args = ["diff", "--no-color"] ++ diff_base_args(repo, type) ++ ["--", entry.path]

    patch =
      case git.(repo.path, args, [0]) do
        {:ok, content} -> content
        {:error, _} -> ""
      end

    %{path: entry.path, old_path: entry.old_path, status: entry.status, patch: patch}
  end

  defp legacy_file_change(%Repo{} = repo, %{kind: :untracked} = entry, _type, git) do
    patch =
      case git.(repo.path, ["diff", "--no-color", "--no-index", "--", "/dev/null", entry.path], [0, 1]) do
        {:ok, content} -> normalize_untracked_patch(content, entry.path)
        {:error, _} -> ""
      end

    %{path: entry.path, old_path: nil, status: "added", patch: patch}
  end

  defp normalize_untracked_patch(patch, path) do
    patch
    |> String.replace("a/dev/null", "/dev/null")
    |> String.replace("b/#{path}", "b/#{path}")
  end

  defp ahead_count(%Repo{path: path, default_branch: default}, git)
       when is_binary(default) and default != "" do
    case git.(path, ["rev-list", "--count", "origin/#{default}..HEAD"], [0]) do
      {:ok, output} ->
        case Integer.parse(String.trim(output)) do
          {n, _} -> n
          :error -> 0
        end

      {:error, _} ->
        0
    end
  end

  defp ahead_count(_repo, _git), do: 0

  defp behind_count(%Repo{path: path, default_branch: default}, git)
       when is_binary(default) and default != "" do
    case git.(path, ["rev-list", "--count", "HEAD..origin/#{default}"], [0]) do
      {:ok, output} ->
        case Integer.parse(String.trim(output)) do
          {n, _} -> n
          :error -> nil
        end

      {:error, _} ->
        nil
    end
  end

  defp behind_count(_repo, _git), do: nil

  ## -- shared repo discovery (local-only, no ls-remote) --------------------

  defp local_repos(workspace, git, default_branches) do
    workspace
    |> repo_dirs(git)
    |> Enum.map(&build_repo(&1, git, default_branches))
  end

  defp repo_dirs(workspace, git) do
    cond do
      git_worktree_root?(workspace, git) ->
        [workspace]

      File.dir?(workspace) ->
        workspace
        |> File.ls!()
        |> Enum.sort()
        |> Enum.map(&Path.join(workspace, &1))
        |> Enum.filter(&File.dir?/1)
        |> Enum.filter(&git_worktree_root?(&1, git))

      true ->
        []
    end
  end

  defp git_worktree_root?(dir, git) do
    case git.(dir, ["rev-parse", "--show-toplevel"], [0]) do
      {:ok, toplevel} -> toplevel != "" and Path.expand(toplevel) == Path.expand(dir)
      {:error, _reason} -> false
    end
  end

  defp build_repo(path, git, default_branches) do
    name = Path.basename(path)

    %Repo{
      path: path,
      name: name,
      branch: presence(git_value(path, ["branch", "--show-current"], git)),
      default_branch: local_default_branch(path, git) || Map.get(default_branches, name)
    }
  end

  # Local-only: reads the `origin/HEAD` symref already present on disk from
  # clone/push time. Never touches the network.
  defp local_default_branch(path, git) do
    case git.(path, ["rev-parse", "--abbrev-ref", "origin/HEAD"], [0]) do
      {:ok, "origin/" <> name} -> name
      _other -> nil
    end
  end

  defp git_value(path, args, git) do
    case git.(path, args, [0]) do
      {:ok, value} -> value
      {:error, _reason} -> ""
    end
  end

  defp untracked_files(%Repo{} = repo, git) do
    case git.(repo.path, ["ls-files", "--others", "--exclude-standard"], [0]) do
      {:ok, output} -> String.split(output, "\n", trim: true)
      {:error, _} -> []
    end
  end

  defp name_status_entries(%Repo{} = repo, base_args, git) do
    case git.(repo.path, ["diff", "--no-color", "--name-status"] ++ base_args, [0]) do
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
      [<<"R", _::binary>>, old_path, new_path] -> %{path: new_path, status: "renamed", old_path: old_path}
      [<<"C", _::binary>>, old_path, new_path] -> %{path: new_path, status: "copied", old_path: old_path}
      [status, path] -> %{path: path, status: status_letter(status), old_path: nil}
      _ -> nil
    end
  end

  defp status_letter("A"), do: "added"
  defp status_letter("D"), do: "deleted"
  defp status_letter("M"), do: "modified"
  defp status_letter("T"), do: "type_changed"
  defp status_letter(other), do: other

  defp diff_base_args(%Repo{default_branch: default}, :branch) when is_binary(default) and default != "",
    do: ["origin/#{default}...HEAD"]

  defp diff_base_args(_repo, :branch), do: ["HEAD"]
  defp diff_base_args(_repo, :uncommitted), do: ["HEAD"]

  ## -- shared param/opt helpers --------------------------------------------

  defp fetch_type(opts) do
    case Keyword.get(opts, :type) do
      type when type in @diff_types -> {:ok, type}
      _ -> {:error, :invalid_diff_type}
    end
  end

  defp clamp(nil, default, _hard_max), do: default

  defp clamp(value, _default, hard_max) when is_integer(value) and value > 0, do: min(value, hard_max)

  defp clamp(value, default, hard_max) when is_binary(value) do
    case Integer.parse(value) do
      {n, ""} when n > 0 -> min(n, hard_max)
      _ -> default
    end
  end

  defp clamp(_value, default, _hard_max), do: default

  defp normalize_query(nil), do: nil
  defp normalize_query(""), do: nil
  defp normalize_query(q) when is_binary(q), do: String.downcase(q)
  defp normalize_query(_), do: nil

  defp presence(nil), do: nil
  defp presence(""), do: nil
  defp presence(value), do: value

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

  defp parse_stat("-"), do: nil

  defp parse_stat(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, _} -> n
      :error -> nil
    end
  end

  defp probably_binary?(full_path) do
    case File.open(full_path, [:read, :binary]) do
      {:ok, io} ->
        chunk = IO.binread(io, 8000)
        File.close(io)

        case chunk do
          data when is_binary(data) -> :binary.match(data, <<0>>) != :nomatch
          _ -> false
        end

      {:error, _} ->
        false
    end
  end

  # Wraps the injectable `:runner` (default `&System.cmd/3`) into a
  # `(path, args, allowed_exit_codes -> {:ok, output} | {:error, {status, output}})`
  # closure threaded through every git-invoking helper above.
  defp make_git(opts) do
    runner = Keyword.get(opts, :runner, &System.cmd/3)

    fn path, args, allowed_exits ->
      {output, status} = runner.("git", args, cd: path, stderr_to_stdout: true)

      if status in allowed_exits do
        {:ok, String.trim_trailing(output)}
      else
        {:error, {status, String.trim_trailing(output)}}
      end
    end
  end
end
