defmodule SymphonyElixir.GitHub.Gist do
  @moduledoc """
  Creates and updates GitHub Gists for sharing Symphony project YAML bundles.
  """

  alias SymphonyElixir.GitHub.Client

  @type share_info :: %{
          gist_id: String.t(),
          html_url: String.t(),
          raw_url: String.t(),
          filename: String.t()
        }

  @spec share(String.t(), String.t(), keyword()) :: {:ok, share_info()} | {:error, term()}
  def share(slug, yaml, opts \\ []) when is_binary(slug) and is_binary(yaml) do
    filename = Keyword.get(opts, :filename, "#{slug}.yaml")
    public? = Keyword.get(opts, :public, false)
    gist_id = Keyword.get(opts, :gist_id)

    payload = %{
      "description" => Keyword.get(opts, :description, "Symphony project bundle: #{slug}"),
      "public" => public?,
      "files" => %{filename => %{"content" => yaml}}
    }

    path =
      if is_binary(gist_id) and gist_id != "" do
        "/gists/#{gist_id}"
      else
        "/gists"
      end

    rest_opts = Keyword.take(opts, [:request_fun])

    request =
      if is_binary(gist_id) and gist_id != "" do
        fn path, payload, opts -> Client.rest_patch(path, payload, Keyword.merge(rest_opts, opts)) end
      else
        fn path, payload, opts -> Client.rest_post(path, payload, Keyword.merge(rest_opts, opts)) end
      end

    case request.(path, payload, []) do
      {:ok, %{body: body}} when is_map(body) ->
        {:ok, normalize_share(body, filename)}

      error ->
        error
    end
  end

  @spec fetch_yaml(String.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def fetch_yaml(gist_id, opts \\ []) when is_binary(gist_id) do
    rest_opts = Keyword.take(opts, [:request_fun])

    case Client.rest_get("/gists/#{gist_id}", rest_opts) do
      {:ok, %{body: %{"files" => files}}} when is_map(files) ->
        read_gist_files(files)

      {:error, :missing_github_token} ->
        fetch_public_gist(gist_id)

      {:ok, %{status: 404}} ->
        {:error, :import_url_not_found}

      error ->
        error
    end
  end

  defp fetch_public_gist(gist_id) do
    url = "https://api.github.com/gists/#{gist_id}"

    case Req.get(url,
           headers: [
             {"accept", "application/vnd.github+json"},
             {"user-agent", "Symphony-Project-Import/1.0"}
           ],
           connect_options: [timeout: 15_000],
           receive_timeout: 15_000
         ) do
      {:ok, %{status: status, body: %{"files" => files}}} when status in 200..299 and is_map(files) ->
        read_gist_files(files)

      {:ok, %{status: 404}} ->
        {:error, :import_url_not_found}

      _ ->
        {:error, :import_url_fetch_failed}
    end
  end

  defp read_gist_files(files) do
    files
    |> Map.values()
    |> Enum.find_value(fn
      %{"content" => content} when is_binary(content) and content != "" -> {:ok, content}
      %{"raw_url" => raw_url} when is_binary(raw_url) -> fetch_raw_url(raw_url)
      _ -> nil
    end)
    |> case do
      {:ok, _} = ok -> ok
      _ -> {:error, :import_url_not_found}
    end
  end

  defp fetch_raw_url(url) do
    case Req.get(url, connect_options: [timeout: 15_000], receive_timeout: 15_000) do
      {:ok, %{status: status, body: body}} when status in 200..299 and is_binary(body) ->
        {:ok, body}

      _ ->
        {:error, :import_url_fetch_failed}
    end
  end

  defp normalize_share(body, filename) do
    file = get_in(body, ["files", filename]) || first_file(body)

    %{
      gist_id: Map.get(body, "id"),
      html_url: Map.get(body, "html_url"),
      raw_url: file_raw_url(file),
      filename: Map.get(file, "filename", filename)
    }
  end

  defp first_file(%{"files" => files}) when is_map(files) do
    files |> Map.values() |> List.first() || %{}
  end

  defp first_file(_), do: %{}

  defp file_raw_url(%{"raw_url" => url}) when is_binary(url), do: url
  defp file_raw_url(_), do: nil
end
