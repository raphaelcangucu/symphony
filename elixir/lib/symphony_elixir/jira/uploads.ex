defmodule SymphonyElixir.Jira.Uploads do
  @moduledoc """
  Attaches a local file to a JIRA issue natively and returns the Jira-hosted
  `content` download URL, ready to reference in a comment body.

  JIRA attachments are issue-scoped (`POST /rest/api/3/issue/{key}/attachments`),
  so the uploader takes the issue key. The attachment also surfaces in the
  issue's Attachments panel — where Jira renders image thumbnails — so evidence
  is visible without a publicly reachable Symphony.

  Wrapped in a per-issue closure, this satisfies `Evidence.RemoteArtifacts`'
  uploader contract: `(path, filename, content_type) -> {:ok, url} | {:error, term}`.
  """

  alias SymphonyElixir.Jira.Config

  @request_timeout_ms 30_000

  @spec upload(String.t(), Path.t(), String.t(), String.t(), keyword()) ::
          {:ok, String.t()} | {:error, term()}
  def upload(issue_id_or_key, path, filename, content_type, opts \\ []) do
    email = Keyword.get(opts, :email, Config.email())
    api_token = Keyword.get(opts, :api_token, Config.api_token())
    base_url = Keyword.get(opts, :base_url, Config.base_url())
    request_fun = Keyword.get(opts, :request_fun, &default_request/3)

    with {:ok, headers} <- auth_headers(email, api_token),
         {:ok, url} <- build_url(base_url, issue_id_or_key),
         {:ok, body} <- read_file(path),
         {:ok, response} <- request_fun.(url, headers, multipart(filename, content_type, body)) do
      extract_content_url(response)
    end
  end

  defp read_file(path) do
    case File.read(path) do
      {:ok, body} -> {:ok, body}
      {:error, reason} -> {:error, {:file_read_failed, reason}}
    end
  end

  # JIRA returns a JSON array of the created attachments; each carries a
  # `content` download URL that authenticated Jira users can open.
  defp extract_content_url([%{"content" => content} | _]) when is_binary(content) and content != "" do
    {:ok, content}
  end

  defp extract_content_url(%{"content" => content}) when is_binary(content) and content != "" do
    {:ok, content}
  end

  defp extract_content_url(other), do: {:error, {:jira_attachment_unexpected, other}}

  defp multipart(filename, content_type, body) do
    [file: {body, filename: filename, content_type: content_type}]
  end

  defp default_request(url, headers, multipart) do
    case Req.post(url, headers: headers, form_multipart: multipart, connect_options: [timeout: @request_timeout_ms]) do
      {:ok, %{status: status, body: body}} when status in 200..299 -> {:ok, body}
      {:ok, %{status: status}} -> {:error, {:jira_attachment_status, status}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp auth_headers(email, api_token) when is_binary(email) and is_binary(api_token) do
    token = Base.encode64("#{email}:#{api_token}")

    {:ok,
     [
       {"Authorization", "Basic #{token}"},
       {"X-Atlassian-Token", "no-check"},
       {"Accept", "application/json"}
     ]}
  end

  defp auth_headers(_email, _api_token), do: {:error, :missing_jira_credentials}

  defp build_url(base_url, issue) when is_binary(base_url) and is_binary(issue) and issue != "" do
    {:ok, String.trim_trailing(base_url, "/") <> "/rest/api/3/issue/" <> issue <> "/attachments"}
  end

  defp build_url(_base_url, _issue), do: {:error, :missing_jira_credentials}
end
