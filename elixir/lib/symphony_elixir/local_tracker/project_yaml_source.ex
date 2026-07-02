defmodule SymphonyElixir.LocalTracker.ProjectYamlSource do
  @moduledoc """
  Fetches portable project YAML bundles from HTTPS URLs for import.

  Blocks loopback and private-network targets to reduce SSRF risk when the
  Symphony server fetches user-supplied URLs.
  """

  alias SymphonyElixir.GitHub.Gist

  @max_bytes 1_048_576
  @timeout_ms 15_000
  @user_agent "Symphony-Project-Import/1.0"

  @gist_page ~r{\Ahttps://gist\.github\.com/[^/]+/([0-9a-f]+)(?:[/?#].*)?\z}i
  @gist_raw ~r{\Ahttps://gist\.githubusercontent\.com/.+\z}i
  @github_raw ~r{\Ahttps://raw\.githubusercontent\.com/.+\z}i

  @spec fetch(String.t()) :: {:ok, String.t()} | {:error, term()}
  def fetch(url) when is_binary(url) do
    trimmed = String.trim(url)

    cond do
      trimmed == "" ->
        {:error, :invalid_import_url}

      Regex.match?(@gist_page, trimmed) ->
        fetch_gist_page(trimmed)

      true ->
        with {:ok, uri} <- parse_https_url(trimmed),
             :ok <- assert_public_host(uri.host),
             {:ok, body} <- http_get(uri) do
          {:ok, body}
        end
    end
  end

  defp fetch_gist_page(url) do
    case Regex.run(@gist_page, url, capture: :all_but_first) do
      [gist_id] -> Gist.fetch_yaml(gist_id)
      _ -> {:error, :invalid_import_url}
    end
  end

  defp parse_https_url(url) do
    case URI.parse(url) do
      %URI{scheme: "https", host: host} = uri when is_binary(host) and host != "" ->
        {:ok, uri}

      %URI{scheme: scheme} when scheme in ["http", nil, ""] ->
        {:error, :invalid_import_url}

      _ ->
        {:error, :invalid_import_url}
    end
  end

  defp assert_public_host(host) do
    normalized = String.downcase(host)

    cond do
      normalized in ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"] ->
        {:error, :import_url_blocked}

      String.ends_with?(normalized, ".localhost") ->
        {:error, :import_url_blocked}

      ip_blocked?(normalized) ->
        {:error, :import_url_blocked}

      true ->
        with {:ok, addresses} <- resolve_host(normalized),
             :ok <- assert_public_addresses(addresses) do
          :ok
        else
          {:error, :nxdomain} -> :ok
          other -> other
        end
    end
  end

  defp ip_blocked?(host) do
    case :inet.parse_address(String.to_charlist(host)) do
      {:ok, address} -> private_address?(address)
      {:error, _} -> false
    end
  end

  defp resolve_host(host) do
    case :inet.getaddr(String.to_charlist(host), :inet) do
      {:ok, address} -> {:ok, [address]}
      {:error, reason} -> {:error, reason}
    end
  end

  defp assert_public_addresses(addresses) do
    if Enum.all?(addresses, &(!private_address?(&1))) do
      :ok
    else
      {:error, :import_url_blocked}
    end
  end

  defp private_address?({127, _, _, _}), do: true
  defp private_address?({10, _, _, _}), do: true
  defp private_address?({172, b, _, _}) when b in 16..31, do: true
  defp private_address?({192, 168, _, _}), do: true
  defp private_address?({169, 254, _, _}), do: true
  defp private_address?({0, 0, 0, 0}), do: true
  defp private_address?(_), do: false

  defp http_get(%URI{} = uri) do
    url = URI.to_string(uri)

    if Regex.match?(@gist_raw, url) or Regex.match?(@github_raw, url) do
      http_get_impl(url)
    else
      with :ok <- assert_public_host(uri.host), do: http_get_impl(url)
    end
  end

  defp http_get_impl(url) do
    Application.get_env(:symphony_elixir, :project_yaml_http_get, &__MODULE__.do_http_get/1).(url)
  end

  @doc false
  @spec do_http_get(String.t()) :: {:ok, String.t()} | {:error, term()}
  def do_http_get(url) do
    case Req.get(url,
           headers: [{"user-agent", @user_agent}],
           connect_options: [timeout: @timeout_ms],
           receive_timeout: @timeout_ms,
           max_redirects: 3
         ) do
      {:ok, %{status: status, body: body}} when status in 200..299 and is_binary(body) ->
        if byte_size(body) <= @max_bytes do
          {:ok, body}
        else
          {:error, :import_url_too_large}
        end

      {:ok, %{status: 404}} ->
        {:error, :import_url_not_found}

      {:ok, %{status: status}} ->
        {:error, {:import_url_fetch_failed, status}}

      {:error, reason} ->
        {:error, {:import_url_fetch_failed, reason}}
    end
  end
end
