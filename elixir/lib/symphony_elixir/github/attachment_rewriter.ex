defmodule SymphonyElixir.GitHub.AttachmentRewriter do
  @moduledoc """
  Rewrites Symphony-local attachment URLs in an outgoing GitHub issue/comment
  body into GitHub-hosted `raw` URLs so images and files actually render on
  GitHub — private repos included.

  Local attachment URLs (`/api/tracker/v1/projects/<slug>/assistant/attachments/<path>`)
  point at an authenticated localhost endpoint that GitHub's image proxy (Camo)
  cannot reach, so they show up broken. GitHub has no public API for issue
  attachments; the supported workaround for private repos is to commit the file
  into the repo via the Contents API and reference it as
  `https://github.com/<owner>/<repo>/raw/<branch>/<path>`, which renders for any
  viewer with repo access.

  Each referenced file is committed once (content-addressed by SHA-256) to a
  dedicated assets branch, so re-syncs and shared images never re-upload.

  Best-effort by design: a missing token, branch failure, or upload error leaves
  the original URL untouched so the issue/comment text still syncs.

  `restore/3` is the inverse, applied when reading remote bodies back during sync
  so the local store keeps local-first attachment URLs (the tracker renders those
  through its own authenticated endpoint) while GitHub keeps the raw URLs.

  Assets uploaded from another machine/project are not present in this project's
  local uploads, so `restore/3` cannot map them back. `proxy_remote_assets/2`
  rewrites those still-remote managed URLs to a bearer-authenticated tracker proxy
  path (`.../github/assets/<owner>/<repo>/<basename>`) so the SPA can render them
  without persisting anything locally; `download_asset/4` is the matching fetch the
  proxy controller uses to stream the bytes from GitHub with the configured token.
  """

  require Logger

  alias SymphonyElixir.Assistant.AttachmentStore
  alias SymphonyElixir.GitHub.{Client, Config}

  @assets_branch "symphony-assets"
  @assets_dir "assets"
  @api_prefix "/api/tracker/v1"
  @managed_marker "/raw/#{@assets_branch}/#{@assets_dir}/"
  @rest_endpoint "https://api.github.com"
  @request_timeout_ms 30_000
  @asset_basename_regex ~r/^[0-9a-fA-F]+\.[A-Za-z0-9]+$/

  @doc """
  Returns true when `body` references at least one Symphony-local attachment for
  `slug`. Lets callers skip repo resolution on the hot path when there is nothing
  to rewrite.
  """
  @spec contains_attachment?(term(), String.t()) :: boolean()
  def contains_attachment?(body, slug) when is_binary(body) and is_binary(slug) do
    Regex.match?(attachment_regex(slug), body)
  end

  def contains_attachment?(_body, _slug), do: false

  @doc """
  Rewrites every Symphony-local attachment URL for `slug` in `body` to a
  GitHub raw URL, uploading the underlying file to the assets branch when needed.

  Non-binary bodies and bodies without attachments are returned unchanged. Any
  per-file or branch failure degrades gracefully to the original URL.
  """
  @spec rewrite(term(), String.t(), String.t(), String.t(), keyword()) :: term()
  def rewrite(body, owner, name, slug, opts \\ [])

  def rewrite(body, owner, name, slug, opts)
      when is_binary(body) and is_binary(owner) and is_binary(name) and is_binary(slug) do
    regex = attachment_regex(slug)

    case unique_encoded_paths(regex, body) do
      [] -> body
      encoded_paths -> do_rewrite(body, regex, owner, name, slug, encoded_paths, opts)
    end
  end

  def rewrite(body, _owner, _name, _slug, _opts), do: body

  @doc """
  Returns true when `body` references a Symphony-managed GitHub asset URL
  (`.../raw/<assets_branch>/<assets_dir>/...`). Used to skip the (filesystem)
  index build on the read hot path when there is nothing to restore.
  """
  @spec has_managed_asset?(term()) :: boolean()
  def has_managed_asset?(body) when is_binary(body), do: String.contains?(body, @managed_marker)
  def has_managed_asset?(_body), do: false

  @doc """
  Inverse of `rewrite/5`: maps Symphony-managed GitHub raw URLs in `body` back to
  the project-local attachment URL, so the local store keeps local-first URLs and
  the tracker keeps rendering attachments through its authenticated endpoint.

  Assets are matched by content hash against the project's local uploads. Unknown
  assets (e.g. uploaded from another machine) are left untouched. Pass a prebuilt
  `:index` (see `build_index/1`) to avoid rescanning when restoring many bodies.
  """
  @spec restore(term(), String.t(), keyword()) :: term()
  def restore(body, slug, opts \\ [])

  def restore(body, slug, opts) when is_binary(body) and is_binary(slug) do
    if has_managed_asset?(body) do
      index = Keyword.get(opts, :index) || build_index(slug)
      Regex.replace(restore_regex(), body, &replace_managed_asset(&1, &2, index, slug))
    else
      body
    end
  end

  def restore(body, _slug, _opts), do: body

  @doc """
  Rewrites Symphony-managed GitHub raw asset URLs that remain in `body` (i.e. that
  `restore/3` could not map to a local upload) into the project-scoped tracker
  proxy path. Nothing is persisted: the proxy streams the bytes on demand.

  Non-binary bodies and bodies without a managed asset are returned unchanged.
  """
  @spec proxy_remote_assets(term(), String.t()) :: term()
  def proxy_remote_assets(body, slug) when is_binary(body) and is_binary(slug) do
    if has_managed_asset?(body) do
      Regex.replace(proxy_regex(), body, fn _full, owner, repo, basename ->
        github_asset_proxy_url(slug, owner, repo, basename)
      end)
    else
      body
    end
  end

  def proxy_remote_assets(body, _slug), do: body

  @doc """
  Downloads the bytes of a Symphony-managed asset (`<owner>/<repo>/assets/<basename>`
  on the assets branch) through the GitHub Contents API, authenticated with the
  configured token. Returns `{:ok, %{content_type, body}}` for the proxy controller.

  `basename` must be the content-addressed `<sha>.<ext>` form; anything else is
  rejected with `{:error, :invalid_asset}` so the proxy cannot fetch arbitrary repo
  paths. HTTP can be injected via the `:download_fun` option (or the
  `:github_asset_download_fun` application env) and the token via `:token` for tests.
  """
  @spec download_asset(String.t(), String.t(), String.t(), keyword()) ::
          {:ok, %{content_type: String.t(), body: binary()}} | {:error, term()}
  def download_asset(owner, repo, basename, opts \\ [])

  def download_asset(owner, repo, basename, opts)
      when is_binary(owner) and is_binary(repo) and is_binary(basename) and is_list(opts) do
    if valid_asset_basename?(basename) do
      do_download_asset(owner, repo, basename, opts)
    else
      {:error, :invalid_asset}
    end
  end

  def download_asset(_owner, _repo, _basename, _opts), do: {:error, :invalid_asset}

  defp replace_managed_asset(full, basename, index, slug) do
    case Map.get(index, basename) do
      relative when is_binary(relative) -> local_attachment_url(slug, relative)
      _ -> full
    end
  end

  @doc """
  Builds a content-addressed index (`"<sha256>.<ext>" => "uploads/<id>.<ext>"`)
  of the project's local uploads, used to reverse Symphony-managed asset URLs.
  """
  @spec build_index(String.t()) :: %{optional(String.t()) => String.t()}
  def build_index(slug) when is_binary(slug) do
    case AttachmentStore.list_uploads(slug) do
      {:ok, uploads} -> Enum.reduce(uploads, %{}, &index_upload/2)
      _ -> %{}
    end
  end

  defp index_upload({relative, absolute}, acc) do
    case File.read(absolute) do
      {:ok, bytes} -> Map.put(acc, asset_basename(relative, bytes), relative)
      _ -> acc
    end
  end

  defp do_rewrite(body, regex, owner, name, slug, encoded_paths, opts) do
    client = resolve_client(opts)

    case ensure_branch(client, owner, name) do
      :ok ->
        mapping = build_mapping(client, owner, name, slug, encoded_paths)
        Regex.replace(regex, body, fn full, encoded -> Map.get(mapping, encoded, full) end)

      {:error, reason} ->
        Logger.warning(
          "GitHub assets branch unavailable for #{owner}/#{name} (#{inspect(reason)}); " <>
            "leaving attachment URLs unchanged"
        )

        body
    end
  end

  defp build_mapping(client, owner, name, slug, encoded_paths) do
    Enum.reduce(encoded_paths, %{}, fn encoded, acc ->
      case upload_attachment(client, owner, name, slug, encoded) do
        {:ok, raw_url} ->
          Map.put(acc, encoded, raw_url)

        {:error, reason} ->
          Logger.warning("GitHub attachment upload skipped for #{encoded}: #{inspect(reason)}")
          acc
      end
    end)
  end

  defp upload_attachment(client, owner, name, slug, encoded_path) do
    relative_path = URI.decode(encoded_path)

    with {:ok, absolute} <- AttachmentStore.resolve_path(slug, relative_path),
         {:ok, bytes} <- File.read(absolute) do
      asset_path = asset_path(relative_path, bytes)

      case ensure_asset(client, owner, name, asset_path, bytes) do
        :ok -> {:ok, raw_url(owner, name, asset_path)}
        {:error, _} = error -> error
      end
    end
  end

  defp asset_path(relative_path, bytes), do: "#{@assets_dir}/#{asset_basename(relative_path, bytes)}"

  defp asset_basename(relative_path, bytes) do
    extension = relative_path |> Path.extname() |> String.downcase()
    digest = :crypto.hash(:sha256, bytes) |> Base.encode16(case: :lower)
    "#{digest}#{extension}"
  end

  defp ensure_asset(client, owner, name, asset_path, bytes) do
    if asset_exists?(client, owner, name, asset_path) do
      :ok
    else
      put_asset(client, owner, name, asset_path, bytes)
    end
  end

  defp asset_exists?(client, owner, name, asset_path) do
    path = "/repos/#{owner}/#{name}/contents/#{uri_path(asset_path)}?ref=#{@assets_branch}"

    case client.rest_get(path) do
      {:ok, %{status: status}} when status in 200..299 -> true
      _ -> false
    end
  end

  defp put_asset(client, owner, name, asset_path, bytes) do
    body = %{
      "message" => "chore(symphony): add issue attachment #{Path.basename(asset_path)}",
      "content" => Base.encode64(bytes),
      "branch" => @assets_branch
    }

    case client.rest_put("/repos/#{owner}/#{name}/contents/#{uri_path(asset_path)}", body) do
      {:ok, _response} -> :ok
      {:error, _} = error -> error
    end
  end

  defp ensure_branch(client, owner, name) do
    case client.rest_get("/repos/#{owner}/#{name}/git/ref/heads/#{@assets_branch}") do
      {:ok, %{status: status}} when status in 200..299 -> :ok
      _ -> create_branch(client, owner, name)
    end
  end

  defp create_branch(client, owner, name) do
    with {:ok, base_sha} <- default_branch_sha(client, owner, name),
         {:ok, _response} <-
           client.rest_post("/repos/#{owner}/#{name}/git/refs", %{
             "ref" => "refs/heads/#{@assets_branch}",
             "sha" => base_sha
           }) do
      :ok
    end
  end

  defp default_branch_sha(client, owner, name) do
    with {:ok, %{body: repo}} <- client.rest_get("/repos/#{owner}/#{name}"),
         branch when is_binary(branch) <- repo_default_branch(repo),
         {:ok, %{body: ref}} <- client.rest_get("/repos/#{owner}/#{name}/git/ref/heads/#{branch}"),
         sha when is_binary(sha) <- ref_sha(ref) do
      {:ok, sha}
    else
      {:error, _} = error -> error
      _ -> {:error, :default_branch_unresolved}
    end
  end

  defp repo_default_branch(%{"default_branch" => branch}) when is_binary(branch) and branch != "",
    do: branch

  defp repo_default_branch(_repo), do: nil

  defp ref_sha(%{"object" => %{"sha" => sha}}) when is_binary(sha) and sha != "", do: sha
  defp ref_sha(_ref), do: nil

  defp raw_url(owner, name, asset_path) do
    "https://github.com/#{owner}/#{name}/raw/#{@assets_branch}/#{uri_path(asset_path)}"
  end

  defp unique_encoded_paths(regex, body) do
    regex
    |> Regex.scan(body, capture: :all_but_first)
    |> List.flatten()
    |> Enum.uniq()
  end

  defp attachment_regex(slug) do
    Regex.compile!(
      "(?:https?://[^/\\s]+)?" <>
        Regex.escape("#{@api_prefix}/projects/#{slug}/assistant/attachments/") <>
        "([^\\s)\\]\"'>]+)"
    )
  end

  defp restore_regex do
    Regex.compile!(
      "https://github\\.com/[^/\\s]+/[^/\\s]+/raw/" <>
        Regex.escape(@assets_branch) <>
        "/" <>
        Regex.escape(@assets_dir) <>
        "/([0-9a-fA-F]+\\.[A-Za-z0-9]+)"
    )
  end

  defp local_attachment_url(slug, relative_path) do
    encoded_slug = URI.encode(slug, &URI.char_unreserved?/1)
    "#{@api_prefix}/projects/#{encoded_slug}/assistant/attachments/#{uri_path(relative_path)}"
  end

  defp resolve_client(opts) do
    Keyword.get(opts, :client) || Application.get_env(:symphony_elixir, :github_rest_client, Client)
  end

  defp proxy_regex do
    Regex.compile!(
      "https://github\\.com/([^/\\s]+)/([^/\\s]+)/raw/" <>
        Regex.escape(@assets_branch) <>
        "/" <>
        Regex.escape(@assets_dir) <>
        "/([0-9a-fA-F]+\\.[A-Za-z0-9]+)"
    )
  end

  defp github_asset_proxy_url(slug, owner, repo, basename) do
    "#{@api_prefix}/projects/#{encode_segment(slug)}/github/assets/" <>
      "#{encode_segment(owner)}/#{encode_segment(repo)}/#{encode_segment(basename)}"
  end

  defp do_download_asset(owner, repo, basename, opts) do
    case asset_token(opts) do
      token when is_binary(token) and token != "" ->
        request_fun = resolve_download_fun(opts)
        url = asset_api_url(owner, repo, basename)
        headers = asset_request_headers(token)

        case request_fun.(url, headers) do
          {:ok, %{status: status, body: body}} when status in 200..299 and is_binary(body) ->
            {:ok, %{content_type: asset_content_type(basename), body: body}}

          {:ok, %{status: status}} ->
            Logger.warning("GitHub asset download failed status=#{status} #{owner}/#{repo}/#{basename}")
            {:error, {:github_api_status, status}}

          {:error, reason} ->
            Logger.warning("GitHub asset download failed #{owner}/#{repo}/#{basename}: #{inspect(reason)}")
            {:error, {:github_api_request, reason}}
        end

      _ ->
        {:error, :missing_github_token}
    end
  end

  defp asset_token(opts) do
    case Keyword.get(opts, :token) do
      token when is_binary(token) and token != "" -> token
      _ -> Config.token()
    end
  end

  defp resolve_download_fun(opts) do
    Keyword.get(opts, :download_fun) ||
      Application.get_env(:symphony_elixir, :github_asset_download_fun) ||
      (&default_asset_download/2)
  end

  defp default_asset_download(url, headers) do
    case Req.request(
           method: :get,
           url: url,
           headers: headers,
           decode_body: false,
           redirect: true,
           connect_options: [timeout: @request_timeout_ms]
         ) do
      {:ok, %Req.Response{status: status, body: body}} ->
        {:ok, %{status: status, body: body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp asset_api_url(owner, repo, basename) do
    "#{@rest_endpoint}/repos/#{encode_segment(owner)}/#{encode_segment(repo)}/" <>
      "contents/#{@assets_dir}/#{encode_segment(basename)}?ref=#{@assets_branch}"
  end

  defp asset_request_headers(token) do
    [
      {"Authorization", "Bearer #{token}"},
      {"Accept", "application/vnd.github.raw"},
      {"X-GitHub-Api-Version", "2022-11-28"}
    ]
  end

  defp asset_content_type(basename), do: AttachmentStore.content_type(basename)

  defp valid_asset_basename?(basename) when is_binary(basename),
    do: Regex.match?(@asset_basename_regex, basename)

  defp valid_asset_basename?(_basename), do: false

  defp encode_segment(value) when is_binary(value),
    do: URI.encode(value, &URI.char_unreserved?/1)

  defp uri_path(path) do
    path
    |> String.split("/", trim: true)
    |> Enum.map_join("/", fn segment -> URI.encode(segment, &URI.char_unreserved?/1) end)
  end
end
