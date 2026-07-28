defmodule SymphonyElixir.Claude.Usage do
  @moduledoc """
  Active probe for Claude plan usage.

  Unlike Codex (whose `rate_limits` flow through the app-server stream and are
  captured passively in `SymphonyElixir.Observability.Registry`), Claude exposes
  plan usage only via an authenticated HTTP endpoint. This module mirrors the
  approach the Jean desktop app uses: it reads the Claude CLI OAuth token from
  `~/.claude/.credentials.json`, refreshing it against Anthropic's OAuth token
  endpoint when expired, then calls the OAuth usage API and normalizes the
  response into a `SymphonyElixir.AgentUsage.Snapshot` stored under `"claude"`.

  The live endpoints are undocumented and OAuth-token-gated, so every step fails
  soft: a missing token, an unrefreshable session, or a non-2xx response yields
  `{:error, reason}` and never crashes the caller. A successful refresh is
  persisted back to the credentials file (rotated refresh tokens included) so the
  `claude` CLI keeps working.
  """

  alias SymphonyElixir.AgentUsage
  alias SymphonyElixir.AgentUsage.Refresh
  alias SymphonyElixir.AgentUsage.Snapshot
  alias SymphonyElixir.AgentUsage.Window

  require Logger

  @agent_kind "claude"
  @credentials_file ".claude/.credentials.json"
  @usage_url "https://api.anthropic.com/api/oauth/usage"
  @refresh_url "https://platform.claude.com/v1/oauth/token"
  @oauth_client_id "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
  @oauth_scopes "user:profile user:inference user:sessions:claude_code user:mcp_servers"
  @beta_header {"anthropic-beta", "oauth-2025-04-20"}
  @request_timeout_ms 5_000
  @refresh_buffer_ms 300_000
  @default_account_id "default"

  @type credentials :: %{
          access_token: String.t(),
          refresh_token: String.t() | nil,
          expires_at: integer() | nil,
          subscription_type: String.t() | nil,
          raw: map(),
          path: String.t()
        }

  # ── Public API ──────────────────────────────────────────────────────────────

  @doc """
  Fetch + normalize Claude usage and write it into the `AgentUsage` store.

  Returns `:skip` when disabled, when a fresh snapshot already exists, or when a
  recent attempt is still inside the backoff window. Returns `{:error, reason}`
  when a fetch was attempted but failed.
  """
  @spec refresh_into_store(keyword()) :: :ok | :skip | {:error, term()}
  def refresh_into_store(opts \\ []) do
    account_id = Keyword.get(opts, :account_id, @default_account_id)

    if enabled?() and (Keyword.get(opts, :force, false) or not fresh_in_store?(account_id)) do
      Refresh.run(
        @agent_kind,
        account_id,
        fn -> safe_fetch(opts) end,
        refresh_options(opts)
      )
    else
      :skip
    end
  end

  @doc "Fetch + normalize Claude usage without touching the store."
  @spec fetch(keyword()) :: {:ok, Snapshot.t()} | {:error, term()}
  def fetch(opts \\ []) do
    now_ms = Keyword.get(opts, :now_ms, System.system_time(:millisecond))

    with {:ok, creds} <- read_credentials(credentials_path(opts)),
         {:ok, creds} <- ensure_fresh_token(creds, now_ms, opts),
         {:ok, body} <- request_usage_with_retry(creds, now_ms, opts) do
      {:ok, normalize(body, creds.subscription_type, System.system_time(:second))}
    end
  end

  @doc """
  Normalize the Anthropic OAuth usage payload into a `Snapshot`.

  Window mapping mirrors Jean: `five_hour → :session`, `seven_day → :weekly`,
  `seven_day_sonnet → :sonnet_weekly`; each carries `utilization → used_percent`
  (clamped 0..100) and `resets_at` (absolute epoch seconds). `extra_usage`
  becomes `credits_remaining = monthly_limit - used_credits` when enabled.
  """
  @spec normalize(map(), String.t() | nil, integer()) :: Snapshot.t()
  def normalize(body, plan, _now) when is_map(body) do
    %Snapshot{
      agent_kind: @agent_kind,
      plan: blank_to_nil(plan),
      windows: build_windows(body),
      model_limits: [],
      credits_remaining: credits_remaining(body),
      credits_unlimited: false
    }
  end

  @doc "Read and parse the Claude CLI OAuth credentials file."
  @spec read_credentials(String.t()) :: {:ok, credentials()} | {:error, atom()}
  def read_credentials(path) when is_binary(path) do
    with {:ok, raw} <- read_file(path),
         {:ok, json} <- decode_json(raw),
         {:ok, oauth} <- fetch_oauth(json),
         {:ok, token} <- fetch_access_token(oauth) do
      {:ok,
       %{
         access_token: token,
         refresh_token: blank_to_nil(Map.get(oauth, "refreshToken")),
         expires_at: to_integer(Map.get(oauth, "expiresAt")),
         subscription_type: blank_to_nil(Map.get(oauth, "subscriptionType")),
         raw: json,
         path: path
       }}
    end
  end

  @doc "Default credentials path (`~/.claude/.credentials.json`)."
  @spec default_credentials_path() :: String.t()
  def default_credentials_path do
    case System.user_home() do
      home when is_binary(home) and home != "" -> Path.join(home, @credentials_file)
      _ -> Path.expand("~/" <> @credentials_file)
    end
  end

  @doc false
  @spec reset_backoff() :: :ok
  def reset_backoff do
    :ok
  end

  # ── Refresh-into-store helpers ──────────────────────────────────────────────

  defp safe_fetch(opts) do
    fetch(opts)
  rescue
    error -> {:error, {:exception, error}}
  catch
    kind, value -> {:error, {kind, value}}
  end

  defp enabled? do
    Application.get_env(:symphony_elixir, :claude_usage_probe_enabled, true) == true
  end

  defp fresh_in_store?(account_id) do
    not is_nil(AgentUsage.get(@agent_kind, account_id)) and
      not AgentUsage.stale?(
        @agent_kind,
        account_id,
        System.monotonic_time(:millisecond)
      )
  end

  defp refresh_options(opts) do
    [
      now_ms: Keyword.get(opts, :refresh_now_ms, System.monotonic_time(:millisecond)),
      force: Keyword.get(opts, :force, false),
      base_backoff_ms: Keyword.get(opts, :base_backoff_ms, 60_000),
      auth_backoff_ms: Keyword.get(opts, :auth_backoff_ms, 300_000)
    ]
  end

  # ── Token freshness / refresh ───────────────────────────────────────────────

  defp ensure_fresh_token(creds, now_ms, opts) do
    if token_needs_refresh?(creds, now_ms), do: refresh(creds, now_ms, opts), else: {:ok, creds}
  end

  defp token_needs_refresh?(%{expires_at: nil}, _now_ms), do: true

  defp token_needs_refresh?(%{expires_at: expires_at}, now_ms) when is_integer(expires_at) do
    now_ms + @refresh_buffer_ms >= expires_at
  end

  defp refresh(%{refresh_token: nil}, _now_ms, _opts), do: {:error, :no_refresh_token}

  defp refresh(%{refresh_token: refresh_token} = creds, now_ms, opts) when is_binary(refresh_token) do
    body = %{
      "grant_type" => "refresh_token",
      "refresh_token" => refresh_token,
      "client_id" => @oauth_client_id,
      "scope" => @oauth_scopes
    }

    refresh_http = Keyword.get(opts, :refresh_http, &default_refresh_http/3)

    case refresh_http.(@refresh_url, [{"content-type", "application/json"}], body) do
      {:ok, %{status: status, body: resp}} when status in 200..299 ->
        apply_refresh(creds, resp, now_ms)

      {:ok, %{status: status, body: resp}} when status in [400, 401] ->
        {:error, refresh_error(resp)}

      # Any other non-success: keep the existing token and let the usage call decide.
      {:ok, %{status: _status}} ->
        {:ok, creds}

      {:error, reason} ->
        {:error, {:http_error, reason}}
    end
  end

  defp apply_refresh(creds, resp, now_ms) do
    with {:ok, parsed} <- decode_body(resp),
         token when is_binary(token) <- Map.get(parsed, "access_token") do
      updated = %{
        creds
        | access_token: token,
          refresh_token: blank_to_nil(Map.get(parsed, "refresh_token")) || creds.refresh_token,
          expires_at: next_expires_at(parsed, creds.expires_at, now_ms)
      }

      persist_credentials(updated)
      {:ok, updated}
    else
      nil -> {:error, :invalid_refresh_response}
      {:error, reason} -> {:error, reason}
      _ -> {:error, :invalid_refresh_response}
    end
  end

  defp next_expires_at(parsed, fallback, now_ms) do
    case to_integer(Map.get(parsed, "expires_in")) do
      seconds when is_integer(seconds) -> now_ms + seconds * 1000
      _ -> fallback
    end
  end

  defp refresh_error(resp) do
    case decode_body(resp) do
      {:ok, %{"error" => "invalid_grant"}} -> :session_expired
      _ -> :token_expired
    end
  end

  defp persist_credentials(%{path: path, raw: raw} = creds) when is_binary(path) and is_map(raw) do
    oauth =
      raw
      |> Map.get("claudeAiOauth", %{})
      |> Map.put("accessToken", creds.access_token)
      |> Map.put("refreshToken", creds.refresh_token)
      |> Map.put("expiresAt", creds.expires_at)

    write_atomic(path, Jason.encode!(Map.put(raw, "claudeAiOauth", oauth)))
  rescue
    error ->
      Logger.warning("Claude credentials persist failed: #{inspect(error)}")
      :error
  end

  defp persist_credentials(_creds), do: :ok

  defp write_atomic(path, data) do
    tmp = path <> ".tmp.#{System.unique_integer([:positive])}"
    File.write!(tmp, data)
    File.rename!(tmp, path)
    :ok
  end

  # ── HTTP ────────────────────────────────────────────────────────────────────

  defp request_usage_with_retry(creds, now_ms, opts) do
    case request_usage(creds.access_token, opts) do
      {:error, :token_expired} ->
        case refresh(creds, now_ms, opts) do
          {:ok, refreshed} -> request_usage(refreshed.access_token, opts)
          {:error, _reason} = error -> error
        end

      other ->
        other
    end
  end

  defp request_usage(access_token, opts) do
    headers = [
      {"authorization", "Bearer " <> String.trim(access_token)},
      {"accept", "application/json"},
      {"content-type", "application/json"},
      @beta_header
    ]

    http = Keyword.get(opts, :http, &default_http/2)

    case http.(@usage_url, headers) do
      {:ok, %{status: status, body: body}} when status in 200..299 ->
        decode_body(body)

      {:ok, %{status: status}} when status in [401, 403] ->
        {:error, :token_expired}

      {:ok, %{status: 429} = response} ->
        {:error, {:rate_limited, retry_after_ms(Map.get(response, :headers))}}

      {:ok, %{status: status}} ->
        {:error, {:http_status, status}}

      {:error, reason} ->
        {:error, {:http_error, reason}}
    end
  end

  defp default_http(url, headers) do
    case Req.get(url, headers: headers, receive_timeout: @request_timeout_ms, retry: false) do
      {:ok, %Req.Response{status: status, body: body, headers: headers}} ->
        {:ok, %{status: status, body: body, headers: headers}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp default_refresh_http(url, headers, body) do
    case Req.post(url, headers: headers, json: body, receive_timeout: @request_timeout_ms, retry: false) do
      {:ok, %Req.Response{status: status, body: resp}} -> {:ok, %{status: status, body: resp}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp decode_body(body) when is_map(body), do: {:ok, body}
  defp decode_body(body) when is_binary(body), do: decode_json(body)
  defp decode_body(_body), do: {:error, :invalid_usage_body}

  # ── Normalization ───────────────────────────────────────────────────────────

  defp build_windows(body) do
    [
      {:session, Map.get(body, "five_hour")},
      {:weekly, Map.get(body, "seven_day")},
      {:sonnet_weekly, Map.get(body, "seven_day_sonnet")}
    ]
    |> Enum.map(fn {kind, window} -> build_window(kind, window) end)
    |> Enum.reject(&is_nil/1)
  end

  defp build_window(kind, window) when is_map(window) do
    case clamped_percent(Map.get(window, "utilization")) do
      nil ->
        nil

      used_percent ->
        %Window{
          kind: kind,
          used_percent: used_percent,
          resets_at: to_integer(Map.get(window, "resets_at")),
          window_minutes: nil
        }
    end
  end

  defp build_window(_kind, _window), do: nil

  defp credits_remaining(body) do
    case Map.get(body, "extra_usage") do
      %{} = extra ->
        enabled = Map.get(extra, "is_enabled") == true
        limit = as_number(Map.get(extra, "monthly_limit"))
        spent = as_number(Map.get(extra, "used_credits")) || 0

        if enabled and is_number(limit), do: limit - spent, else: nil

      _ ->
        nil
    end
  end

  defp clamped_percent(value) when is_number(value), do: value |> max(0) |> min(100) |> :erlang.float()
  defp clamped_percent(_value), do: nil

  # ── Credentials parsing ─────────────────────────────────────────────────────

  defp read_file(path) do
    case File.read(path) do
      {:ok, raw} -> {:ok, raw}
      {:error, :enoent} -> {:error, :no_credentials}
      {:error, reason} -> {:error, {:read_error, reason}}
    end
  end

  defp decode_json(raw) do
    case Jason.decode(raw) do
      {:ok, json} -> {:ok, json}
      {:error, _} -> {:error, :invalid_credentials}
    end
  end

  defp fetch_oauth(%{"claudeAiOauth" => %{} = oauth}), do: {:ok, oauth}
  defp fetch_oauth(_json), do: {:error, :no_oauth}

  defp fetch_access_token(oauth) do
    case Map.get(oauth, "accessToken") do
      token when is_binary(token) and token != "" -> {:ok, token}
      _ -> {:error, :no_access_token}
    end
  end

  defp credentials_path(opts) do
    case Keyword.get(opts, :credentials_path) do
      path when is_binary(path) ->
        path

      nil ->
        case Keyword.get(opts, :account_home) do
          home when is_binary(home) -> Path.join(home, ".credentials.json")
          _ -> default_credentials_path()
        end
    end
  end

  defp retry_after_ms(nil), do: 60_000

  defp retry_after_ms(headers) do
    value =
      Enum.find_value(headers, fn
        {name, value} ->
          if String.downcase(to_string(name)) == "retry-after", do: header_value(value)

        _ ->
          nil
      end)

    case Integer.parse(to_string(value || "")) do
      {seconds, ""} when seconds >= 0 -> seconds * 1000
      _ -> 60_000
    end
  end

  defp header_value([value | _]), do: value
  defp header_value(value), do: value

  # ── Coercion helpers ────────────────────────────────────────────────────────

  defp as_number(value) when is_number(value), do: value
  defp as_number(_value), do: nil

  defp to_integer(value) when is_integer(value), do: value
  defp to_integer(value) when is_float(value), do: trunc(value)
  defp to_integer(_value), do: nil

  defp blank_to_nil(value) when is_binary(value) and value != "", do: value
  defp blank_to_nil(_value), do: nil
end
