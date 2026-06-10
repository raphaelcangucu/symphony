defmodule SymphonyElixir.Linear.Uploads do
  @moduledoc """
  Uploads a local file to Linear and returns its public `assetUrl`, ready to be
  embedded in a comment body. Three steps (per Linear's upload flow):

    1. `fileUpload` → signed `uploadUrl`, final `assetUrl`, and required headers.
    2. `PUT` the bytes to `uploadUrl` with exactly those headers.
    3. The caller embeds `assetUrl` in the comment.

  Shaped to satisfy `Evidence.RemoteArtifacts`' uploader contract
  (`(path, filename, content_type) -> {:ok, asset_url} | {:error, term}`).
  """

  alias SymphonyElixir.Linear.Client

  @file_upload_mutation """
  mutation SymphonyFileUpload($filename: String!, $contentType: String!, $size: Int!, $makePublic: Boolean) {
    fileUpload(filename: $filename, contentType: $contentType, size: $size, makePublic: $makePublic) {
      success
      uploadFile {
        uploadUrl
        assetUrl
        headers { key value }
      }
    }
  }
  """

  @spec upload(Path.t(), String.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def upload(path, filename, content_type), do: upload(path, filename, content_type, [])

  @spec upload(Path.t(), String.t(), String.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def upload(path, filename, content_type, opts) do
    graphql = Keyword.get(opts, :graphql, &Client.graphql/3)
    put = Keyword.get(opts, :put, &default_put/3)

    with {:ok, size} <- file_size(path),
         {:ok, upload} <- request_upload(graphql, filename, content_type, size),
         :ok <- put.(upload.upload_url, upload.headers, File.read!(path)) do
      {:ok, upload.asset_url}
    end
  end

  defp request_upload(graphql, filename, content_type, size) do
    variables = %{"filename" => filename, "contentType" => content_type, "size" => size, "makePublic" => true}

    case graphql.(@file_upload_mutation, variables, []) do
      {:ok, %{"data" => %{"fileUpload" => %{"success" => true, "uploadFile" => file}}}} when is_map(file) ->
        {:ok,
         %{
           upload_url: file["uploadUrl"],
           asset_url: file["assetUrl"],
           headers: normalize_headers(file["headers"])
         }}

      {:ok, response} ->
        {:error, {:linear_file_upload_failed, response}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp default_put(url, headers, body) do
    case Req.put(url, headers: headers, body: body, connect_options: [timeout: 30_000]) do
      {:ok, %{status: status}} when status in 200..299 -> :ok
      {:ok, response} -> {:error, {:linear_upload_status, response.status}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp normalize_headers(headers) when is_list(headers) do
    Enum.flat_map(headers, fn
      %{"key" => key, "value" => value} when is_binary(key) -> [{key, value}]
      _ -> []
    end)
  end

  defp normalize_headers(_headers), do: []

  defp file_size(path) do
    case File.stat(path) do
      {:ok, %File.Stat{size: size}} -> {:ok, size}
      {:error, reason} -> {:error, {:file_stat_failed, reason}}
    end
  end
end
