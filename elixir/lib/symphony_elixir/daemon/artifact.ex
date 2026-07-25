defmodule SymphonyElixir.Daemon.Artifact do
  @moduledoc "Safely validates and stages a packaged Symphony release."

  alias SymphonyElixir.Daemon.{Files, Paths}

  @version_pattern ~r/\A[0-9A-Za-z][0-9A-Za-z._+-]*\z/

  @spec validate_entries([term()]) :: :ok | {:error, :unsafe_archive_path}
  def validate_entries(entries) do
    safe? =
      Enum.all?(entries, fn entry ->
        with {:ok, entry_path} <- safe_entry_path(entry) do
          path = to_string(entry_path)
          segments = Path.split(path)

          path != "" and Path.type(path) != :absolute and
            ".." not in segments and not String.contains?(path, "\0")
        else
          :error -> false
        end
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
         {:ok, entries} <-
           :erl_tar.table(String.to_charlist(archive), [:compressed, :verbose]),
         :ok <- validate_entries(entries),
         :ok <- Files.ensure_private_dir(staging),
         :ok <-
           :erl_tar.extract(
             String.to_charlist(archive),
             [:compressed, {:cwd, String.to_charlist(staging)}]
           ),
         {:ok, manifest_path, manifest, release_root} <- locate_manifest(staging),
         {:ok, identity} <- validate_manifest(manifest),
         :ok <- validate_checksums(release_root, manifest_path, manifest["checksums"]),
         {:ok, target, replaced_path} <-
           activate(staging, release_root, paths, identity.version) do
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

  @spec validate_release(Path.t()) :: :ok | {:error, term()}
  def validate_release(release_root) do
    with {:ok, manifest_path, manifest, ^release_root} <- locate_manifest(release_root),
         {:ok, _identity} <- validate_manifest(manifest),
         :ok <- validate_checksums(release_root, manifest_path, manifest["checksums"]) do
      :ok
    else
      _ -> {:error, :invalid_release}
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
    candidates =
      [
        {Path.join(staging, "manifest.json"), staging}
        | Enum.map(Path.wildcard(Path.join(staging, "*/manifest.json")), fn path ->
            {path, Path.dirname(path)}
          end)
      ] ++
        Enum.map(Path.wildcard(Path.join(staging, "releases/*/manifest.json")), fn path ->
          {path, staging}
        end)

    candidates =
      candidates
      |> Enum.filter(fn {path, _release_root} -> File.regular?(path) end)
      |> Enum.uniq_by(&elem(&1, 0))

    case candidates do
      [{path, release_root}] ->
        case File.read(path) do
          {:ok, body} ->
            case Jason.decode(body) do
              {:ok, %{} = manifest} -> {:ok, path, manifest, release_root}
              _ -> {:error, :invalid_manifest}
            end

          {:error, reason} ->
            {:error, reason}
        end

      _ ->
        {:error, :invalid_manifest}
    end
  end

  defp safe_entry_path(entry) when is_list(entry), do: {:ok, entry}

  defp safe_entry_path(entry)
       when is_tuple(entry) and tuple_size(entry) >= 2 and
              elem(entry, 1) in [:regular, :directory] do
    case elem(entry, 0) do
      path when is_list(path) -> {:ok, path}
      _other -> :error
    end
  end

  defp safe_entry_path(_entry), do: :error

  defp validate_manifest(manifest) do
    version = manifest["version"]
    commit = manifest["git_commit"]
    architecture = manifest["system_architecture"]
    target_os = manifest["target_os"]
    checksums = manifest["checksums"]
    current = :erlang.system_info(:system_architecture) |> to_string()

    if safe_version?(version) and
         Enum.all?([commit, architecture, target_os], &(is_binary(&1) and &1 != "")) and
         architecture == current and target_os == "linux" and is_map(checksums) and
         map_size(checksums) > 0 do
      {:ok, %{version: version, git_commit: commit}}
    else
      {:error, :incompatible_manifest}
    end
  end

  defp safe_version?(version) when is_binary(version) do
    version not in [".", ".."] and Regex.match?(@version_pattern, version)
  end

  defp safe_version?(_version), do: false

  defp validate_checksums(release_root, manifest_path, checksums) when is_map(checksums) do
    actual_files =
      release_root
      |> Path.join("**/*")
      |> Path.wildcard(match_dot: true)
      |> Enum.filter(&File.regular?/1)
      |> Enum.reject(&(&1 == manifest_path))
      |> MapSet.new(&Path.relative_to(&1, release_root))

    declared_files = Map.keys(checksums) |> MapSet.new()

    valid? =
      actual_files == declared_files and
        Enum.all?(checksums, fn {relative, expected} ->
          safe_checksum_path?(relative) and valid_digest?(expected) and
            secure_compare(sha256(Path.join(release_root, relative)), expected)
        end)

    if valid?, do: :ok, else: {:error, :checksum_mismatch}
  end

  defp validate_checksums(_release_root, _manifest_path, _checksums),
    do: {:error, :checksum_mismatch}

  defp safe_checksum_path?(path) when is_binary(path) do
    path != "" and Path.type(path) == :relative and ".." not in Path.split(path) and
      not String.contains?(path, "\0")
  end

  defp safe_checksum_path?(_path), do: false

  defp valid_digest?(digest),
    do: is_binary(digest) and Regex.match?(~r/\A[0-9a-f]{64}\z/, digest)

  defp secure_compare(left, right) when byte_size(left) == byte_size(right) do
    left
    |> :crypto.exor(right)
    |> :binary.bin_to_list()
    |> Enum.reduce(0, &Bitwise.bor/2)
    |> Kernel.==(0)
  end

  defp secure_compare(_left, _right), do: false

  defp activate(staging, release_root, paths, version) do
    target = Path.join(paths.releases_dir, version)
    replaced_path = target <> ".replaced-#{System.unique_integer([:positive, :monotonic])}"
    :ok = Files.ensure_private_dir(paths.releases_dir)

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
