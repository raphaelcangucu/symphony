defmodule SymphonyElixir.Workspace do
  @moduledoc """
  Creates isolated per-issue workspaces for parallel Codex agents.
  """

  require Logger
  alias SymphonyElixir.{Config, ProjectConfig, Repo, WorkspaceSkills}
  alias SymphonyElixir.GitHub.Config, as: GitHubConfig
  alias SymphonyElixir.LocalTracker.Context

  @excluded_entries MapSet.new([".elixir_ls", "tmp"])

  @spec create_for_issue(map() | String.t() | nil) :: {:ok, Path.t()} | {:error, term()}
  def create_for_issue(issue_or_identifier) do
    ctx = issue_context(issue_or_identifier)
    workspace = workspace_path_for_layout(safe_identifier(ctx.issue_identifier), layout_for(ctx))

    ensure_at(workspace, issue_or_identifier)
  end

  @doc """
  Ensures the working tree exists at an explicit `workspace` path (validated against the
  configured workspace root) and runs the after_create hook the first time it is created.

  Used by the authoring assistant to honor the path persisted on the issue thread, so reads
  and writes target the same tree regardless of how the path was originally computed.
  """
  @spec ensure_at(Path.t(), map() | String.t() | nil) :: {:ok, Path.t()} | {:error, term()}
  def ensure_at(workspace, issue_or_identifier) when is_binary(workspace) do
    issue_context = issue_context(issue_or_identifier)
    layout = layout_for(issue_context)

    try do
      with :ok <- validate_workspace_path(workspace, layout.root),
           {:ok, created?} <- ensure_workspace(workspace),
           :ok <- maybe_run_after_create_hook(workspace, issue_context, layout, created?),
           :ok <- WorkspaceSkills.prepare(workspace) do
        {:ok, workspace}
      end
    rescue
      error in [ArgumentError, ErlangError, File.Error] ->
        Logger.error("Workspace ensure failed #{issue_log_context(issue_context)} error=#{Exception.message(error)}")
        {:error, error}
    end
  end

  defp ensure_workspace(workspace) do
    cond do
      File.dir?(workspace) ->
        clean_tmp_artifacts(workspace)
        {:ok, false}

      File.exists?(workspace) ->
        File.rm_rf!(workspace)
        create_workspace(workspace)

      true ->
        create_workspace(workspace)
    end
  end

  defp create_workspace(workspace) do
    File.rm_rf!(workspace)
    File.mkdir_p!(workspace)
    {:ok, true}
  end

  @spec path_for_issue(map() | String.t() | nil) :: Path.t()
  def path_for_issue(issue_or_identifier) do
    ctx = issue_context(issue_or_identifier)
    workspace_path_for_layout(safe_identifier(ctx.issue_identifier), layout_for(ctx))
  end

  @doc """
  Resolves the workspace root an issue's tree lives under.

  Mirrors the per-project resolution used by `create_for_issue/1`/`path_for_issue/1`
  so callers (e.g. the coding-agent cwd guard) validate against the same root the
  tree was actually created under, instead of the process-level global root.
  """
  @spec workspace_root_for(map() | String.t() | nil) :: Path.t()
  def workspace_root_for(issue_or_identifier) do
    issue_or_identifier
    |> issue_context()
    |> layout_for()
    |> Map.fetch!(:root)
  end

  @doc """
  Resolves the workspace layout (root + per-project segment) for a project.

  Issue workspaces live at `<root>/<segment>/<safe_id>`; the segment directory
  itself doubles as the shared project workspace. Used by the working-tree
  inventory so its scan agrees with the paths `create_for_issue/1` produces.
  """
  @spec project_layout(String.t()) :: %{root: Path.t(), segment: String.t()}
  def project_layout(project_slug) when is_binary(project_slug) do
    layout = layout_for(%{project_slug: project_slug, issue_identifier: nil, issue_id: nil})
    %{root: layout.root, segment: layout.segment}
  end

  @doc """
  Returns the next free isolated parallel-tree path for an issue.

  Parallel trees are siblings of the issue workspace named `<safe_id>__p<N>`,
  so one issue can host extra clean sessions without touching the tree its
  execution/authoring sessions share. `N` starts at 1 and skips paths that
  already exist on disk.
  """
  @spec next_parallel_path(map() | String.t() | nil) :: Path.t()
  def next_parallel_path(issue_or_identifier) do
    base = path_for_issue(issue_or_identifier)

    1..1000
    |> Enum.map(fn index -> "#{base}__p#{index}" end)
    |> Enum.find(&(not File.exists?(&1)))
    |> Kernel.||("#{base}__p#{System.unique_integer([:positive])}")
  end

  @spec remove(Path.t()) :: {:ok, [String.t()]} | {:error, term(), String.t()}
  def remove(workspace) do
    case File.exists?(workspace) do
      true ->
        case validate_workspace_path(workspace) do
          :ok ->
            maybe_run_before_remove_hook(workspace)
            File.rm_rf(workspace)

          {:error, reason} ->
            {:error, reason, ""}
        end

      false ->
        File.rm_rf(workspace)
    end
  end

  @spec remove_issue_workspaces(term()) :: :ok
  def remove_issue_workspaces(identifier) when is_binary(identifier) do
    safe_id = safe_identifier(identifier)
    root = Config.workspace_root()

    candidates =
      [
        Path.join(root, safe_id)
        | Path.wildcard(Path.join([root, "*", safe_id])) ++
            Path.wildcard(Path.join([root, "*", "*", safe_id]))
      ]
      |> Enum.uniq()

    Enum.each(candidates, &remove/1)
    :ok
  end

  def remove_issue_workspaces(_identifier) do
    :ok
  end

  @spec run_before_run_hook(Path.t(), map() | String.t() | nil) :: :ok | {:error, term()}
  def run_before_run_hook(workspace, issue_or_identifier) when is_binary(workspace) do
    issue_context = issue_context(issue_or_identifier)

    case Config.workspace_hooks()[:before_run] do
      nil ->
        :ok

      command ->
        run_hook(command, workspace, issue_context, "before_run")
    end
  end

  @spec run_after_run_hook(Path.t(), map() | String.t() | nil) :: :ok
  def run_after_run_hook(workspace, issue_or_identifier) when is_binary(workspace) do
    issue_context = issue_context(issue_or_identifier)

    case Config.workspace_hooks()[:after_run] do
      nil ->
        :ok

      command ->
        run_hook(command, workspace, issue_context, "after_run")
        |> ignore_hook_failure()
    end
  end

  # Resolves the workspace layout (root, nesting segment, after_create hook) for an
  # issue from its OWN project's config, falling back to the global active workflow
  # only when the issue has no resolvable project. This keeps a per-project issue
  # (e.g. a distributionmachine ticket) out of an unrelated project's workspace.
  defp layout_for(ctx) do
    case resolve_project_config(ctx) do
      {:ok, config} ->
        %{
          root: config.workspace_root || Config.workspace_root(),
          segment: project_segment(config),
          after_create_hook: config.after_create_hook
        }

      :error ->
        %{
          root: Config.workspace_root(),
          segment: global_segment(Map.get(ctx, :project_slug)),
          after_create_hook: Config.workspace_hooks()[:after_create]
        }
    end
  end

  defp resolve_project_config(%{project_slug: slug}) when is_binary(slug) and slug != "" do
    case Context.get_project(slug) do
      {:ok, project} ->
        {:ok, project |> Repo.preload(:setup) |> ProjectConfig.resolve()}

      _ ->
        :error
    end
  end

  defp resolve_project_config(%{issue_identifier: identifier}) when is_binary(identifier) do
    case Context.find_project_slug(identifier) do
      slug when is_binary(slug) and slug != "" -> resolve_project_config(%{project_slug: slug})
      _ -> :error
    end
  end

  defp resolve_project_config(_ctx), do: :error

  defp project_segment(%ProjectConfig{tracker_kind: "github", repo: repo})
       when is_binary(repo) and repo != "",
       do: repo

  defp project_segment(%ProjectConfig{project_slug: slug}) when is_binary(slug) and slug != "",
    do: slug

  defp project_segment(_config), do: ""

  defp global_segment(slug) do
    case Config.tracker_kind() do
      "github" -> GitHubConfig.repo() || ""
      _ when is_binary(slug) and slug != "" -> slug
      _ -> ""
    end
  end

  defp workspace_path_for_layout(safe_id, %{root: root, segment: segment})
       when is_binary(safe_id) and is_binary(segment) and segment != "" do
    Path.join([root, segment, safe_id])
  end

  defp workspace_path_for_layout(safe_id, %{root: root}) when is_binary(safe_id) do
    Path.join(root, safe_id)
  end

  defp safe_identifier(identifier) do
    String.replace(identifier || "issue", ~r/[^a-zA-Z0-9._-]/, "_")
  end

  defp clean_tmp_artifacts(workspace) do
    Enum.each(MapSet.to_list(@excluded_entries), fn entry ->
      File.rm_rf(Path.join(workspace, entry))
    end)
  end

  defp maybe_run_after_create_hook(_workspace, _issue_context, _layout, false), do: :ok

  defp maybe_run_after_create_hook(workspace, issue_context, %{after_create_hook: command}, true)
       when is_binary(command) and command != "" do
    run_hook(command, workspace, issue_context, "after_create")
  end

  defp maybe_run_after_create_hook(_workspace, _issue_context, _layout, true), do: :ok

  defp maybe_run_before_remove_hook(workspace) do
    case File.dir?(workspace) do
      true ->
        case Config.workspace_hooks()[:before_remove] do
          nil ->
            :ok

          command ->
            run_hook(
              command,
              workspace,
              %{issue_id: nil, issue_identifier: Path.basename(workspace)},
              "before_remove"
            )
            |> ignore_hook_failure()
        end

      false ->
        :ok
    end
  end

  defp ignore_hook_failure(:ok), do: :ok
  defp ignore_hook_failure({:error, _reason}), do: :ok

  defp run_hook(command, workspace, issue_context, hook_name) do
    timeout_ms = Config.workspace_hooks()[:timeout_ms]

    Logger.info("Running workspace hook hook=#{hook_name} #{issue_log_context(issue_context)} workspace=#{workspace}")

    task =
      Task.async(fn ->
        System.cmd("sh", ["-lc", command], cd: workspace, stderr_to_stdout: true)
      end)

    case Task.yield(task, timeout_ms) do
      {:ok, cmd_result} ->
        handle_hook_command_result(cmd_result, workspace, issue_context, hook_name)

      nil ->
        Task.shutdown(task, :brutal_kill)

        Logger.warning("Workspace hook timed out hook=#{hook_name} #{issue_log_context(issue_context)} workspace=#{workspace} timeout_ms=#{timeout_ms}")

        {:error, {:workspace_hook_timeout, hook_name, timeout_ms}}
    end
  end

  defp handle_hook_command_result({_output, 0}, _workspace, _issue_id, _hook_name) do
    :ok
  end

  defp handle_hook_command_result({output, status}, workspace, issue_context, hook_name) do
    sanitized_output = sanitize_hook_output_for_log(output)

    Logger.warning("Workspace hook failed hook=#{hook_name} #{issue_log_context(issue_context)} workspace=#{workspace} status=#{status} output=#{inspect(sanitized_output)}")

    {:error, {:workspace_hook_failed, hook_name, status, output}}
  end

  defp sanitize_hook_output_for_log(output, max_bytes \\ 2_048) do
    binary_output = IO.iodata_to_binary(output)

    case byte_size(binary_output) <= max_bytes do
      true ->
        binary_output

      false ->
        binary_part(binary_output, 0, max_bytes) <> "... (truncated)"
    end
  end

  defp validate_workspace_path(workspace), do: validate_workspace_path(workspace, Config.workspace_root())

  defp validate_workspace_path(workspace, root_value) when is_binary(workspace) do
    expanded_workspace = Path.expand(workspace)
    root = Path.expand(root_value)
    root_prefix = root <> "/"

    cond do
      expanded_workspace == root ->
        {:error, {:workspace_equals_root, expanded_workspace, root}}

      String.starts_with?(expanded_workspace <> "/", root_prefix) ->
        ensure_no_symlink_components(expanded_workspace, root)

      true ->
        {:error, {:workspace_outside_root, expanded_workspace, root}}
    end
  end

  defp ensure_no_symlink_components(workspace, root) do
    workspace
    |> Path.relative_to(root)
    |> Path.split()
    |> Enum.reduce_while(root, fn segment, current_path ->
      next_path = Path.join(current_path, segment)

      case File.lstat(next_path) do
        {:ok, %File.Stat{type: :symlink}} ->
          {:halt, {:error, {:workspace_symlink_escape, next_path, root}}}

        {:ok, _stat} ->
          {:cont, next_path}

        {:error, :enoent} ->
          {:halt, :ok}

        {:error, reason} ->
          {:halt, {:error, {:workspace_path_unreadable, next_path, reason}}}
      end
    end)
    |> case do
      :ok -> :ok
      {:error, _reason} = error -> error
      _final_path -> :ok
    end
  end

  defp issue_context(%{} = issue) do
    identifier = Map.get(issue, :identifier) || Map.get(issue, "identifier")

    if is_binary(identifier) and identifier != "" do
      %{
        issue_id: Map.get(issue, :id) || Map.get(issue, "id"),
        issue_identifier: identifier,
        project_slug: Map.get(issue, :project_slug) || Map.get(issue, "project_slug")
      }
    else
      issue_context_fallback(issue)
    end
  end

  defp issue_context(identifier) when is_binary(identifier) do
    %{
      issue_id: nil,
      issue_identifier: identifier,
      project_slug: nil
    }
  end

  defp issue_context(other), do: issue_context_fallback(other)

  defp issue_context_fallback(_issue) do
    %{
      issue_id: nil,
      issue_identifier: "issue",
      project_slug: nil
    }
  end

  defp issue_log_context(%{issue_id: issue_id, issue_identifier: issue_identifier}) do
    "issue_id=#{issue_id || "n/a"} issue_identifier=#{issue_identifier || "issue"}"
  end
end
