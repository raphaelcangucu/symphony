defmodule SymphonyElixir.Assistant.AttachmentStore do
  @moduledoc "Stores project assistant uploads inside the Codex assistant workspace."

  alias SymphonyElixir.Assistant.CodexSession

  @max_image_bytes 4 * 1024 * 1024
  @max_file_bytes 5 * 1024 * 1024
  @allowed_extensions ~w(.png .jpg .jpeg .gif .webp)

  @image_extensions ~w(.png .jpg .jpeg .gif .webp)
  @text_extensions ~w(.md .markdown .mdx .txt .text .log .csv .tsv .json .jsonc .ndjson .yaml .yml .toml .xml .svg
    .html .htm .css .scss .sass .less .js .jsx .ts .tsx .mjs .cjs .py .rb .go .rs .java .kt .kts .c .h .cc .cpp .hpp
    .cxx .cs .php .sh .bash .zsh .fish .sql .graphql .gql .diff .patch .ini .cfg .conf .properties .gradle .r .lua
    .pl .swift .scala .clj .cljs .edn .ex .exs .erl .heex .eex .leex .vue .svelte .astro .dart .m .mm .proto .tf
    .tfvars)
  @document_extensions ~w(.pdf)
  @file_extensions @image_extensions ++ @text_extensions ++ @document_extensions
  @text_content_types ~w(application/json application/xml application/x-yaml application/yaml application/toml)
  @inline_text_limit 256 * 1024

  @type stored_attachment :: %{
          String.t() => String.t() | non_neg_integer()
        }

  @spec store_image(String.t(), Plug.Upload.t()) :: {:ok, stored_attachment()} | {:error, term()}
  def store_image(project_slug, %Plug.Upload{} = upload) when is_binary(project_slug) do
    with {:ok, workspace} <- CodexSession.assistant_workspace(project_slug),
         :ok <- File.mkdir_p(uploads_dir(workspace)),
         {:ok, extension} <- allowed_extension(upload),
         {:ok, size_bytes} <- validate_size(upload.path),
         id = unique_id(),
         relative_path = Path.join("uploads", "#{id}#{extension}"),
         absolute_path = Path.join(workspace, relative_path),
         :ok <- File.cp(upload.path, absolute_path) do
      {:ok,
       %{
         "id" => id,
         "type" => "image",
         "name" => upload_filename(upload, extension),
         "media_type" => mime_type(upload, extension),
         "path" => relative_path,
         "size_bytes" => size_bytes
       }}
    end
  end

  def store_image(_project_slug, _upload), do: {:error, :invalid_upload}

  @spec store_file(String.t(), Plug.Upload.t()) :: {:ok, stored_attachment()} | {:error, term()}
  def store_file(project_slug, %Plug.Upload{} = upload) when is_binary(project_slug) do
    with {:ok, workspace} <- CodexSession.assistant_workspace(project_slug),
         :ok <- File.mkdir_p(uploads_dir(workspace)),
         {:ok, extension} <- allowed_file_extension(upload),
         {:ok, size_bytes} <- validate_file_size(upload.path),
         id = unique_id(),
         relative_path = Path.join("uploads", "#{id}#{extension}"),
         absolute_path = Path.join(workspace, relative_path),
         :ok <- File.cp(upload.path, absolute_path) do
      {:ok,
       %{
         "id" => id,
         "type" => attachment_type(extension),
         "name" => file_filename(upload, extension),
         "media_type" => mime_type(upload, extension),
         "path" => relative_path,
         "size_bytes" => size_bytes
       }}
    end
  end

  def store_file(_project_slug, _upload), do: {:error, :invalid_upload}

  @doc """
  Reads a stored attachment as UTF-8 text. Returns `:not_text` for binary
  content (e.g. images, PDFs) so callers can fall back to a path reference.
  """
  @spec read_text(String.t(), String.t()) :: {:ok, String.t(), boolean()} | {:error, term()}
  def read_text(project_slug, relative_path) when is_binary(project_slug) and is_binary(relative_path) do
    with {:ok, absolute} <- resolve_path(project_slug, relative_path),
         true <- text_path?(absolute) || {:error, :not_text},
         {:ok, binary} <- File.read(absolute) do
      case String.valid?(binary) do
        true -> {:ok, truncate_text(binary), byte_size(binary) > @inline_text_limit}
        false -> {:error, :not_text}
      end
    else
      {:error, reason} -> {:error, reason}
      false -> {:error, :not_text}
    end
  end

  @spec resolve_path(String.t(), String.t()) :: {:ok, Path.t()} | {:error, term()}
  def resolve_path(project_slug, relative_path) when is_binary(project_slug) and is_binary(relative_path) do
    with {:ok, workspace} <- CodexSession.assistant_workspace(project_slug),
         {:ok, safe_relative} <- safe_relative_path(relative_path),
         absolute = Path.join(workspace, safe_relative),
         true <- File.exists?(absolute) do
      {:ok, absolute}
    else
      _ -> {:error, :attachment_not_found}
    end
  end

  @spec uploads_dir(Path.t()) :: Path.t()
  def uploads_dir(workspace), do: Path.join(workspace, "uploads")

  @doc """
  Lists stored uploads for a project as `{relative_path, absolute_path}` tuples.
  Returns `{:ok, []}` when nothing has been uploaded yet.
  """
  @spec list_uploads(String.t()) :: {:ok, [{String.t(), Path.t()}]} | {:error, term()}
  def list_uploads(project_slug) when is_binary(project_slug) do
    with {:ok, workspace} <- CodexSession.assistant_workspace(project_slug) do
      dir = uploads_dir(workspace)

      case File.ls(dir) do
        {:ok, names} ->
          {:ok,
           names
           |> Enum.map(fn name -> {Path.join("uploads", name), Path.join(dir, name)} end)
           |> Enum.filter(fn {_relative, absolute} -> File.regular?(absolute) end)}

        {:error, :enoent} ->
          {:ok, []}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  @spec content_type(Path.t()) :: String.t()
  def content_type(path) when is_binary(path) do
    path
    |> Path.extname()
    |> String.downcase()
    |> extension_to_mime()
  end

  defp safe_relative_path(path) do
    normalized = path |> String.replace("\\", "/") |> String.trim()

    cond do
      normalized == "" -> {:error, :invalid_path}
      String.contains?(normalized, "..") -> {:error, :invalid_path}
      not String.starts_with?(normalized, "uploads/") -> {:error, :invalid_path}
      true -> {:ok, normalized}
    end
  end

  defp allowed_extension(%Plug.Upload{filename: filename, content_type: content_type}) do
    extension =
      filename
      |> Path.extname()
      |> String.downcase()

    cond do
      extension in @allowed_extensions ->
        {:ok, extension}

      content_type in ["image/png", "image/jpeg", "image/gif", "image/webp"] ->
        {:ok, mime_to_extension(content_type)}

      true ->
        {:error, :unsupported_image_type}
    end
  end

  defp validate_size(path) do
    case File.stat(path) do
      {:ok, %File.Stat{size: size}} when size > 0 and size <= @max_image_bytes -> {:ok, size}
      {:ok, %File.Stat{size: size}} when size > @max_image_bytes -> {:error, :image_too_large}
      _ -> {:error, :invalid_upload}
    end
  end

  defp allowed_file_extension(%Plug.Upload{filename: filename, content_type: content_type}) do
    extension = filename |> Path.extname() |> String.downcase()

    cond do
      extension in @file_extensions ->
        {:ok, extension}

      is_binary(content_type) and String.starts_with?(content_type, "image/") ->
        {:ok, mime_to_extension(content_type)}

      is_binary(content_type) and (String.starts_with?(content_type, "text/") or content_type in @text_content_types) ->
        {:ok, if(extension == "", do: ".txt", else: extension)}

      true ->
        {:error, :unsupported_file_type}
    end
  end

  defp validate_file_size(path) do
    case File.stat(path) do
      {:ok, %File.Stat{size: size}} when size > 0 and size <= @max_file_bytes -> {:ok, size}
      {:ok, %File.Stat{size: size}} when size > @max_file_bytes -> {:error, :file_too_large}
      _ -> {:error, :invalid_upload}
    end
  end

  defp attachment_type(extension) when is_binary(extension) do
    if extension in @image_extensions, do: "image", else: "file"
  end

  defp text_path?(path) do
    ext = path |> Path.extname() |> String.downcase()
    ext in @text_extensions
  end

  defp truncate_text(binary) when byte_size(binary) <= @inline_text_limit, do: binary

  defp truncate_text(binary) do
    binary
    |> binary_part(0, @inline_text_limit)
    |> valid_utf8_prefix()
  end

  defp valid_utf8_prefix(bin) do
    if String.valid?(bin) or byte_size(bin) == 0 do
      bin
    else
      valid_utf8_prefix(binary_part(bin, 0, byte_size(bin) - 1))
    end
  end

  defp mime_type(%Plug.Upload{content_type: type}, _extension) when is_binary(type) and type != "",
    do: type

  defp mime_type(_upload, extension), do: extension_to_mime(extension)

  defp upload_filename(%Plug.Upload{filename: filename}, extension) when is_binary(filename) do
    case String.trim(filename) do
      "" -> "image#{extension}"
      value -> value
    end
  end

  defp file_filename(%Plug.Upload{filename: filename}, extension) when is_binary(filename) do
    case String.trim(filename) do
      "" -> "file#{extension}"
      value -> value
    end
  end

  defp file_filename(_upload, extension), do: "file#{extension}"

  defp unique_id do
    Base.url_encode64(:crypto.strong_rand_bytes(12), padding: false)
  end

  defp mime_to_extension("image/png"), do: ".png"
  defp mime_to_extension("image/jpeg"), do: ".jpg"
  defp mime_to_extension("image/gif"), do: ".gif"
  defp mime_to_extension("image/webp"), do: ".webp"
  defp mime_to_extension(_), do: ".png"

  defp extension_to_mime(".png"), do: "image/png"
  defp extension_to_mime(".jpg"), do: "image/jpeg"
  defp extension_to_mime(".jpeg"), do: "image/jpeg"
  defp extension_to_mime(".gif"), do: "image/gif"
  defp extension_to_mime(".webp"), do: "image/webp"
  defp extension_to_mime(".md"), do: "text/markdown"
  defp extension_to_mime(".markdown"), do: "text/markdown"
  defp extension_to_mime(".mdx"), do: "text/markdown"
  defp extension_to_mime(".csv"), do: "text/csv"
  defp extension_to_mime(".tsv"), do: "text/tab-separated-values"
  defp extension_to_mime(".json"), do: "application/json"
  defp extension_to_mime(".jsonc"), do: "application/json"
  defp extension_to_mime(".ndjson"), do: "application/json"
  defp extension_to_mime(".yaml"), do: "application/yaml"
  defp extension_to_mime(".yml"), do: "application/yaml"
  defp extension_to_mime(".toml"), do: "application/toml"
  defp extension_to_mime(".xml"), do: "application/xml"
  defp extension_to_mime(".html"), do: "text/html"
  defp extension_to_mime(".htm"), do: "text/html"
  defp extension_to_mime(".css"), do: "text/css"
  defp extension_to_mime(".pdf"), do: "application/pdf"

  defp extension_to_mime(extension) do
    if extension in @text_extensions, do: "text/plain", else: "application/octet-stream"
  end
end
