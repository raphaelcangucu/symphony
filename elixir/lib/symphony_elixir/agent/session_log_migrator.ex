defmodule SymphonyElixir.Agent.SessionLogMigrator do
  @moduledoc """
  One-shot migration for per-session identity:

  1. For each issue working tree that has a shared agent log but no
     `issue_execution` Thread, create a historical `issue_execution` session.
  2. Seed `.symphony/sessions/<thread_id>/transcript.jsonl` from the shared
     working-tree agent log when that per-session file is missing.

  Idempotent — safe if already ran, and safe to re-run.
  """

  require Logger

  import Ecto.Query

  alias SymphonyElixir.Agent.SessionStore
  alias SymphonyElixir.Assistant.Thread
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.SessionLog
  alias SymphonyElixir.Workspace

  @type result :: %{
          created: non_neg_integer(),
          migrated: non_neg_integer(),
          skipped: non_neg_integer(),
          errors: non_neg_integer()
        }

  @spec migrate(keyword()) :: result()
  def migrate(opts \\ []) when is_list(opts) do
    dry_run? = Keyword.get(opts, :dry_run, false) == true
    project_slug = Keyword.get(opts, :project_slug)
    resolve = Keyword.get(opts, :resolve, &default_resolve/1)

    unless is_function(resolve, 1) do
      raise ArgumentError, "opts[:resolve] must be a 1-arity function"
    end

    candidates =
      case Keyword.get(opts, :candidates) do
        list when is_list(list) -> list
        _ -> candidate_workspaces(project_slug)
      end

    created_acc = ensure_execution_sessions(candidates, dry_run?, resolve)

    threads = list_threads(project_slug)

    Enum.reduce(threads, created_acc, fn thread, acc ->
      migrate_thread(thread, dry_run?, resolve, acc)
    end)
  end

  defp ensure_execution_sessions(candidates, dry_run?, resolve) when is_list(candidates) do
    Enum.reduce(candidates, %{created: 0, migrated: 0, skipped: 0, errors: 0}, fn candidate, acc ->
      ensure_one_execution(candidate, dry_run?, resolve, acc)
    end)
  end

  defp ensure_one_execution(candidate, dry_run?, resolve, acc) do
    %{
      project_slug: project_slug,
      issue_identifier: issue_identifier,
      workspace_path: workspace,
      agent_kind: agent_kind,
      title: title
    } = candidate

    case existing_execution(project_slug, issue_identifier) do
      %Thread{} ->
        %{acc | skipped: acc.skipped + 1}

      nil ->
        if dry_run? do
          %{acc | created: acc.created + 1}
        else
          create_historical_execution(
            project_slug,
            issue_identifier,
            workspace,
            agent_kind,
            title,
            resolve,
            acc
          )
        end
    end
  end

  defp create_historical_execution(
         project_slug,
         issue_identifier,
         workspace,
         agent_kind,
         title,
         resolve,
         acc
       ) do
    attrs = %{
      scope: "issue_execution",
      project_slug: project_slug,
      issue_identifier: issue_identifier,
      workspace_path: workspace,
      agent_kind: agent_kind,
      title: title || issue_identifier,
      status: "error",
      metadata: %{"origin" => "migration"}
    }

    case %Thread{} |> Thread.changeset(attrs) |> Repo.insert() do
      {:ok, thread} ->
        # Best-effort seed immediately so the new session has its own log.
        acc = %{acc | created: acc.created + 1}
        migrate_thread(thread, false, resolve, acc)

      {:error, reason} ->
        Logger.warning(
          "SessionLogMigrator create issue_execution failed " <>
            "project=#{project_slug} issue=#{issue_identifier} reason=#{inspect(reason)}"
        )

        %{acc | errors: acc.errors + 1}
    end
  end

  defp existing_execution(project_slug, issue_identifier) do
    Repo.one(
      from(t in Thread,
        where:
          t.scope == "issue_execution" and t.project_slug == ^project_slug and
            t.issue_identifier == ^issue_identifier,
        order_by: [desc: t.id],
        limit: 1
      )
    )
  end

  defp candidate_workspaces(nil) do
    Context.list_projects()
    |> Enum.flat_map(fn project -> candidate_workspaces(project.slug) end)
  end

  defp candidate_workspaces(project_slug) when is_binary(project_slug) do
    slug = String.trim(project_slug)
    %{root: root, segment: segment} = Workspace.project_layout(slug)
    base = Path.join(root, segment)

    case File.ls(base) do
      {:ok, entries} ->
        entries
        |> Enum.reject(&String.starts_with?(&1, "."))
        |> Enum.reject(&String.contains?(&1, "__p"))
        |> Enum.flat_map(&candidate_from_entry(slug, Path.join(base, &1), &1))

      {:error, _} ->
        []
    end
  end

  defp candidate_from_entry(project_slug, workspace_path, entry_name) do
    with true <- File.dir?(workspace_path),
         {:ok, issue} <- Context.get_issue(project_slug, entry_name),
         {:ok, agent_kind, _path} <- SessionLog.resolve_log_source("codex", workspace_path) do
      [
        %{
          project_slug: project_slug,
          issue_identifier: entry_name,
          workspace_path: workspace_path,
          agent_kind: agent_kind,
          title: Map.get(issue, :title) || entry_name
        }
      ]
    else
      _ -> []
    end
  end

  defp list_threads(nil) do
    from(t in Thread, where: not is_nil(t.workspace_path) and t.workspace_path != "")
    |> Repo.all()
  end

  defp list_threads(project_slug) when is_binary(project_slug) do
    slug = String.trim(project_slug)

    from(t in Thread,
      where: not is_nil(t.workspace_path) and t.workspace_path != "" and t.project_slug == ^slug
    )
    |> Repo.all()
  end

  defp migrate_thread(thread, dry_run?, resolve, acc) do
    workspace = thread.workspace_path

    cond do
      not is_binary(workspace) or String.trim(workspace) == "" ->
        %{acc | skipped: acc.skipped + 1}

      SessionStore.exists?(workspace, thread.id) ->
        %{acc | skipped: acc.skipped + 1}

      true ->
        case resolve.(thread) do
          {:ok, _kind, path} when is_binary(path) ->
            copy_or_count(thread, workspace, path, dry_run?, acc)

          :error ->
            %{acc | skipped: acc.skipped + 1}

          _other ->
            %{acc | skipped: acc.skipped + 1}
        end
    end
  end

  defp copy_or_count(_thread, _workspace, _source_path, true, acc) do
    %{acc | migrated: acc.migrated + 1}
  end

  defp copy_or_count(thread, workspace, source_path, false, acc) do
    dest = SessionStore.transcript_path(workspace, thread.id)

    with :ok <- File.mkdir_p(Path.dirname(dest)),
         :ok <- File.cp(source_path, dest) do
      %{acc | migrated: acc.migrated + 1}
    else
      {:error, reason} ->
        Logger.warning(
          "SessionLogMigrator copy failed thread_id=#{thread.id} " <>
            "source=#{source_path} dest=#{dest} reason=#{inspect(reason)}"
        )

        %{acc | errors: acc.errors + 1}
    end
  end

  defp default_resolve(thread) do
    agent_kind =
      case thread.agent_kind do
        kind when is_binary(kind) and kind != "" -> kind
        _ -> "codex"
      end

    SessionLog.resolve_log_source(agent_kind, thread.workspace_path)
  end
end
