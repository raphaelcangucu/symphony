defmodule SymphonyElixir.MobileRpc.MobileFileService do
  @moduledoc """
  Presents Symphony worktrees through the production Orca mobile file DTOs.

  The selected assistant thread remains the source of the worktree root. All
  relative paths are canonicalized below that root, while temporary terminal
  artifacts require a short-lived device-scoped grant tied to terminal output.
  """

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Terminal.Registry

  @state_table :symphony_mobile_rpc_orca_file_state
  @file_list_limit 5_000
  @file_read_max_bytes 512 * 1024
  @preview_max_bytes 10 * 1024 * 1024
  @clipboard_max_base64_chars 24 * 1024 * 1024
  @clipboard_chunk_max_base64_chars 512 * 1024
  @clipboard_max_concurrent 8
  @grant_ttl_ms 5 * 60 * 1_000
  @upload_ttl_ms 5 * 60 * 1_000
  @binary_extensions MapSet.new(~w(.7z .avi .bin .bmp .class .dmg .doc .docx .exe .gif .gz .ico .jar .jpeg .jpg .mov .mp3 .mp4 .o .pdf .png .so .tar .webp .woff .woff2 .xls .xlsx .zip))
  @preview_mime_types %{
    ".png" => "image/png",
    ".jpg" => "image/jpeg",
    ".jpeg" => "image/jpeg",
    ".gif" => "image/gif",
    ".svg" => "image/svg+xml",
    ".webp" => "image/webp",
    ".bmp" => "image/bmp",
    ".ico" => "image/x-icon",
    ".pdf" => "application/pdf"
  }

  @spec call(String.t(), map(), map()) :: {:ok, term()} | {:error, term()}
  def call("files.list", %{"worktree" => selector}, context) do
    with {:ok, thread, root} <- resolve_workspace(selector, context),
         {:ok, files, total_count} <- list_worktree_files(root) do
      visible = Enum.take(files, @file_list_limit)

      {:ok,
       %{
         "worktree" => to_string(thread.id),
         "rootPath" => root,
         "files" => Enum.map(visible, &present_file/1),
         "totalCount" => total_count,
         "truncated" => total_count > length(visible)
       }}
    end
  end

  def call(
        "files.readDir",
        %{"worktree" => selector, "relativePath" => relative_path},
        context
      )
      when is_binary(relative_path) do
    with {:ok, _thread, root} <- resolve_workspace(selector, context),
         {:ok, path} <- resolve_inside(root, relative_path, allow_root: true),
         {:ok, entries} <- File.ls(path) do
      entries =
        entries
        |> Enum.map(&present_dir_entry(path, &1))
        |> Enum.sort_by(fn entry ->
          {if(entry["isDirectory"], do: 0, else: 1), String.downcase(entry["name"])}
        end)

      {:ok, entries}
    else
      {:error, reason} -> file_error(reason)
    end
  end

  def call(
        "files.read",
        %{"worktree" => selector, "relativePath" => relative_path},
        context
      ) do
    with {:ok, thread, root} <- resolve_workspace(selector, context),
         {:ok, path} <- resolve_inside(root, relative_path),
         :ok <- ensure_text_path(path),
         {:ok, stat} <- File.stat(path),
         :ok <- ensure_regular_file(stat),
         :ok <- ensure_size(stat.size, @file_read_max_bytes),
         {:ok, content} <- File.read(path),
         false <- binary_content?(content) do
      {:ok,
       %{
         "worktree" => to_string(thread.id),
         "relativePath" => normalize_relative(relative_path),
         "content" => content,
         "truncated" => false,
         "byteLength" => stat.size
       }}
    else
      true -> rpc_error("binary_file", "binary_file")
      {:error, reason} -> file_error(reason)
    end
  end

  def call(
        "files.readPreview",
        %{"worktree" => selector, "relativePath" => relative_path},
        context
      ) do
    with {:ok, _thread, root} <- resolve_workspace(selector, context),
         {:ok, path} <- resolve_inside(root, relative_path),
         {:ok, stat} <- File.stat(path),
         :ok <- ensure_regular_file(stat) do
      preview_file(path, stat)
    else
      {:error, reason} -> file_error(reason)
    end
  end

  def call("files.open", %{"worktree" => selector, "relativePath" => relative_path}, context) do
    with {:ok, thread, root} <- resolve_workspace(selector, context),
         {:ok, path} <- resolve_inside(root, relative_path),
         {:ok, stat} <- File.stat(path),
         :ok <- ensure_regular_file(stat) do
      {:ok, present_open(thread, relative_path, false)}
    else
      {:error, reason} -> file_error(reason)
    end
  end

  def call(
        "files.openDiff",
        %{"worktree" => selector, "relativePath" => relative_path} = params,
        context
      ) do
    with {:ok, thread, root} <- resolve_workspace(selector, context),
         {:ok, path} <- resolve_inside(root, relative_path),
         {:ok, stat} <- File.stat(path),
         :ok <- ensure_regular_file(stat) do
      {:ok,
       present_open(thread, relative_path, true)
       |> Map.put("staged", Map.get(params, "staged", false) == true)}
    else
      {:error, reason} -> file_error(reason)
    end
  end

  def call(
        "files.resolveTerminalPath",
        %{"worktree" => selector, "pathText" => path_text} = params,
        context
      )
      when is_binary(path_text) and path_text != "" do
    with {:ok, thread, root} <- resolve_workspace(selector, context) do
      resolve_terminal_path(thread, root, path_text, params, context)
    end
  end

  def call(
        method,
        %{"worktree" => selector, "grantId" => grant_id, "absolutePath" => path},
        context
      )
      when method in ["files.readTerminalArtifact", "files.readTerminalArtifactPreview"] do
    with {:ok, thread, _root} <- resolve_workspace(selector, context),
         {:ok, grant, stat} <- validate_grant(context, thread, grant_id, path) do
      if method == "files.readTerminalArtifactPreview" do
        preview_file(grant.path, stat)
      else
        read_terminal_artifact(grant.path, stat, thread)
      end
    else
      {:error, reason} -> file_error(reason)
    end
  end

  def call(
        "files.writeTerminalArtifact",
        %{
          "worktree" => selector,
          "grantId" => grant_id,
          "absolutePath" => path,
          "content" => content
        },
        context
      )
      when is_binary(content) do
    with :ok <- ensure_size(byte_size(content), @file_read_max_bytes),
         {:ok, thread, _root} <- resolve_workspace(selector, context),
         {:ok, grant, _stat} <- validate_grant(context, thread, grant_id, path),
         :ok <- File.write(grant.path, content),
         {:ok, updated_stat} <- File.stat(grant.path) do
      put_state(grant_key(context, grant_id), %{grant | identity: stat_identity(updated_stat)})
      {:ok, %{"written" => true, "byteLength" => byte_size(content)}}
    else
      {:error, reason} -> file_error(reason)
    end
  end

  def call("clipboard.startImageUpload", params, context) do
    expected = Map.get(params, "expectedBase64Length")

    cond do
      not is_integer(expected) or expected < 0 ->
        {:error, :invalid_params}

      expected > @clipboard_max_base64_chars ->
        rpc_error("image_too_large", "Clipboard image is too large")

      concurrent_uploads(context) >= @clipboard_max_concurrent ->
        rpc_error("too_many_uploads", "Too many clipboard image uploads are in progress")

      true ->
        upload_id = random_id("upload")

        upload = %{
          expected: expected,
          received: 0,
          chunks: [],
          expires_at: now_ms() + @upload_ttl_ms,
          connection_id: Map.get(params, "connectionId")
        }

        put_state(upload_key(context, upload_id), upload)
        {:ok, %{"uploadId" => upload_id}}
    end
  end

  def call(
        "clipboard.appendImageUploadChunk",
        %{"uploadId" => upload_id, "offset" => offset, "contentBase64" => chunk},
        context
      )
      when is_binary(upload_id) and is_integer(offset) and is_binary(chunk) do
    with :ok <- validate_base64(chunk, @clipboard_chunk_max_base64_chars, "image_chunk_too_large"),
         {:ok, upload} <- fetch_upload(context, upload_id),
         true <- offset == upload.received,
         next = upload.received + byte_size(chunk),
         true <- next <= upload.expected do
      put_state(
        upload_key(context, upload_id),
        %{upload | received: next, chunks: [chunk | upload.chunks], expires_at: now_ms() + @upload_ttl_ms}
      )

      {:ok, %{"receivedBase64Length" => next}}
    else
      false -> rpc_error("invalid_upload_offset", "Clipboard image chunk offset is out of order")
      {:error, reason} -> file_error(reason)
    end
  end

  def call("clipboard.commitImageUpload", %{"uploadId" => upload_id}, context) do
    key = upload_key(context, upload_id)

    result =
      with {:ok, upload} <- fetch_upload(context, upload_id),
           true <- upload.received == upload.expected,
           content_base64 = upload.chunks |> Enum.reverse() |> IO.iodata_to_binary(),
           :ok <- validate_base64(content_base64, @clipboard_max_base64_chars, "image_too_large"),
           {:ok, content} <- Base.decode64(content_base64),
           {:ok, path} <- save_clipboard_image(content, context) do
        {:ok, path}
      else
        false -> rpc_error("incomplete_upload", "Clipboard image upload is incomplete")
        :error -> rpc_error("invalid_base64", "Clipboard image content must be base64")
        {:error, reason} -> file_error(reason)
      end

    delete_state(key)
    result
  end

  def call("clipboard.abortImageUpload", %{"uploadId" => upload_id}, context) do
    delete_state(upload_key(context, upload_id))
    {:ok, %{"aborted" => true}}
  end

  def call(
        "clipboard.saveImageAsTempFile",
        %{"contentBase64" => content_base64},
        context
      )
      when is_binary(content_base64) do
    with :ok <- validate_base64(content_base64, @clipboard_max_base64_chars, "image_too_large"),
         {:ok, content} <- Base.decode64(content_base64),
         {:ok, path} <- save_clipboard_image(content, context) do
      {:ok, path}
    else
      :error -> rpc_error("invalid_base64", "Clipboard image content must be base64")
      {:error, reason} -> file_error(reason)
    end
  end

  def call("browser." <> _action = method, params, context) do
    case Map.get(context, :orca_browser_adapter) do
      nil -> capability_unavailable("Browser controls")
      adapter -> adapter.call(method, params, context)
    end
  end

  def call(_method, _params, _context), do: {:error, :unsupported_orca_file_method}

  @spec subscribe(String.t(), map(), map()) :: {:ok, term()} | {:error, term()}
  def subscribe("browser.screencast" = method, params, context) do
    case Map.get(context, :orca_browser_adapter) do
      nil -> capability_unavailable("Browser screencast")
      adapter -> adapter.subscribe(method, params, context)
    end
  end

  def subscribe(_method, _params, _context), do: {:error, :unsupported_subscription}

  defp list_worktree_files(root) do
    case collect_files(root, root, [], @file_list_limit + 1) do
      {:ok, files} ->
        sorted = Enum.sort(files)
        {:ok, sorted, length(sorted)}

      error ->
        error
    end
  end

  defp collect_files(_root, _path, files, limit) when length(files) >= limit,
    do: {:ok, files}

  defp collect_files(root, path, files, limit) do
    with {:ok, names} <- File.ls(path) do
      names
      |> Enum.reject(&(&1 in [".git", "node_modules"]))
      |> Enum.sort()
      |> Enum.reduce_while({:ok, files}, fn name, {:ok, acc} ->
        if length(acc) >= limit do
          {:halt, {:ok, acc}}
        else
          full = Path.join(path, name)

          case File.lstat(full) do
            {:ok, %{type: :directory}} ->
              case collect_files(root, full, acc, limit) do
                {:ok, nested} -> {:cont, {:ok, nested}}
                error -> {:halt, error}
              end

            {:ok, %{type: :regular}} ->
              {:cont, {:ok, [Path.relative_to(full, root) | acc]}}

            {:ok, _other} ->
              {:cont, {:ok, acc}}

            {:error, reason} ->
              {:halt, {:error, reason}}
          end
        end
      end)
    end
  end

  defp present_file(relative_path) do
    %{
      "relativePath" => relative_path,
      "basename" => Path.basename(relative_path),
      "kind" => if(binary_path?(relative_path), do: "binary", else: "text")
    }
  end

  defp present_dir_entry(parent, name) do
    path = Path.join(parent, name)
    symlink? = match?({:ok, %{type: :symlink}}, File.lstat(path))

    %{
      "name" => name,
      "isDirectory" => File.dir?(path),
      "isSymlink" => symlink?
    }
  end

  defp present_open(thread, relative_path, diff?) do
    path = normalize_relative(relative_path)

    %{
      "worktree" => to_string(thread.id),
      "relativePath" => path,
      "kind" => file_kind(path),
      "opened" => true,
      "diff" => diff?
    }
  end

  defp preview_file(path, stat) do
    extension = path |> Path.extname() |> String.downcase()

    case Map.get(@preview_mime_types, extension) do
      nil ->
        with :ok <- ensure_size(stat.size, @file_read_max_bytes),
             {:ok, content} <- File.read(path) do
          if binary_content?(content),
            do: {:ok, %{"content" => "", "isBinary" => true}},
            else: {:ok, %{"content" => content, "isBinary" => false}}
        end

      mime_type ->
        with :ok <- ensure_size(stat.size, @preview_max_bytes),
             {:ok, content} <- File.read(path) do
          {:ok,
           %{
             "content" => Base.encode64(content),
             "isBinary" => true,
             "isImage" => mime_type != "application/pdf",
             "mimeType" => mime_type
           }}
        end
    end
  end

  defp read_terminal_artifact(path, stat, thread) do
    with :ok <- ensure_size(stat.size, @file_read_max_bytes),
         {:ok, content} <- File.read(path),
         false <- binary_content?(content) do
      {:ok,
       %{
         "worktree" => to_string(thread.id),
         "absolutePath" => path,
         "content" => content,
         "truncated" => false,
         "byteLength" => stat.size
       }}
    else
      true -> rpc_error("binary_file", "binary_file")
      {:error, reason} -> file_error(reason)
    end
  end

  defp resolve_terminal_path(thread, root, path_text, params, context) do
    base = terminal_base(root, Map.get(params, "cwd"))
    expanded = Path.expand(path_text, base)

    case relative_inside(root, expanded) do
      {:ok, relative} ->
        case canonical_existing(expanded) do
          {:ok, canonical} ->
            case relative_inside(root, canonical) do
              {:ok, _canonical_relative} ->
                present_resolved_worktree_path(thread, root, relative)

              :outside ->
                maybe_grant_terminal_artifact(
                  thread,
                  root,
                  canonical,
                  path_text,
                  Map.get(params, "terminal"),
                  context
                )
            end

          {:error, :enoent} ->
            {:ok, empty_resolution(thread, relative, expanded)}

          {:error, reason} ->
            file_error(reason)
        end

      :outside ->
        maybe_grant_terminal_artifact(
          thread,
          root,
          expanded,
          path_text,
          Map.get(params, "terminal"),
          context
        )
    end
  end

  defp present_resolved_worktree_path(thread, root, relative) do
    absolute = Path.join(root, relative)

    case File.stat(absolute) do
      {:ok, stat} ->
        is_directory = stat.type == :directory

        {:ok,
         %{
           "worktree" => to_string(thread.id),
           "relativePath" => relative,
           "absolutePath" => absolute,
           "exists" => true,
           "isDirectory" => is_directory,
           "openTarget" =>
             if(is_directory,
               do: nil,
               else: %{
                 "kind" => "worktree-file",
                 "provider" => "local",
                 "relativePath" => relative,
                 "absolutePath" => absolute
               }
             )
         }}

      {:error, :enoent} ->
        {:ok, empty_resolution(thread, relative, absolute)}

      {:error, reason} ->
        file_error(reason)
    end
  end

  defp maybe_grant_terminal_artifact(thread, root, expanded, path_text, terminal, context) do
    with true <- is_binary(terminal) and terminal != "",
         {:ok, canonical} <- canonical_existing(expanded),
         true <- temporary_path?(canonical),
         {:ok, stat} <- File.stat(canonical),
         :ok <- ensure_regular_file(stat),
         true <- Map.get(stat, :links, 1) <= 1,
         {:ok, output} <- terminal_output(context, terminal, thread),
         true <- String.contains?(output, path_text) or String.contains?(output, canonical) do
      grant_id = random_id("grant")

      grant = %{
        path: canonical,
        worktree_id: thread.id,
        root: root,
        identity: stat_identity(stat),
        expires_at: now_ms() + @grant_ttl_ms
      }

      put_state(grant_key(context, grant_id), grant)

      {:ok,
       %{
         "worktree" => to_string(thread.id),
         "relativePath" => nil,
         "absolutePath" => canonical,
         "exists" => true,
         "isDirectory" => false,
         "openTarget" => %{
           "kind" => "absolute-file",
           "provider" => "local",
           "absolutePath" => canonical,
           "grantId" => grant_id
         }
       }}
    else
      _denied -> {:ok, empty_resolution(thread, nil, expanded)}
    end
  end

  defp empty_resolution(thread, relative, absolute) do
    %{
      "worktree" => to_string(thread.id),
      "relativePath" => relative,
      "absolutePath" => absolute,
      "exists" => false,
      "isDirectory" => false,
      "openTarget" => nil
    }
  end

  defp validate_grant(context, thread, grant_id, requested_path) do
    with {:ok, grant} <- fetch_state(grant_key(context, grant_id)),
         true <- grant.expires_at > now_ms(),
         true <- grant.worktree_id == thread.id,
         {:ok, canonical} <- canonical_existing(requested_path),
         true <- canonical == grant.path,
         {:ok, stat} <- File.stat(canonical),
         true <- stat_identity(stat) == grant.identity do
      {:ok, grant, stat}
    else
      _invalid -> {:error, :terminal_file_grant_stale}
    end
  end

  defp terminal_base(root, cwd) when is_binary(cwd) and cwd != "" do
    expanded = if Path.type(cwd) == :absolute, do: Path.expand(cwd), else: Path.expand(cwd, root)

    case relative_inside(root, expanded) do
      {:ok, _relative} -> expanded
      :outside -> root
    end
  end

  defp terminal_base(root, _cwd), do: root

  defp terminal_output(context, terminal, thread) do
    case Map.get(context, :orca_terminal_output) do
      function when is_function(function, 1) ->
        function.(terminal)

      _absent ->
        registry_terminal_output(terminal, thread)
    end
  end

  defp registry_terminal_output("thread:" <> raw_id, %{id: id} = thread) do
    if raw_id == to_string(id),
      do: Registry.capture_workspace(thread.project_slug, thread.workspace_path),
      else: {:error, :invalid_terminal}
  end

  defp registry_terminal_output("tab:" <> rest, thread) do
    case String.split(rest, ":", parts: 3) do
      [_thread_id, _encoded_project, tab_id] when tab_id != "" ->
        Registry.capture_tab(thread.project_slug, tab_id)

      _invalid ->
        {:error, :invalid_terminal}
    end
  end

  defp registry_terminal_output(_terminal, _thread), do: {:error, :invalid_terminal}

  defp resolve_workspace(selector, context) do
    result =
      case Map.get(context, :orca_workspace_resolver) do
        resolver when is_function(resolver, 1) -> resolver.(selector)
        _absent -> resolve_workspace_from_history(selector)
      end

    with {:ok, thread} <- result,
         root when is_binary(root) and root != "" <- Map.get(thread, :workspace_path),
         {:ok, canonical_root} <- canonical_existing(root),
         true <- File.dir?(canonical_root) do
      {:ok, thread, canonical_root}
    else
      _error -> rpc_error("not_found", "Symphony worktree was not found")
    end
  end

  defp resolve_workspace_from_history(selector) do
    raw = selector |> to_string() |> String.replace_prefix("id:", "")

    with {id, ""} when id > 0 <- Integer.parse(raw),
         {:ok, thread} <- History.get_thread(id) do
      {:ok, thread}
    else
      _error -> {:error, :not_found}
    end
  end

  defp resolve_inside(root, relative_path, opts \\ []) do
    allow_root = Keyword.get(opts, :allow_root, false)

    with {:ok, normalized} <- validate_relative(relative_path, allow_root),
         expanded = Path.expand(normalized, root),
         {:ok, _relative} <- inside_result(root, expanded),
         {:ok, canonical} <- canonical_existing(expanded),
         {:ok, _canonical_relative} <- inside_result(root, canonical) do
      {:ok, canonical}
    end
  end

  defp validate_relative(relative_path, allow_root) when is_binary(relative_path) do
    normalized = normalize_relative(relative_path)

    cond do
      Path.type(relative_path) == :absolute -> {:error, :invalid_relative_path}
      normalized == "" and allow_root -> {:ok, "."}
      normalized == "" -> {:error, :invalid_relative_path}
      Enum.any?(Path.split(normalized), &(&1 in [".", ".."])) -> {:error, :invalid_relative_path}
      true -> {:ok, normalized}
    end
  end

  defp validate_relative(_relative_path, _allow_root), do: {:error, :invalid_relative_path}

  defp relative_inside(root, absolute_path) do
    case inside_result(root, Path.expand(absolute_path)) do
      {:ok, relative} when relative != "." -> {:ok, relative}
      {:ok, "."} -> {:ok, ""}
      {:error, _reason} -> :outside
    end
  end

  defp inside_result(root, path) do
    relative = Path.relative_to(path, root)

    if relative == "." or
         (Path.type(relative) == :relative and
            not Enum.any?(Path.split(relative), &(&1 == ".."))) do
      {:ok, relative}
    else
      {:error, :invalid_relative_path}
    end
  end

  defp canonical_existing(path), do: canonical_existing(path, 0)

  defp canonical_existing(_path, depth) when depth > 40, do: {:error, :eloop}

  defp canonical_existing(path, depth) do
    expanded = Path.expand(path)

    case Path.split(expanded) do
      [root | segments] -> canonical_segments(root, segments, depth)
      [] -> {:error, :enoent}
    end
  end

  defp canonical_segments(current, [], _depth), do: {:ok, Path.expand(current)}

  defp canonical_segments(current, [segment | rest], depth) do
    candidate = Path.join(current, segment)

    case File.lstat(candidate) do
      {:ok, %File.Stat{type: :symlink}} ->
        with {:ok, target} <- File.read_link(candidate) do
          resolved =
            if Path.type(target) == :absolute,
              do: target,
              else: Path.expand(target, Path.dirname(candidate))

          remaining = Enum.reduce(rest, resolved, &Path.join(&2, &1))
          canonical_existing(remaining, depth + 1)
        end

      {:ok, _stat} ->
        canonical_segments(candidate, rest, depth)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp ensure_text_path(path) do
    if binary_path?(path), do: {:error, :binary_file}, else: :ok
  end

  defp ensure_regular_file(%File.Stat{type: :regular}), do: :ok
  defp ensure_regular_file(_stat), do: {:error, :not_a_file}

  defp ensure_size(size, limit) when is_integer(size) and size <= limit, do: :ok
  defp ensure_size(_size, _limit), do: {:error, :file_too_large}

  defp binary_path?(path), do: MapSet.member?(@binary_extensions, String.downcase(Path.extname(path)))

  defp binary_content?(content) when is_binary(content), do: :binary.match(content, <<0>>) != :nomatch

  defp file_kind(path) do
    cond do
      binary_path?(path) and Map.has_key?(@preview_mime_types, String.downcase(Path.extname(path))) ->
        "image"

      binary_path?(path) ->
        "binary"

      String.downcase(Path.extname(path)) in [".md", ".mdx", ".markdown"] ->
        "markdown"

      true ->
        "text"
    end
  end

  defp normalize_relative(path), do: path |> String.replace("\\", "/") |> String.trim_leading("/")

  defp temporary_path?(path) do
    roots =
      [System.tmp_dir!(), "/private/tmp"]
      |> Enum.map(&Path.expand/1)
      |> Enum.uniq()

    Enum.any?(roots, fn root -> match?({:ok, _relative}, inside_result(root, path)) end)
  end

  defp stat_identity(stat) do
    {
      Map.get(stat, :major_device),
      Map.get(stat, :minor_device),
      Map.get(stat, :inode),
      stat.size,
      stat.mtime
    }
  end

  defp save_clipboard_image(content, context) do
    directory =
      Map.get(
        context,
        :orca_clipboard_dir,
        Path.join(System.tmp_dir!(), "dev10x-mobile-clipboard")
      )

    with :ok <- File.mkdir_p(directory) do
      path = Path.join(directory, "#{random_id("clipboard")}.png")

      case File.write(path, content, [:binary, :exclusive]) do
        :ok -> {:ok, path}
        {:error, :eexist} -> save_clipboard_image(content, context)
        error -> error
      end
    end
  end

  defp validate_base64(value, limit, too_large_code) when is_binary(value) do
    cond do
      byte_size(value) > limit ->
        rpc_error(too_large_code, "Clipboard image is too large")

      rem(byte_size(value), 4) == 1 ->
        rpc_error("invalid_base64", "Clipboard image content must be base64")

      not Regex.match?(~r/^[A-Za-z0-9+\/]*={0,2}$/, value) ->
        rpc_error("invalid_base64", "Clipboard image content must be base64")

      true ->
        :ok
    end
  end

  defp fetch_upload(context, upload_id) do
    key = upload_key(context, upload_id)

    with {:ok, upload} <- fetch_state(key),
         true <- upload.expires_at > now_ms() do
      {:ok, upload}
    else
      _missing ->
        delete_state(key)
        {:error, :upload_not_found}
    end
  end

  defp concurrent_uploads(context) do
    ensure_state_table()
    scope = state_scope(context)
    now = now_ms()

    for {{kind, ^scope, id} = key, %{expires_at: expires_at}} <- :ets.tab2list(@state_table),
        kind in [:upload, :grant],
        expires_at <= now do
      :ets.delete(@state_table, key)
      {kind, id}
    end

    :ets.tab2list(@state_table)
    |> Enum.count(fn
      {{:upload, ^scope, _upload_id}, %{expires_at: expires_at}} -> expires_at > now
      _other -> false
    end)
  end

  defp upload_key(context, upload_id), do: {:upload, state_scope(context), upload_id}
  defp grant_key(context, grant_id), do: {:grant, state_scope(context), grant_id}

  defp state_scope(context) do
    {Map.get(context, :host_id, "host"), Map.get(context, :device_id, "device")}
  end

  defp fetch_state(key) do
    ensure_state_table()

    case :ets.lookup(@state_table, key) do
      [{^key, value}] -> {:ok, value}
      [] -> {:error, :not_found}
    end
  end

  defp put_state(key, value) do
    ensure_state_table()
    :ets.insert(@state_table, {key, value})
    :ok
  end

  defp delete_state(key) do
    ensure_state_table()
    :ets.delete(@state_table, key)
    :ok
  end

  defp ensure_state_table do
    case :ets.whereis(@state_table) do
      :undefined ->
        try do
          :ets.new(@state_table, [:named_table, :public, :set, read_concurrency: true])
        rescue
          ArgumentError -> @state_table
        end

      table ->
        table
    end
  end

  defp now_ms, do: System.monotonic_time(:millisecond)

  defp random_id(prefix) do
    encoded = :crypto.strong_rand_bytes(18) |> Base.url_encode64(padding: false)
    "#{prefix}_#{encoded}"
  end

  defp capability_unavailable(feature),
    do: rpc_error("capability_unavailable", "#{feature} is unavailable on this Symphony host")

  defp file_error({:rpc_error, _code, _message, _retryable, _data} = error),
    do: {:error, error}

  defp file_error(:invalid_relative_path),
    do: rpc_error("invalid_relative_path", "Path must stay inside the selected worktree")

  defp file_error(:binary_file), do: rpc_error("binary_file", "binary_file")
  defp file_error(:file_too_large), do: rpc_error("file_too_large", "file_too_large")
  defp file_error(:terminal_file_grant_stale), do: rpc_error("terminal_file_grant_stale", "Reload preview before saving")
  defp file_error(:upload_not_found), do: rpc_error("upload_not_found", "Clipboard image upload was not found")
  defp file_error(:enoent), do: rpc_error("not_found", "File not found")
  defp file_error(:enotdir), do: rpc_error("not_found", "Directory not found")
  defp file_error(:not_a_file), do: rpc_error("not_a_file", "Path is not a file")
  defp file_error(reason), do: rpc_error("file_error", "File operation failed: #{inspect(reason)}")

  defp rpc_error(code, message),
    do: {:error, {:rpc_error, code, message, false, nil}}
end
