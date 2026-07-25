defmodule SymphonyElixir.Evidence.Store do
  @moduledoc """
  Durable persistence for evidence: copies the workspace's
  `.symphony/evidence/` tree into `<evidence_root>/<project>/<issue>/<run_id>/`
  (survives workspace removal) and records the manifest in `issue_evidence`.
  """

  import Ecto.Query

  alias SymphonyElixir.Evidence.Manifest
  alias SymphonyElixir.Evidence.Record
  alias SymphonyElixir.Evidence.RunStatus
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @spec persist(String.t(), String.t(), Path.t(), map(), keyword()) ::
          {:ok, Record.t()} | {:error, term()}
  def persist(project_slug, identifier, workspace, manifest_map, opts \\ []) do
    with {:ok, project} <- Context.get_project(project_slug) do
      case idempotent_record(project.id, identifier, manifest_map, opts) do
        %Record{} = record -> {:ok, record}
        nil -> persist_new(project.id, project_slug, identifier, workspace, manifest_map, opts)
      end
    end
  end

  defp persist_new(project_id, project_slug, identifier, workspace, manifest_map, opts) do
    run_id = Keyword.get(opts, :run_id, generate_run_id())
    root = Path.expand(evidence_root(opts))

    destination =
      Path.join([
        root,
        safe_component(project_slug),
        safe_component(identifier),
        safe_component(run_id)
      ])

    source = Keyword.get(opts, :evidence_dir, Manifest.resolve_dir(workspace))

    with :ok <- ensure_descendant(root, destination),
         :ok <- copy_artifacts(source, destination, manifest_map) do
      result =
        %Record{}
        |> Record.changeset(%{
          project_id: project_id,
          issue_identifier: identifier,
          run_id: run_id,
          session_id: Keyword.get(opts, :session_id),
          status: overall_status(manifest_map),
          ui_change: manifest_map["ui_change"] == true,
          manifest: manifest_map,
          artifact_dir: destination
        })
        |> Repo.insert()

      if match?({:error, _reason}, result), do: File.rm_rf(destination)
      result
    end
  end

  defp idempotent_record(project_id, identifier, manifest_map, opts) do
    session_id = Keyword.get(opts, :session_id)

    if Keyword.get(opts, :idempotent, false) and is_binary(session_id) do
      Repo.all(
        from(r in Record,
          where:
            r.project_id == ^project_id and r.issue_identifier == ^identifier and
              r.session_id == ^session_id,
          order_by: [desc: r.inserted_at]
        )
      )
      |> Enum.find(fn record ->
        record.manifest == manifest_map and File.dir?(record.artifact_dir)
      end)
    end
  end

  @spec list(String.t(), String.t()) :: {:ok, [Record.t()]} | {:error, term()}
  def list(project_slug, identifier) do
    with {:ok, project} <- Context.get_project(project_slug) do
      records =
        Repo.all(
          from(r in Record,
            where: r.project_id == ^project.id and r.issue_identifier == ^identifier,
            order_by: [desc: r.inserted_at]
          )
        )

      {:ok, records}
    end
  end

  @spec delete_run(String.t(), String.t(), String.t()) ::
          {:ok, Record.t()} | {:error, :run_not_found | term()}
  def delete_run(project_slug, identifier, run_id) do
    with {:ok, project} <- Context.get_project(project_slug),
         %Record{} = record <- find_record(project.id, identifier, run_id) do
      delete_record(record)
    else
      nil -> {:error, :run_not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  @spec delete_all(String.t(), String.t()) :: {:ok, non_neg_integer()} | {:error, term()}
  def delete_all(project_slug, identifier) do
    with {:ok, project} <- Context.get_project(project_slug) do
      records =
        Repo.all(
          from(r in Record,
            where: r.project_id == ^project.id and r.issue_identifier == ^identifier
          )
        )

      count =
        Enum.reduce(records, 0, fn record, acc ->
          case delete_record(record) do
            {:ok, _} -> acc + 1
            {:error, _} -> acc
          end
        end)

      {:ok, count}
    end
  end

  @spec delete_failed(String.t(), String.t()) :: {:ok, non_neg_integer()} | {:error, term()}
  def delete_failed(project_slug, identifier) do
    with {:ok, project} <- Context.get_project(project_slug) do
      records =
        Repo.all(
          from(r in Record,
            where:
              r.project_id == ^project.id and r.issue_identifier == ^identifier and
                r.status != "passed"
          )
        )

      count =
        Enum.reduce(records, 0, fn record, acc ->
          case delete_record(record) do
            {:ok, _} -> acc + 1
            {:error, _} -> acc
          end
        end)

      {:ok, count}
    end
  end

  @spec resolve_artifact(Record.t(), String.t()) ::
          {:ok, Path.t()} | {:error, :invalid_path | :not_found}
  def resolve_artifact(%Record{artifact_dir: dir}, relative) do
    base = Path.expand(dir)
    full = Path.expand(Path.join(dir, relative))

    cond do
      not String.starts_with?(full, base <> "/") -> {:error, :invalid_path}
      symlink_in_tree?(base, full) -> {:error, :invalid_path}
      true -> regular_artifact(full)
    end
  end

  @spec evidence_root(keyword()) :: Path.t()
  def evidence_root(opts \\ []) do
    Keyword.get_lazy(opts, :evidence_root, fn ->
      root = Application.get_env(:symphony_elixir, :root_dir, File.cwd!())
      Path.join(root, ".symphony/evidence")
    end)
  end

  defp copy_artifacts(source, destination, manifest_map) do
    with :ok <- ensure_symlink_free_tree(source),
         :ok <- File.mkdir_p(destination),
         {:ok, _copied} <- File.cp_r(source, destination),
         :ok <- ensure_symlink_free_tree(destination),
         :ok <-
           File.write(
             Path.join(destination, "manifest.json"),
             Jason.encode_to_iodata!(manifest_map)
           ) do
      :ok
    else
      {:error, reason, file} ->
        File.rm_rf(destination)
        {:error, {:artifact_copy_failed, reason, file}}

      {:error, _reason} = error ->
        File.rm_rf(destination)
        error
    end
  end

  defp ensure_symlink_free_tree(path) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :symlink}} ->
        {:error, {:unsafe_artifact_symlink, path}}

      {:ok, %File.Stat{type: :directory}} ->
        path
        |> File.ls()
        |> case do
          {:ok, entries} ->
            Enum.reduce_while(entries, :ok, fn entry, :ok ->
              case ensure_symlink_free_tree(Path.join(path, entry)) do
                :ok -> {:cont, :ok}
                {:error, _reason} = error -> {:halt, error}
              end
            end)

          {:error, reason} ->
            {:error, {:artifact_tree_unreadable, path, reason}}
        end

      {:ok, _stat} ->
        :ok

      {:error, reason} ->
        {:error, {:artifact_tree_unreadable, path, reason}}
    end
  end

  defp regular_artifact(path) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :regular}} -> {:ok, path}
      {:ok, _stat} -> {:error, :invalid_path}
      {:error, :enoent} -> {:error, :not_found}
      {:error, _reason} -> {:error, :not_found}
    end
  end

  defp symlink_in_tree?(base, full) do
    [base | relative_components(base, full)]
    |> Enum.scan(fn
      path, nil -> path
      component, parent -> Path.join(parent, component)
    end)
    |> Enum.any?(fn path ->
      match?({:ok, %File.Stat{type: :symlink}}, File.lstat(path))
    end)
  end

  defp relative_components(base, full) do
    full
    |> Path.relative_to(base)
    |> Path.split()
  end

  defp ensure_descendant(root, destination) do
    if String.starts_with?(Path.expand(destination), root <> "/") do
      :ok
    else
      {:error, :invalid_evidence_destination}
    end
  end

  defp overall_status(%{"runs" => runs}) when is_list(runs), do: RunStatus.overall_status(runs)

  defp overall_status(_manifest), do: "failed"

  defp generate_run_id do
    DateTime.utc_now()
    |> Calendar.strftime("%Y%m%d%H%M%S")
    |> Kernel.<>("-#{System.unique_integer([:positive])}")
  end

  defp safe_component(value) do
    sanitized = value |> to_string() |> String.replace(~r/[^a-zA-Z0-9._-]/, "_")
    if sanitized in ["", ".", ".."], do: "_#{sanitized}", else: sanitized
  end

  defp find_record(project_id, identifier, run_id) do
    Repo.one(
      from(r in Record,
        where:
          r.project_id == ^project_id and r.issue_identifier == ^identifier and
            r.run_id == ^run_id
      )
    )
  end

  defp delete_record(%Record{} = record) do
    remove_artifact_dir(record)

    case Repo.delete(record) do
      {:ok, deleted} -> {:ok, deleted}
      {:error, changeset} -> {:error, changeset}
    end
  end

  defp remove_artifact_dir(%Record{artifact_dir: dir}) when is_binary(dir) and dir != "" do
    full = Path.expand(dir)

    if File.exists?(full) do
      File.rm_rf!(full)
    end

    :ok
  end

  defp remove_artifact_dir(_record), do: :ok
end
