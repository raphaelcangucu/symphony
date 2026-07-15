defmodule SymphonyElixir.Workspace.Inventory do
  @moduledoc """
  Scans a project's workspace root and reports every working tree Symphony
  manages for it: per-issue workspaces (including isolated parallel trees),
  the shared project workspace repos, standalone workspaces, and child-run
  git worktrees nested under workspace repos.

  Classification per workspace:

    * `:active` — the owning issue/thread is alive.
    * `:orphan` — no owning issue (deleted), issue archived or in a terminal
      state, or a parallel/standalone tree whose sessions were all archived.

  A workspace is `reclaimable` when it is an orphan and no repo inside it has
  unpublished work (`RunContract.work_present?/1`), so bulk cleanup never
  pre-selects trees that would lose commits or dirty files.
  """

  require Logger

  alias SymphonyElixir.AgentExecution
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Observability.Metrics
  alias SymphonyElixir.RunContract
  alias SymphonyElixir.Workspace
  alias SymphonyElixir.Workspace.Provision
  alias SymphonyElixir.Workspace.Worktree

  @parallel_suffix_regex ~r/^(?<base>.+)__p(?<index>\d+)$/
  @standalone_prefix "__ws_"
  @worktrees_dir ".worktrees"
  @blocking_execution_statuses [:live, :retrying]
  # Finite per-probe deadline so a stuck `du`/`git`/filesystem call is killed
  # instead of blocking the caller forever (the previous `:infinity` could hang a
  # scan indefinitely). Overridable per call via the `:scan_timeout` option.
  @scan_timeout 30_000

  @type repo_entry :: %{
          name: String.t(),
          path: Path.t(),
          branch: String.t() | nil,
          default_branch: String.t() | nil,
          dirty: boolean(),
          upstream: boolean(),
          ahead_count: non_neg_integer(),
          size_bytes: non_neg_integer()
        }

  @type child_worktree_entry :: %{
          path: Path.t(),
          repo_name: String.t(),
          slug: String.t(),
          branch: String.t() | nil,
          dirty: boolean(),
          size_bytes: non_neg_integer()
        }

  @type workspace_entry :: %{
          path: Path.t(),
          kind: :issue | :issue_parallel | :project | :standalone | :unknown,
          issue_identifier: String.t() | nil,
          name: String.t() | nil,
          classification: :active | :orphan,
          reclaimable: boolean(),
          work_present: boolean(),
          execution_status: atom() | nil,
          removable: boolean(),
          size_bytes: non_neg_integer(),
          repos: [repo_entry()],
          child_worktrees: [child_worktree_entry()]
        }

  @type scan_result :: %{
          workspaces: [workspace_entry()],
          totals: %{
            count: non_neg_integer(),
            size_bytes: non_neg_integer(),
            reclaimable_bytes: non_neg_integer()
          }
        }

  @type removal_result :: %{path: Path.t(), status: :removed | :skipped, reason: String.t() | nil}

  @doc """
  Scans all working trees for `project_slug`.

  Options (mainly for tests):

    * `:executions` — replaces `AgentExecution.list/0` as the source of live
      execution statuses.
    * `:size_fun` — replaces the `du`-based directory size probe.
    * `:max_concurrency` — caps parallel workspace/repo probes (default:
      `max(System.schedulers_online(), 4)`).
    * `:scan_timeout` — per-probe deadline in ms (default: `#{@scan_timeout}`). A
      probe that exceeds it is killed and its workspace is omitted, so one stuck
      tree never blocks the whole scan.
    * `:overall_timeout` — deadline in ms for gathering the concurrent results
      (default: `scan_timeout * 2`). Exceeding it returns `{:error, :timeout}`
      instead of blocking indefinitely.
  """
  @spec scan(String.t(), keyword()) :: {:ok, scan_result()} | {:error, term()}
  def scan(project_slug, opts \\ []) when is_binary(project_slug) and is_list(opts) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      layout = Workspace.project_layout(project_slug)
      segment_root = segment_root(layout)
      issues_by_safe_id = issue_lookup(project_slug)
      executions_by_issue = executions_by_issue(opts)
      size_fun = Keyword.get(opts, :size_fun, &directory_size_bytes/1)
      concurrency = scan_concurrency(opts)
      scan_timeout = scan_timeout(opts)
      overall = overall_timeout(opts, scan_timeout)

      build_entry_fn = fn path ->
        build_entry(path, issues_by_safe_id, executions_by_issue, size_fun, concurrency)
      end

      candidate_task =
        Task.async(fn ->
          segment_root
          |> candidate_dirs()
          |> async_map(build_entry_fn, concurrency, scan_timeout)
          |> Enum.reject(&is_nil/1)
        end)

      project_task = Task.async(fn -> project_workspace_entry(segment_root, size_fun, concurrency) end)

      start = Metrics.monotonic_start()
      result = gather_scan_result([candidate_task, project_task], overall)
      emit_scan_telemetry(project_slug, result, start)
      result
    end
  end

  defp emit_scan_telemetry(project_slug, {:ok, %{workspaces: workspaces}}, start) do
    Metrics.emit(
      [:inventory, :scan],
      %{duration_ms: Metrics.duration_ms(start), workspace_count: length(workspaces)},
      %{project_slug: project_slug, result: :ok}
    )
  end

  defp emit_scan_telemetry(project_slug, {:error, _reason}, start) do
    Metrics.emit(
      [:inventory, :scan],
      %{duration_ms: Metrics.duration_ms(start), workspace_count: 0},
      %{project_slug: project_slug, result: :timeout}
    )
  end

  defp gather_scan_result([candidate_task, project_task] = tasks, overall) do
    with {:ok, workspaces} <- await_scan_result(candidate_task, overall),
         {:ok, project_entry} <- await_scan_result(project_task, overall) do
      workspaces =
        case project_entry do
          nil -> workspaces
          entry -> [entry | workspaces]
        end

      {:ok, %{workspaces: workspaces, totals: totals(workspaces)}}
    else
      :timeout ->
        shutdown_scan_tasks(tasks)
        {:error, :timeout}
    end
  end

  defp await_scan_result(task, overall) do
    case Task.yield(task, overall) || Task.shutdown(task, :brutal_kill) do
      {:ok, value} -> {:ok, value}
      _ -> :timeout
    end
  end

  defp shutdown_scan_tasks(tasks) do
    Enum.each(tasks, fn task -> Task.shutdown(task, :brutal_kill) end)
  end

  @doc """
  Scans working trees and pushes each entry to `emit` as it becomes available.

  `emit` receives `{:entry, workspace_entry()}` or `{:totals, totals_map()}` and
  must return `:ok` to continue or `:halt` when the client disconnected.
  """
  @spec scan_stream(String.t(), (term() -> :ok | :halt), keyword()) ::
          {:ok, scan_result()} | {:error, term()}
  def scan_stream(project_slug, emit, opts \\ [])
      when is_binary(project_slug) and is_function(emit, 1) and is_list(opts) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      layout = Workspace.project_layout(project_slug)
      segment_root = segment_root(layout)
      issues_by_safe_id = issue_lookup(project_slug)
      executions_by_issue = executions_by_issue(opts)
      size_fun = Keyword.get(opts, :size_fun, &directory_size_bytes/1)
      concurrency = scan_concurrency(opts)
      scan_timeout = scan_timeout(opts)
      overall = overall_timeout(opts, scan_timeout)

      build_entry_fn = fn path ->
        build_entry(path, issues_by_safe_id, executions_by_issue, size_fun, concurrency)
      end

      project_task = Task.async(fn -> project_workspace_entry(segment_root, size_fun, concurrency) end)

      workspaces =
        segment_root
        |> candidate_dirs()
        |> stream_map(build_entry_fn, concurrency, emit, scan_timeout)

      workspaces =
        case await_scan_result(project_task, overall) do
          {:ok, nil} ->
            workspaces

          {:ok, entry} ->
            case emit.({:entry, entry}) do
              :halt -> workspaces
              :ok -> [entry | workspaces]
            end

          :timeout ->
            workspaces
        end

      totals = totals(workspaces)

      case emit.({:totals, totals}) do
        :halt -> {:ok, %{workspaces: workspaces, totals: totals}}
        :ok -> {:ok, %{workspaces: workspaces, totals: totals}}
      end
    end
  end

  @doc """
  Removes workspaces and child worktrees in batch.

  Every path must resolve inside the project's workspace layout root. Issue
  workspaces with a live or retrying execution are skipped. Child worktree
  paths (under `#{@worktrees_dir}/`) are detached via `git worktree remove`;
  everything else goes through `Workspace.remove/1` (which runs the
  `before_remove` hook).
  """
  @spec remove(String.t(), [String.t()], keyword()) :: {:ok, [removal_result()]} | {:error, term()}
  def remove(project_slug, paths, opts \\ [])
      when is_binary(project_slug) and is_list(paths) and is_list(opts) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      layout = Workspace.project_layout(project_slug)
      segment_root = segment_root(layout)
      executions_by_issue = executions_by_issue(opts)

      results = Enum.map(paths, &remove_one(&1, segment_root, executions_by_issue))
      {:ok, results}
    end
  end

  # ─── Scan internals ─────────────────────────────────────────────────

  defp segment_root(%{root: root, segment: segment}) when is_binary(segment) and segment != "" do
    Path.expand(Path.join(root, segment))
  end

  defp segment_root(%{root: root}), do: Path.expand(root)

  defp candidate_dirs(segment_root) do
    case File.ls(segment_root) do
      {:ok, entries} ->
        entries
        |> Enum.sort()
        |> Enum.map(&Path.join(segment_root, &1))
        |> Enum.filter(&File.dir?/1)

      {:error, _reason} ->
        []
    end
  end

  defp issue_lookup(project_slug) do
    project_slug
    |> Context.list_issues(include_archived: true)
    |> Map.new(fn issue ->
      {safe_identifier(issue.identifier), issue_brief(issue)}
    end)
  end

  defp issue_brief(issue) do
    %{
      identifier: issue.identifier,
      archived: issue.archived_at != nil,
      terminal: issue_terminal?(issue)
    }
  end

  defp issue_terminal?(%{status: %{is_terminal: terminal}}) when is_boolean(terminal), do: terminal
  defp issue_terminal?(_issue), do: false

  defp executions_by_issue(opts) do
    opts
    |> Keyword.get_lazy(:executions, &safe_execution_list/0)
    |> Map.new(fn execution -> {execution.issue_identifier, execution.status} end)
  end

  defp safe_execution_list do
    AgentExecution.list()
  rescue
    _error -> []
  catch
    :exit, _reason -> []
  end

  defp build_entry(path, issues_by_safe_id, executions_by_issue, size_fun, concurrency) do
    basename = Path.basename(path)

    cond do
      basename == Provision.reserved_container_name() ->
        nil

      git_repo_root?(path) ->
        # Direct repo clone at the segment root belongs to the shared project
        # workspace; it is folded into the :project entry afterwards.
        nil

      String.starts_with?(basename, @standalone_prefix) ->
        standalone_entry(path, basename, size_fun, concurrency)

      match = Regex.named_captures(@parallel_suffix_regex, basename) ->
        parallel_entry(path, match, issues_by_safe_id, executions_by_issue, size_fun, concurrency)

      issue = Map.get(issues_by_safe_id, basename) ->
        issue_entry(path, issue, executions_by_issue, size_fun, concurrency)

      workspace_like?(path) ->
        unknown_entry(path, size_fun, concurrency)

      true ->
        nil
    end
  end

  defp issue_entry(path, issue, executions_by_issue, size_fun, concurrency) do
    repo_states = raw_repo_states(path)
    execution_status = Map.get(executions_by_issue, issue.identifier)
    orphan? = issue.archived or issue.terminal
    work_present = RunContract.work_present?(repo_states)
    blocked? = execution_status in @blocking_execution_statuses

    %{
      path: path,
      kind: :issue,
      issue_identifier: issue.identifier,
      name: nil,
      classification: if(orphan?, do: :orphan, else: :active),
      reclaimable: orphan? and not work_present and not blocked?,
      work_present: work_present,
      execution_status: execution_status,
      removable: not blocked?,
      size_bytes: size_fun.(path),
      repos: repo_entries(repo_states, size_fun, concurrency),
      child_worktrees: child_worktree_entries(repo_states, size_fun, concurrency)
    }
  end

  defp parallel_entry(path, %{"base" => base}, issues_by_safe_id, executions_by_issue, size_fun, concurrency) do
    issue = Map.get(issues_by_safe_id, base)
    identifier = if(issue, do: issue.identifier, else: nil)
    execution_status = if(identifier, do: Map.get(executions_by_issue, identifier), else: nil)
    active_threads = History.count_active_threads_for_workspace(path)
    orphan? = is_nil(issue) or issue.archived or issue.terminal or active_threads == 0
    repo_states = raw_repo_states(path)
    work_present = RunContract.work_present?(repo_states)

    %{
      path: path,
      kind: :issue_parallel,
      issue_identifier: identifier,
      name: nil,
      classification: if(orphan?, do: :orphan, else: :active),
      reclaimable: orphan? and not work_present,
      work_present: work_present,
      execution_status: execution_status,
      removable: true,
      size_bytes: size_fun.(path),
      repos: repo_entries(repo_states, size_fun, concurrency),
      child_worktrees: []
    }
  end

  defp standalone_entry(path, basename, size_fun, concurrency) do
    active_threads = History.count_active_threads_for_workspace(path)
    orphan? = active_threads == 0
    repo_states = raw_repo_states(path)
    work_present = RunContract.work_present?(repo_states)

    %{
      path: path,
      kind: :standalone,
      issue_identifier: nil,
      name: String.replace_prefix(basename, @standalone_prefix, ""),
      classification: if(orphan?, do: :orphan, else: :active),
      reclaimable: orphan? and not work_present,
      work_present: work_present,
      execution_status: nil,
      removable: true,
      size_bytes: size_fun.(path),
      repos: repo_entries(repo_states, size_fun, concurrency),
      child_worktrees: []
    }
  end

  defp unknown_entry(path, size_fun, concurrency) do
    repo_states = raw_repo_states(path)
    work_present = RunContract.work_present?(repo_states)

    %{
      path: path,
      kind: :unknown,
      issue_identifier: nil,
      name: Path.basename(path),
      classification: :orphan,
      reclaimable: not work_present,
      work_present: work_present,
      execution_status: nil,
      removable: true,
      size_bytes: size_fun.(path),
      repos: repo_entries(repo_states, size_fun, concurrency),
      child_worktrees: child_worktree_entries(repo_states, size_fun, concurrency)
    }
  end

  defp project_workspace_entry(segment_root, size_fun, concurrency) do
    repo_states = raw_repo_states(segment_root)

    case repo_entries(repo_states, size_fun, concurrency) do
      [] ->
        nil

      repos ->
        %{
          path: segment_root,
          kind: :project,
          issue_identifier: nil,
          name: nil,
          classification: :active,
          reclaimable: false,
          work_present: RunContract.work_present?(repo_states),
          execution_status: nil,
          removable: false,
          size_bytes: Enum.sum_by(repos, & &1.size_bytes),
          repos: repos,
          child_worktrees: child_worktree_entries(repo_states, size_fun, concurrency)
        }
    end
  end

  defp repo_entries(repo_states, size_fun, concurrency) do
    repo_states
    |> async_map(
      fn repo ->
        %{
          name: repo.name,
          path: repo.path,
          branch: repo.branch,
          default_branch: repo.default_branch,
          dirty: repo.dirty?,
          upstream: repo.upstream?,
          ahead_count: repo.ahead_count,
          size_bytes: size_fun.(repo.path)
        }
      end,
      concurrency
    )
    |> Enum.reject(&is_nil/1)
  end

  defp raw_repo_states(workspace) do
    RunContract.repo_states(workspace)
  rescue
    error ->
      Logger.warning("Workspace inventory repo scan failed workspace=#{workspace} error=#{Exception.message(error)}")
      []
  end

  defp child_worktree_entries(repo_states, size_fun, concurrency) do
    child_targets =
      Enum.flat_map(repo_states, fn repo ->
        worktrees_root = Path.join(repo.path, @worktrees_dir)

        case File.ls(worktrees_root) do
          {:ok, slugs} ->
            slugs
            |> Enum.sort()
            |> Enum.map(&Path.join(worktrees_root, &1))
            |> Enum.filter(&File.dir?/1)
            |> Enum.map(fn child_path -> {child_path, repo.name} end)

          {:error, _reason} ->
            []
        end
      end)

    child_targets
    |> async_map(fn {path, repo_name} -> child_worktree_entry(path, repo_name, size_fun) end, concurrency)
    |> Enum.reject(&is_nil/1)
  end

  defp child_worktree_entry(path, repo_name, size_fun) do
    %{
      path: path,
      repo_name: repo_name,
      slug: Path.basename(path),
      branch: git_current_branch(path),
      dirty: git_dirty?(path),
      size_bytes: size_fun.(path)
    }
  end

  defp workspace_like?(path) do
    case File.ls(path) do
      {:ok, entries} ->
        Enum.any?(entries, fn entry ->
          child = Path.join(path, entry)
          File.dir?(child) and git_repo_root?(child)
        end)

      {:error, _reason} ->
        false
    end
  end

  defp git_repo_root?(dir) do
    case git(dir, ["rev-parse", "--show-toplevel"]) do
      {:ok, toplevel} -> toplevel != "" and Path.expand(toplevel) == Path.expand(dir)
      {:error, _reason} -> false
    end
  end

  defp git_current_branch(path) do
    case git(path, ["branch", "--show-current"]) do
      {:ok, ""} -> nil
      {:ok, branch} -> branch
      {:error, _reason} -> nil
    end
  end

  defp git_dirty?(path) do
    case git(path, ["status", "--porcelain"]) do
      {:ok, output} -> output != ""
      {:error, _reason} -> false
    end
  end

  defp git(path, args) do
    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {output, 0} -> {:ok, String.trim(output)}
      {output, status} -> {:error, {status, String.trim(output)}}
    end
  rescue
    error -> {:error, {:git_unavailable, Exception.message(error)}}
  end

  defp directory_size_bytes(path) do
    case System.cmd("du", ["-sk", path], stderr_to_stdout: true) do
      {output, 0} ->
        output
        |> String.split()
        |> List.first()
        |> parse_kilobytes()

      {_output, _status} ->
        0
    end
  rescue
    _error -> 0
  end

  defp parse_kilobytes(value) when is_binary(value) do
    case Integer.parse(value) do
      {kilobytes, _rest} when kilobytes >= 0 -> kilobytes * 1024
      _ -> 0
    end
  end

  defp parse_kilobytes(_value), do: 0

  defp totals(workspaces) do
    %{
      count: length(workspaces),
      size_bytes: Enum.sum_by(workspaces, & &1.size_bytes),
      reclaimable_bytes:
        workspaces
        |> Enum.filter(& &1.reclaimable)
        |> Enum.sum_by(& &1.size_bytes)
    }
  end

  # ─── Removal internals ──────────────────────────────────────────────

  defp remove_one(raw_path, segment_root, executions_by_issue) when is_binary(raw_path) do
    path = Path.expand(raw_path)

    cond do
      not inside_root?(path, segment_root) ->
        %{path: path, status: :skipped, reason: "path outside project workspace root"}

      path == segment_root ->
        %{path: path, status: :skipped, reason: "refusing to remove the project workspace root"}

      execution_blocked?(path, executions_by_issue) ->
        %{path: path, status: :skipped, reason: "issue has a live execution"}

      child_worktree_path?(path) ->
        remove_child_worktree(path)

      true ->
        remove_workspace(path, segment_root)
    end
  end

  defp remove_one(other, _segment_root, _executions), do: %{path: inspect(other), status: :skipped, reason: "invalid path"}

  defp inside_root?(path, root) do
    String.starts_with?(path <> "/", root <> "/")
  end

  defp execution_blocked?(path, executions_by_issue) do
    basename = Path.basename(path)

    base =
      case Regex.named_captures(@parallel_suffix_regex, basename) do
        %{"base" => captured} -> captured
        nil -> basename
      end

    executions_by_issue
    |> Enum.any?(fn {identifier, status} ->
      safe_identifier(identifier) == base and status in @blocking_execution_statuses
    end)
  end

  defp child_worktree_path?(path) do
    path
    |> Path.split()
    |> Enum.member?(@worktrees_dir)
  end

  defp remove_child_worktree(path) do
    repo_path =
      path
      |> Path.split()
      |> Enum.take_while(&(&1 != @worktrees_dir))
      |> Path.join()

    Worktree.remove(repo_path, path)
    _ = File.rm_rf(path)
    %{path: path, status: :removed, reason: nil}
  end

  defp remove_workspace(path, allowed_root) do
    case Workspace.remove(path, allowed_root) do
      {:ok, _files} ->
        %{path: path, status: :removed, reason: nil}

      {:error, reason, _output} ->
        %{path: path, status: :skipped, reason: format_reason(reason)}
    end
  end

  defp format_reason({:remove_failed, posix, failed_path})
       when posix in [:eacces, :eperm, :eexist] and is_binary(failed_path) do
    "permission denied deleting #{failed_path} (often Docker-owned files; stop containers or chown, then retry)"
  end

  defp format_reason({:remove_failed, reason, failed_path}) when is_binary(failed_path) do
    "failed deleting #{failed_path}: #{inspect(reason)}"
  end

  defp format_reason(reason) when is_binary(reason), do: reason
  defp format_reason(reason), do: inspect(reason)

  defp safe_identifier(identifier) do
    String.replace(identifier || "issue", ~r/[^a-zA-Z0-9._-]/, "_")
  end

  defp scan_concurrency(opts) do
    Keyword.get(opts, :max_concurrency, default_scan_concurrency())
  end

  defp default_scan_concurrency do
    max(System.schedulers_online(), 4)
  end

  defp scan_timeout(opts) do
    Keyword.get(opts, :scan_timeout, @scan_timeout)
  end

  defp overall_timeout(opts, scan_timeout) do
    Keyword.get(opts, :overall_timeout, overall_default(scan_timeout))
  end

  defp overall_default(:infinity), do: :infinity
  defp overall_default(scan_timeout) when is_integer(scan_timeout), do: scan_timeout * 2

  defp async_map(items, fun, concurrency), do: async_map(items, fun, concurrency, @scan_timeout)

  defp async_map(items, fun, concurrency, timeout) when is_function(fun, 1) do
    items
    |> Task.async_stream(fun,
      max_concurrency: concurrency,
      ordered: true,
      timeout: timeout,
      on_timeout: :kill_task
    )
    |> Enum.map(&async_map_value/1)
  end

  # A killed/timed-out probe becomes `nil`; callers already reject nils, so a
  # single stuck tree drops out instead of crashing the whole scan.
  defp async_map_value({:ok, result}), do: result
  defp async_map_value({:exit, _reason}), do: nil

  defp stream_map(items, fun, concurrency, emit, timeout)
       when is_function(fun, 1) and is_function(emit, 1) do
    items
    |> Task.async_stream(fun,
      max_concurrency: concurrency,
      ordered: false,
      timeout: timeout,
      on_timeout: :kill_task
    )
    |> Enum.reduce_while([], fn
      {:ok, nil}, acc ->
        {:cont, acc}

      {:ok, entry}, acc ->
        case emit.({:entry, entry}) do
          :halt -> {:halt, acc}
          :ok -> {:cont, [entry | acc]}
        end

      _, acc ->
        {:cont, acc}
    end)
  end
end
