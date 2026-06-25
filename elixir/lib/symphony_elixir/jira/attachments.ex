defmodule SymphonyElixir.Jira.Attachments do
  @moduledoc """
  Downloads JIRA issue attachment content through the daemon so the tracker UI
  can render files behind JIRA Cloud's authenticated media endpoints.

  Browsers cannot fetch `/rest/api/3/attachment/content/:id` directly (it needs
  the operator's JIRA Basic credentials), so the tracker proxies the bytes: the
  daemon authenticates here and streams the response back to the SPA.

  HTTP is performed with `Req` but can be injected via the `:request_fun` option
  (or the `:jira_attachment_request_fun` application env) for tests.
  """

  require Logger

  alias SymphonyElixir.Jira.Config

  @content_path "/rest/api/3/attachment/content/"
  @delete_path "/rest/api/3/attachment/"
  @default_content_type "application/octet-stream"
  @request_timeout_ms 30_000

  @type download_result :: {:ok, %{content_type: String.t(), body: binary()}} | {:error, term()}
  @type delete_result :: :ok | {:error, term()}

  @doc """
  Fetches the bytes for attachment `id`.

  Options:
    * `:request_fun` — `fn url, headers -> {:ok, %{status, headers, body}} | {:error, reason}`
    * `:base_url`, `:email`, `:api_token` — override `Jira.Config` (used by tests)
  """
  @spec download(String.t(), keyword()) :: download_result()
  def download(id, opts \\ []) when is_binary(id) and is_list(opts) do
    base_url = Keyword.get(opts, :base_url, Config.base_url())
    email = Keyword.get(opts, :email, Config.email())
    api_token = Keyword.get(opts, :api_token, Config.api_token())

    with {:ok, headers} <- auth_headers(email, api_token),
         {:ok, url} <- build_url(base_url, id) do
      request_fun = resolve_request_fun(opts)

      case request_fun.(url, headers) do
        {:ok, %{status: status, headers: response_headers, body: body}} when status in 200..299 ->
          {:ok, %{content_type: content_type(response_headers), body: body}}

        {:ok, %{status: status}} ->
          Logger.warning("JIRA attachment download failed status=#{status} id=#{id}")
          {:error, {:jira_api_status, status}}

        {:error, reason} ->
          Logger.warning("JIRA attachment download failed id=#{id}: #{inspect(reason)}")
          {:error, {:jira_api_request, reason}}
      end
    end
  end

  @doc """
  Deletes attachment `id` from JIRA.

  Options match `download/2` (`:request_fun`, credential overrides).
  """
  @spec delete(String.t(), keyword()) :: delete_result()
  def delete(id, opts \\ []) when is_binary(id) and is_list(opts) do
    base_url = Keyword.get(opts, :base_url, Config.base_url())
    email = Keyword.get(opts, :email, Config.email())
    api_token = Keyword.get(opts, :api_token, Config.api_token())

    with {:ok, headers} <- auth_headers(email, api_token),
         {:ok, url} <- build_delete_url(base_url, id) do
      request_fun = resolve_delete_request_fun(opts)

      case request_fun.(url, headers) do
        {:ok, %{status: status}} when status in 200..299 ->
          :ok

        {:ok, %{status: status}} ->
          Logger.warning("JIRA attachment delete failed status=#{status} id=#{id}")
          {:error, {:jira_api_status, status}}

        {:error, reason} ->
          Logger.warning("JIRA attachment delete failed id=#{id}: #{inspect(reason)}")
          {:error, {:jira_api_request, reason}}
      end
    end
  end

  defp resolve_request_fun(opts) do
    Keyword.get(opts, :request_fun) ||
      Application.get_env(:symphony_elixir, :jira_attachment_request_fun) ||
      (&default_request/2)
  end

  defp resolve_delete_request_fun(opts) do
    Keyword.get(opts, :delete_request_fun) ||
      Keyword.get(opts, :request_fun) ||
      Application.get_env(:symphony_elixir, :jira_attachment_delete_request_fun) ||
      Application.get_env(:symphony_elixir, :jira_attachment_request_fun) ||
      (&default_delete_request/2)
  end

  defp default_request(url, headers) do
    case Req.request(
           method: :get,
           url: url,
           headers: headers,
           decode_body: false,
           redirect: true,
           connect_options: [timeout: @request_timeout_ms]
         ) do
      {:ok, %Req.Response{status: status, headers: response_headers, body: body}} ->
        {:ok, %{status: status, headers: response_headers, body: body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp default_delete_request(url, headers) do
    case Req.request(
           method: :delete,
           url: url,
           headers: headers,
           decode_body: false,
           connect_options: [timeout: @request_timeout_ms]
         ) do
      {:ok, %Req.Response{status: status}} ->
        {:ok, %{status: status}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp auth_headers(email, api_token) when is_binary(email) and is_binary(api_token) do
    token = Base.encode64("#{email}:#{api_token}")
    {:ok, [{"Authorization", "Basic #{token}"}, {"Accept", "*/*"}]}
  end

  defp auth_headers(_email, _api_token), do: {:error, :missing_jira_credentials}

  defp build_url(base_url, id) when is_binary(base_url) do
    {:ok, String.trim_trailing(base_url, "/") <> @content_path <> URI.encode(id, &URI.char_unreserved?/1)}
  end

  defp build_url(_base_url, _id), do: {:error, :missing_jira_credentials}

  defp build_delete_url(base_url, id) when is_binary(base_url) do
    {:ok, String.trim_trailing(base_url, "/") <> @delete_path <> URI.encode(id, &URI.char_unreserved?/1)}
  end

  defp build_delete_url(_base_url, _id), do: {:error, :missing_jira_credentials}

  defp content_type(headers) do
    headers
    |> header_pairs()
    |> Enum.find_value(@default_content_type, fn {key, value} ->
      if String.downcase(to_string(key)) == "content-type", do: header_value(value)
    end)
  end

  defp header_pairs(headers) when is_map(headers), do: Enum.to_list(headers)
  defp header_pairs(headers) when is_list(headers), do: headers
  defp header_pairs(_headers), do: []

  defp header_value([value | _rest]), do: to_string(value)
  defp header_value(value) when is_binary(value), do: value
  defp header_value(_value), do: nil
end
