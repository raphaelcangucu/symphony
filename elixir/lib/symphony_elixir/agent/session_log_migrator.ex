defmodule SymphonyElixir.Agent.SessionLogMigrator do
  @moduledoc """
  One-shot migration: seed per-session transcript files from the shared
  working-tree agent log for Threads that do not yet have
  `.symphony/sessions/<id>/transcript.jsonl`.
  """

  require Logger

  import Ecto.Query

  alias SymphonyElixir.Agent.SessionStore
  alias SymphonyElixir.Assistant.Thread
  alias SymphonyElixir.Repo
  alias SymphonyElixir.SessionLog

  @spec migrate(keyword()) :: %{
          migrated: non_neg_integer(),
          skipped: non_neg_integer(),
          errors: non_neg_integer()
        }
  def migrate(opts \\ []) when is_list(opts) do
    dry_run? = Keyword.get(opts, :dry_run, false) == true
    project_slug = Keyword.get(opts, :project_slug)
    resolve = Keyword.get(opts, :resolve, &default_resolve/1)

    unless is_function(resolve, 1) do
      raise ArgumentError, "opts[:resolve] must be a 1-arity function"
    end

    threads = list_threads(project_slug)

    Enum.reduce(threads, %{migrated: 0, skipped: 0, errors: 0}, fn thread, acc ->
      migrate_thread(thread, dry_run?, resolve, acc)
    end)
  end

  defp list_threads(nil) do
    from(t in Thread, where: not is_nil(t.workspace_path) and t.workspace_path != "")
    |> Repo.all()
  end

  defp list_threads(project_slug) when is_binary(project_slug) do
    slug = String.trim(project_slug)

    from(t in Thread,
      where:
        not is_nil(t.workspace_path) and t.workspace_path != "" and t.project_slug == ^slug
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
