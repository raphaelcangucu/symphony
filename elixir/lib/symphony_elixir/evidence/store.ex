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
      run_id = Keyword.get(opts, :run_id, generate_run_id())
      destination = Path.join([evidence_root(opts), project_slug, safe(identifier), run_id])

      with :ok <- copy_artifacts(Manifest.dir(workspace), destination) do
        %Record{}
        |> Record.changeset(%{
          project_id: project.id,
          issue_identifier: identifier,
          run_id: run_id,
          session_id: Keyword.get(opts, :session_id),
          status: overall_status(manifest_map),
          ui_change: manifest_map["ui_change"] == true,
          manifest: manifest_map,
          artifact_dir: destination
        })
        |> Repo.insert()
      end
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

      count = Enum.reduce(records, 0, fn record, acc ->
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

      count = Enum.reduce(records, 0, fn record, acc ->
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
      not File.exists?(full) -> {:error, :not_found}
      true -> {:ok, full}
    end
  end

  @spec evidence_root(keyword()) :: Path.t()
  def evidence_root(opts \\ []) do
    Keyword.get_lazy(opts, :evidence_root, fn ->
      root = Application.get_env(:symphony_elixir, :root_dir, File.cwd!())
      Path.join(root, ".symphony/evidence")
    end)
  end

  defp copy_artifacts(source, destination) do
    File.mkdir_p!(destination)

    case File.cp_r(source, destination) do
      {:ok, _copied} -> :ok
      {:error, reason, file} -> {:error, {:artifact_copy_failed, reason, file}}
    end
  end

  defp overall_status(%{"runs" => runs}) when is_list(runs), do: RunStatus.overall_status(runs)

  defp overall_status(_manifest), do: "failed"

  defp generate_run_id do
    DateTime.utc_now()
    |> Calendar.strftime("%Y%m%d%H%M%S")
    |> Kernel.<>("-#{System.unique_integer([:positive])}")
  end

  defp safe(identifier), do: String.replace(identifier, ~r/[^a-zA-Z0-9._-]/, "_")

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
