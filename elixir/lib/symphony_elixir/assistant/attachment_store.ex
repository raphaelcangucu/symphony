defmodule SymphonyElixir.Assistant.AttachmentStore do
  @moduledoc "Stores project assistant uploads inside the Codex assistant workspace."

  alias SymphonyElixir.Assistant.CodexSession

  @max_image_bytes 4 * 1024 * 1024
  @allowed_extensions ~w(.png .jpg .jpeg .gif .webp)

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

  defp mime_type(%Plug.Upload{content_type: type}, _extension) when is_binary(type) and type != "",
    do: type

  defp mime_type(_upload, extension), do: extension_to_mime(extension)

  defp upload_filename(%Plug.Upload{filename: filename}, extension) when is_binary(filename) do
    case String.trim(filename) do
      "" -> "image#{extension}"
      value -> value
    end
  end

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
  defp extension_to_mime(_), do: "application/octet-stream"
end
