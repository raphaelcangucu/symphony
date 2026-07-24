defmodule SymphonyElixir.Daemon.Artifact do
  @moduledoc "Safely validates and stages a packaged Symphony release."

  alias SymphonyElixir.Daemon.Paths

  @spec validate_entries([charlist()]) :: :ok | {:error, :unsafe_archive_path}
  def validate_entries(entries) do
    safe? =
      Enum.all?(entries, fn entry ->
        path = to_string(entry)
        segments = Path.split(path)

        path != "" and Path.type(path) != :absolute and
          ".." not in segments and not String.contains?(path, "\0")
      end)

    if safe?, do: :ok, else: {:error, :unsafe_archive_path}
  end

  @spec stage(Path.t(), Paths.t()) :: {:ok, map()} | {:error, term()}
  def stage(archive, %Paths{} = paths) do
    staging =
      Path.join(
        paths.releases_dir,
        ".staging-#{System.unique_integer([:positive, :monotonic])}"
      )

    with true <- File.regular?(archive) || {:error, :artifact_missing},
         {:ok, entries} <- :erl_tar.table(String.to_charlist(archive), [:compressed]),
         :ok <- validate_entries(entries),
         :ok <- File.mkdir_p(staging),
         :ok <-
           :erl_tar.extract(
             String.to_charlist(archive),
             [:compressed, {:cwd, String.to_charlist(staging)}]
           ),
         {:ok, manifest_path, manifest} <- locate_manifest(staging),
         {:ok, identity} <- validate_manifest(manifest),
         {:ok, target, replaced_path} <-
           activate(staging, manifest_path, paths, identity.version) do
      {:ok,
       %{
         path: target,
         version: identity.version,
         git_commit: identity.git_commit,
         artifact_sha256: sha256(archive),
         manifest: manifest,
         replaced_path: replaced_path,
         staging_transaction: true
       }}
    else
      false -> cleanup_error(staging, :artifact_missing)
      {:error, reason} -> cleanup_error(staging, reason)
    end
  end

  @spec finalize(map()) :: :ok | {:error, term()}
  def finalize(%{staging_transaction: true, replaced_path: replaced_path}) do
    remove_tree(replaced_path)
  end

  def finalize(_candidate), do: :ok

  @spec rollback(map()) :: :ok | {:error, term()}
  def rollback(%{
        staging_transaction: true,
        path: target,
        replaced_path: replaced_path
      }) do
    with :ok <- remove_tree(target),
         :ok <- restore_replaced(replaced_path, target) do
      :ok
    end
  end

  def rollback(_candidate), do: :ok

  defp locate_manifest(staging) do
    manifests = Path.wildcard(Path.join(staging, "**/manifest.json"))

    case manifests do
      [path] ->
        case File.read(path) do
          {:ok, body} ->
            case Jason.decode(body) do
              {:ok, %{} = manifest} -> {:ok, path, manifest}
              _ -> {:error, :invalid_manifest}
            end

          {:error, reason} ->
            {:error, reason}
        end

      _ ->
        {:error, :invalid_manifest}
    end
  end

  defp validate_manifest(manifest) do
    version = manifest["version"]
    commit = manifest["git_commit"]
    architecture = manifest["system_architecture"]
    current = :erlang.system_info(:system_architecture) |> to_string()

    if Enum.all?([version, commit, architecture], &(is_binary(&1) and &1 != "")) and
         architecture == current do
      {:ok, %{version: version, git_commit: commit}}
    else
      {:error, :incompatible_manifest}
    end
  end

  defp activate(staging, manifest_path, paths, version) do
    release_root = Path.dirname(manifest_path)
    target = Path.join(paths.releases_dir, version)
    replaced_path = target <> ".replaced-#{System.unique_integer([:positive, :monotonic])}"
    :ok = File.mkdir_p(paths.releases_dir)

    with {:ok, replaced_path} <- preserve_target(target, replaced_path),
         :ok <- move_candidate(release_root, target, replaced_path) do
      File.rm_rf(staging)
      {:ok, target, replaced_path}
    end
  end

  defp move_candidate(release_root, target, replaced_path) do
    case File.rename(release_root, target) do
      :ok ->
        :ok

      {:error, reason} ->
        _ = restore_replaced(replaced_path, target)
        {:error, reason}
    end
  end

  defp preserve_target(target, replaced_path) do
    if path_present?(target) do
      case File.rename(target, replaced_path) do
        :ok -> {:ok, replaced_path}
        {:error, reason} -> {:error, reason}
      end
    else
      {:ok, nil}
    end
  end

  defp restore_replaced(nil, _target), do: :ok
  defp restore_replaced(replaced_path, target), do: File.rename(replaced_path, target)

  defp remove_tree(nil), do: :ok

  defp remove_tree(path) do
    case File.rm_rf(path) do
      {:ok, _paths} -> :ok
      {:error, reason, _path} -> {:error, reason}
    end
  end

  defp path_present?(path) do
    match?({:ok, _stat}, File.lstat(path))
  end

  defp cleanup_error(staging, reason) do
    File.rm_rf(staging)
    {:error, reason}
  end

  defp sha256(path) do
    path
    |> File.read!()
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.encode16(case: :lower)
  end
end
