defmodule SymphonyElixir.Evidence.RemoteArtifacts do
  @moduledoc """
  Rewrites Symphony-served evidence artifact URLs in a remote comment body into
  tracker-hosted references by uploading the underlying files natively (Linear
  `fileUpload`, Jira attachments). The local comment keeps the Symphony URLs (the
  Evidence tab serves them); only the body pushed to the remote is rewritten so
  the images render without a publicly reachable Symphony.

  Uploads are cached by `(provider, content_sha256)` (`Evidence.RemoteAsset`), so
  the rapid in-place updates of one evidence comment never re-upload the same
  bytes.
  """

  import Ecto.Query

  require Logger

  alias SymphonyElixir.Evidence.RemoteAsset
  alias SymphonyElixir.Evidence.Store
  alias SymphonyElixir.Repo

  # Matches a Symphony evidence artifact URL anywhere in the body, capturing the
  # parts needed to resolve the local file. Stops at whitespace or a closing
  # paren so a markdown `![alt](url)` only yields the URL.
  @artifact_re ~r{https?://[^\s)]+/api/tracker/v1/projects/(?<slug>[^/\s)]+)/issues/(?<identifier>[^/\s)]+)/evidence/(?<run_id>[^/\s)]+)/artifacts/(?<rel>[^\s)]+)}

  @type uploader :: (Path.t(), String.t(), String.t() -> {:ok, String.t()} | {:error, term()})

  @doc "True when the body contains at least one Symphony evidence artifact URL."
  @spec contains_artifacts?(String.t()) :: boolean()
  def contains_artifacts?(body) when is_binary(body), do: Regex.match?(@artifact_re, body)
  def contains_artifacts?(_body), do: false

  @doc """
  Replaces each Symphony artifact URL in `body` with the tracker-hosted URL
  returned by `uploader`. Used for markdown-rendering trackers (Linear). On any
  per-artifact failure the original URL is kept, so a partial upload never drops
  the comment.
  """
  @spec rewrite_markdown(String.t(), String.t(), uploader()) :: String.t()
  def rewrite_markdown(body, provider, uploader)
      when is_binary(body) and is_binary(provider) and is_function(uploader, 3) do
    Regex.replace(@artifact_re, body, fn whole, slug, identifier, run_id, rel ->
      case upload_cached(provider, %{slug: slug, identifier: identifier, run_id: run_id, rel: rel}, uploader) do
        {:ok, ref} -> ref
        {:error, _reason} -> whole
      end
    end)
  end

  @doc """
  Resolves an artifact URL's parts to a local file plus its content hash and MIME
  type. Returns `:error` when the artifact can't be located on disk.
  """
  @spec resolve(%{slug: String.t(), identifier: String.t(), run_id: String.t(), rel: String.t()}) ::
          {:ok, %{path: Path.t(), filename: String.t(), content_type: String.t(), sha256: String.t()}}
          | {:error, term()}
  def resolve(%{slug: slug, identifier: identifier, run_id: run_id, rel: rel}) do
    with {:ok, records} <- Store.list(slug, identifier),
         %{} = record <- Enum.find(records, &(&1.run_id == run_id)) || {:error, :run_not_found},
         {:ok, path} <- Store.resolve_artifact(record, rel) do
      {:ok,
       %{
         path: path,
         filename: Path.basename(path),
         content_type: MIME.from_path(path),
         sha256: sha256(path)
       }}
    else
      {:error, _reason} = error -> error
      _ -> {:error, :artifact_not_found}
    end
  end

  @doc "Uploads the resolved artifact (cache-first) and returns the tracker asset ref."
  @spec upload_cached(String.t(), map(), uploader()) :: {:ok, String.t()} | {:error, term()}
  def upload_cached(provider, parts, uploader) do
    with {:ok, file} <- resolve(parts) do
      case cached_ref(provider, file.sha256) do
        ref when is_binary(ref) -> {:ok, ref}
        nil -> upload_and_cache(provider, file, uploader)
      end
    end
  end

  defp upload_and_cache(provider, file, uploader) do
    case uploader.(file.path, file.filename, file.content_type) do
      {:ok, ref} when is_binary(ref) ->
        cache_ref(provider, file.sha256, ref, file.filename)
        {:ok, ref}

      {:error, reason} ->
        Logger.warning("Evidence artifact upload failed provider=#{provider} file=#{file.filename}: #{inspect(reason)}")
        {:error, reason}
    end
  end

  defp cached_ref(provider, sha256) do
    Repo.one(
      from(a in RemoteAsset,
        where: a.provider == ^provider and a.content_sha256 == ^sha256,
        select: a.asset_ref
      )
    )
  end

  defp cache_ref(provider, sha256, ref, filename) do
    %RemoteAsset{}
    |> RemoteAsset.changeset(%{provider: provider, content_sha256: sha256, asset_ref: ref, filename: filename})
    |> Repo.insert(on_conflict: :nothing, conflict_target: [:provider, :content_sha256])
  end

  defp sha256(path) do
    path
    |> File.stream!([], 2_048_000)
    |> Enum.reduce(:crypto.hash_init(:sha256), &:crypto.hash_update(&2, &1))
    |> :crypto.hash_final()
    |> Base.encode16(case: :lower)
  end
end
